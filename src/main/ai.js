import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { LANGUAGES } from '../shared/modes.js';

// ---------- prompt builders (pure) ----------

const pad = (n) => String(n).padStart(2, '0');
export const formatTime = (ms) => `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}`;

export const formatTranscript = (segments) =>
  segments.filter((s) => s.text).map((s) => `[${formatTime(s.relativeMs)}] ${s.role === 'me' ? 'Moi' : 'Eux'}: ${s.text}`).join('\n');

const languageLine = (code) => {
  const name = LANGUAGES.find(([c]) => c === code)?.[1];
  return name ? `Write your entire answer in ${name}.` : 'Answer in the language of the conversation.';
};

const filesBlock = (mode) =>
  mode?.files?.length ? `Reference files provided by the user:\n${mode.files.map((f) => `--- ${f.name} ---\n${f.text}`).join('\n')}` : '';

const join = (...parts) => parts.filter(Boolean).join('\n\n');

export function buildChatPrompt({ mode, transcript, history, text, outputLanguage, hasScreenshot }) {
  const system = join(
    'You are MeetInter, a real-time assistant that helps the user during a live meeting or interview. The user reads your answer while the conversation goes on, so be concise and direct. Use Markdown.',
    hasScreenshot && "A screenshot of the user's screen is attached to the last message.",
    mode?.chatPrompt,
    filesBlock(mode),
    transcript.length
      ? `Live transcript so far ("Moi" is the user, "Eux" is everybody else):\n${formatTranscript(transcript)}`
      : 'No conversation has been transcribed yet.',
    languageLine(outputLanguage),
  );
  return { system, messages: [...history.map((m) => ({ role: m.role, content: m.text })), { role: 'user', content: text }] };
}

export function buildSummaryPrompt({ mode, session, outputLanguage }) {
  const sections = mode.summarySections.map((s) => `## ${s.title}\n${s.prompt}`).join('\n\n');
  const system = join(
    'You write meeting notes from a transcript. "Moi" is the user the notes are written for, "Eux" is everybody else.',
    filesBlock(mode),
    languageLine(outputLanguage),
  );
  const user = join(
    `Transcript:\n${formatTranscript(session.transcript)}`,
    session.notes && `The user's own notes:\n${session.notes}`,
    `Start with a single line "# <short title of the meeting>". Then write exactly these sections in Markdown, each under its "## " heading, following the instruction under each heading. If a section has nothing to report, write "Rien à signaler.".\n\n${sections}`,
  );
  return { system, messages: [{ role: 'user', content: user }] };
}

export function buildFollowUpPrompt({ session, outputLanguage }) {
  const system = join('You write follow-up emails after meetings, on behalf of the user ("Moi").', languageLine(outputLanguage));
  const user = join(
    session.summary && `Meeting notes:\n${session.summary}`,
    `Transcript:\n${formatTranscript(session.transcript)}`,
    'Write a short, friendly follow-up email recapping what was agreed and the next steps. Reply with only a JSON object {"subject": string, "body": string} and nothing else.',
  );
  return { system, messages: [{ role: 'user', content: user }] };
}

// sessions: SavedSession[]; one session for "ask about this meeting", several for "past meetings".
export function buildAskPrompt({ sessions, question, outputLanguage }) {
  const docs = sessions.map((s) =>
    `=== ${s.title} (${new Date(s.startedAt).toLocaleString('fr-FR')}) ===\n${s.summary ?? ''}\n\nTranscript:\n${formatTranscript(s.transcript).slice(0, 12000)}${s.notes ? `\n\nUser notes:\n${s.notes}` : ''}`);
  const system = join(
    'You answer questions about the user\'s past meetings using only the material below. If the answer is not in it, say so.',
    docs.join('\n\n') || 'No meeting available.',
    languageLine(outputLanguage),
  );
  return { system, messages: [{ role: 'user', content: question }] };
}

export function splitTitle(text) {
  const m = text.match(/^\s*#\s+(.+)\n?/);
  return m ? { title: m[1].trim(), body: text.slice(m[0].length).trim() } : { title: null, body: text.trim() };
}

export function parseFollowUp(text) {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const { subject, body } = JSON.parse(json);
    if (typeof subject === 'string' && typeof body === 'string') return { subject, body };
  } catch {}
  return { subject: 'Suite de notre échange', body: text.trim() };
}

// ---------- providers ----------

const withImage = (messages, imagePng) => imagePng ? messages.map((m, i) => i === messages.length - 1 ? { ...m, image: imagePng } : m) : messages;

const flatten = ({ system, messages }) =>
  `${system}\n\n---\n\n${messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')}\n\nAnswer the last User message.`;

function run(cmd, args, input, cwd = os.tmpdir()) {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const p = spawn(cmd, win ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args, { cwd, shell: win, windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} a échoué (${code}) : ${(err || out).trim().slice(-500)}`))));
    p.stdin.end(input);
  });
}

const withTempPng = async (png, fn) => {
  if (!png) return fn(null);
  const file = path.join(os.tmpdir(), `meetinter-${randomUUID()}.png`);
  fs.writeFileSync(file, png);
  try { return await fn(file); } finally { fs.rmSync(file, { force: true }); }
};

export const providers = {
  async anthropic({ ai, system, messages, imagePng, smart, onDelta }) {
    const client = new Anthropic({ apiKey: ai.apiKey || undefined, baseURL: ai.baseUrl || undefined });
    const content = (m) => m.image
      ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: m.image.toString('base64') } }, { type: 'text', text: m.content }]
      : m.content;
    const stream = client.messages.stream({
      model: smart ? ai.smartModel : ai.model,
      max_tokens: 16000,
      system,
      messages: withImage(messages, imagePng).map((m) => ({ role: m.role, content: content(m) })),
    });
    if (onDelta) stream.on('text', onDelta);
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('Le modèle a refusé de répondre.');
    return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  },

  async openai({ ai, system, messages, imagePng, smart, onDelta }) {
    const client = new OpenAI({ apiKey: ai.apiKey || 'none', baseURL: ai.baseUrl || undefined });
    const content = (m) => m.image
      ? [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: `data:image/png;base64,${m.image.toString('base64')}` } }]
      : m.content;
    const stream = await client.chat.completions.create({
      model: smart ? ai.smartModel : ai.model,
      stream: true,
      messages: [{ role: 'system', content: system }, ...withImage(messages, imagePng).map((m) => ({ role: m.role, content: content(m) }))],
    });
    let text = '';
    for await (const chunk of stream) {
      const d = chunk.choices[0]?.delta?.content;
      if (d) { text += d; onDelta?.(d); }
    }
    return text;
  },

  'claude-cli': ({ ai, system, messages, imagePng, smart }) =>
    withTempPng(imagePng, async (file) => {
      let prompt = flatten({ system, messages });
      const args = ['-p', '--output-format', 'text'];
      const model = smart ? ai.smartModel : ai.model;
      if (/^claude/.test(model)) args.push('--model', model); // a non-Claude name left in settings would make the CLI fail
      if (file) {
        prompt += `\n\nThe user's screenshot is the image file ${file}. Read it with the Read tool before answering.`;
        args.push('--allowedTools', 'Read', '--add-dir', path.dirname(file));
      }
      return (await run('claude', args, prompt)).trim();
    }),

  'codex-cli': ({ ai, system, messages, imagePng, smart }) =>
    withTempPng(imagePng, async (png) => {
      const out = path.join(os.tmpdir(), `meetinter-${randomUUID()}.txt`);
      const args = ['exec', '--skip-git-repo-check', '--output-last-message', out];
      const model = smart ? ai.smartModel : ai.model;
      if (model && !/^claude/.test(model)) args.push('-m', model);
      if (png) args.push('-i', png); // -i takes a list: it must come last, the prompt goes through stdin
      try {
        await run('codex', args, flatten({ system, messages }));
        return fs.readFileSync(out, 'utf8').trim();
      } finally { fs.rmSync(out, { force: true }); }
    }),
};

export function complete(ai, args) {
  const p = providers[ai.provider];
  if (!p) throw new Error(`fournisseur inconnu : ${ai.provider}`);
  return p({ ai, ...args });
}

// ---------- speech to text (OpenAI-compatible /audio/transcriptions) ----------

export async function transcribe(stt, wav) {
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'segment.wav');
  form.append('model', stt.model);
  if (stt.language && stt.language !== 'auto') form.append('language', stt.language);
  const res = await fetch(`${stt.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: stt.apiKey ? { Authorization: `Bearer ${stt.apiKey}` } : {},
    body: form,
  });
  if (!res.ok) throw new Error(`transcription HTTP ${res.status} : ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()).text ?? '').trim();
}

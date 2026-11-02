import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatPrompt, buildSummaryPrompt, buildFollowUpPrompt, buildAskPrompt, formatTranscript, splitTitle, parseFollowUp } from '../src/main/ai.js';
import { BUILTIN_MODES } from '../src/shared/modes.js';
import { canTransition, advance } from '../src/main/state.js';

const transcript = [
  { id: '1', at: 1, relativeMs: 5000, role: 'them', text: 'Parlez-moi de vous.', status: 'ready' },
  { id: '2', at: 2, relativeMs: 3725000, role: 'me', text: 'Je suis développeur.', status: 'ready' },
  { id: '3', at: 3, relativeMs: 4000, role: 'me', text: '', status: 'transcribing' },
];
const mode = (id) => BUILTIN_MODES.find((m) => m.id === id);

test('transcript lines are [mm:ss] Moi/Eux and skip untranscribed segments', () => {
  assert.equal(formatTranscript(transcript), '[00:05] Eux: Parlez-moi de vous.\n[62:05] Moi: Je suis développeur.');
});

test('chat prompt carries mode prompt, reference files, transcript, language and history', () => {
  const m = { ...mode('work'), files: [{ name: 'cv.txt', text: 'Dix ans de Rust' }] };
  const { system, messages } = buildChatPrompt({
    mode: m, transcript, history: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }],
    text: 'What should I say next?', outputLanguage: 'fr', hasScreenshot: true,
  });
  assert.match(system, /I am a candidate interviewing for a position/);
  assert.match(system, /cv\.txt ---\nDix ans de Rust/);
  assert.match(system, /\[00:05\] Eux: Parlez-moi de vous\./);
  assert.match(system, /entire answer in Français/);
  assert.match(system, /screenshot/);
  assert.match(system, /No em dashes/);
  assert.deepEqual(messages.map((x) => x.role), ['user', 'assistant', 'user']);
  assert.equal(messages.at(-1).content, 'What should I say next?');
});

test('chat prompt without transcript or screenshot says so', () => {
  const { system } = buildChatPrompt({ mode: mode('general'), transcript: [], history: [], text: 'x', outputLanguage: 'auto', hasScreenshot: false });
  assert.match(system, /No conversation has been transcribed yet/);
  assert.doesNotMatch(system, /screenshot/);
  assert.match(system, /language of the conversation/);
});

test('summary prompt lists every section of the mode with its instruction and asks for a title', () => {
  const m = mode('sales');
  const { messages } = buildSummaryPrompt({ mode: m, session: { transcript, notes: 'ma note' }, outputLanguage: 'en' });
  const text = messages[0].content;
  for (const s of m.summarySections) assert.ok(text.includes(`## ${s.title}\n${s.prompt}`), s.title);
  assert.match(text, /^Transcript:/);
  assert.match(text, /ma note/);
  assert.match(text, /# <short title/);
});

test('built-in modes match the documented set', () => {
  assert.deepEqual(BUILTIN_MODES.map((m) => m.name), ['General', 'Sales', 'Recruiting', 'Team Meet', 'Looking for work', 'Lecture']);
  assert.deepEqual(mode('general').summarySections.map((s) => s.title), ['Action Items', 'Summary', 'Background', 'Questions', 'Overview']);
  assert.equal(mode('general').chatPrompt, '');
});

test('follow-up prompt demands JSON, ask prompt embeds the meetings', () => {
  assert.match(buildFollowUpPrompt({ session: { summary: 'S', transcript }, outputLanguage: 'fr' }).messages[0].content, /"subject"/);
  const { system, messages } = buildAskPrompt({
    sessions: [{ title: 'Entretien Acme', startedAt: 0, summary: 'Résumé X', transcript, notes: '' }], question: 'Qui ?', outputLanguage: 'fr',
  });
  assert.match(system, /Entretien Acme/);
  assert.match(system, /Résumé X/);
  assert.equal(messages[0].content, 'Qui ?');
});

test('splitTitle and parseFollowUp', () => {
  assert.deepEqual(splitTitle('# Point produit\n\n## Summary\nok'), { title: 'Point produit', body: '## Summary\nok' });
  assert.deepEqual(splitTitle('## Summary\nok'), { title: null, body: '## Summary\nok' });
  assert.deepEqual(parseFollowUp('```json\n{"subject":"S","body":"B"}\n```'), { subject: 'S', body: 'B' });
  assert.equal(parseFollowUp('pas du json').body, 'pas du json');
});

test('session state machine allows only the documented transitions', () => {
  assert.ok(canTransition('idle', 'live') && canTransition('live', 'summarizing'));
  assert.ok(canTransition('summarizing', 'done') && canTransition('summarizing', 'error') && canTransition('error', 'summarizing'));
  assert.equal(canTransition('idle', 'done'), false);
  assert.equal(canTransition('live', 'live'), false);
  assert.throws(() => advance('done', 'live'), /invalide/);
});

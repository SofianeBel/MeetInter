import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BUILTIN_MODES, DEFAULT_SHORTCUTS } from '../shared/modes.js';

export const DEFAULT_SETTINGS = {
  ai: { provider: 'anthropic', model: 'claude-sonnet-5-5', smartModel: 'claude-opus-5-5', apiKey: '', baseUrl: '' },
  stt: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'whisper-1', language: 'auto' },
  outputLanguage: 'fr', invisible: true, noFocusWhenInvisible: false, hideChatHidesControl: true,
  screenUse: 'required', smartMode: false, ambient: false, openAtLogin: false, icsUrl: '', activeModeId: 'general',
  shortcuts: DEFAULT_SHORTCUTS,
};

// Session lifecycle. `idle` is state.session === null; `live` is state.session !== null;
// the rest is SavedSession.status.
const TRANSITIONS = {
  idle: ['live'],
  live: ['summarizing'],
  summarizing: ['done', 'error'],
  done: ['summarizing'],
  error: ['summarizing'],
};
export const canTransition = (from, to) => TRANSITIONS[from]?.includes(to) ?? false;
export function advance(from, to) {
  if (!canTransition(from, to)) throw new Error(`transition de session invalide : ${from} -> ${to}`);
  return to;
}

const merge = (base, patch) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
};

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

export function createStore(dir) {
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  const settingsFile = path.join(dir, 'settings.json');
  const modesFile = path.join(dir, 'modes.json');
  const subs = new Set();

  const state = {
    settings: merge(DEFAULT_SETTINGS, readJson(settingsFile, {})),
    modes: [...BUILTIN_MODES, ...readJson(modesFile, [])],
    session: null,
    ui: {
      showChat: true, chatExpanded: false, isCapturingScreenshot: false, meSpeaking: false, themSpeaking: false,
      upcomingMeeting: null, recordingShortcut: false,
    },
  };

  let timer = null;
  const write = () => {
    fs.writeFileSync(settingsFile, JSON.stringify(state.settings, null, 2));
    fs.writeFileSync(modesFile, JSON.stringify(state.modes.filter((m) => !m.builtin), null, 2));
  };
  const commit = (persist) => {
    if (persist) { clearTimeout(timer); timer = setTimeout(write, 300); }
    for (const cb of subs) cb(state);
  };

  const sessionFile = (id) => path.join(dir, 'sessions', `${path.basename(id)}.json`);

  return {
    state,
    subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    flush: () => { clearTimeout(timer); write(); },

    patchSettings(p) { state.settings = merge(state.settings, p); commit(true); },
    patchUi(p) { Object.assign(state.ui, p); commit(false); },

    saveMode(m) {
      const i = state.modes.findIndex((x) => x.id === m.id);
      if (i >= 0 && state.modes[i].builtin) throw new Error('un mode intégré ne peut pas être modifié');
      const mode = { files: [], summarySections: [], chatPrompt: '', ...m, id: m.id || randomUUID(), builtin: false };
      if (i >= 0) state.modes[i] = mode; else state.modes.push(mode);
      commit(true);
      return mode;
    },
    deleteMode(id) {
      const m = state.modes.find((x) => x.id === id);
      if (!m || m.builtin) return;
      state.modes = state.modes.filter((x) => x !== m);
      if (state.settings.activeModeId === id) state.settings.activeModeId = 'general';
      commit(true);
    },

    startSession() {
      advance(state.session ? 'live' : 'idle', 'live');
      state.session = { id: randomUUID(), modeId: state.settings.activeModeId, startedAt: Date.now(), transcript: [], messages: [] };
      state.ui.upcomingMeeting = null;
      commit(false);
      return state.session;
    },
    takeSession() { // live -> (caller saves as summarizing)
      const s = state.session;
      state.session = null;
      state.ui.meSpeaking = state.ui.themSpeaking = false;
      commit(false);
      return s;
    },
    addSegment(seg) {
      const t = state.session.transcript;
      t.push(seg);
      t.sort((a, b) => a.at - b.at);
      commit(false);
    },
    updateSegment(id, text) {
      const t = state.session?.transcript;
      const i = t?.findIndex((s) => s.id === id);
      if (i == null || i < 0) return;
      if (text) { t[i].text = text; t[i].status = 'ready'; } else t.splice(i, 1);
      commit(false);
    },
    addMessages(...msgs) { state.session.messages.push(...msgs); commit(false); },
    setMessageText(id, text) {
      const m = state.session?.messages.find((x) => x.id === id);
      if (m) { m.text = text; commit(false); }
    },
    removeMessage(id) {
      if (!state.session) return;
      state.session.messages = state.session.messages.filter((m) => m.id !== id);
      commit(false);
    },
    clearMessages() { if (state.session) { state.session.messages = []; } state.ui.chatExpanded = false; commit(false); },

    saveSession: (s) => fs.writeFileSync(sessionFile(s.id), JSON.stringify(s)),
    loadSession: (id) => readJson(sessionFile(id), null),
    deleteSession: (id) => fs.rmSync(sessionFile(id), { force: true }),
    allSessions: () =>
      fs.readdirSync(path.join(dir, 'sessions')).filter((f) => f.endsWith('.json'))
        .map((f) => readJson(path.join(dir, 'sessions', f), null)).filter(Boolean)
        .sort((a, b) => b.startedAt - a.startedAt),
  };
}

// Number of query words found in a saved session (0 = no match).
export function scoreSession(s, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [s.title, s.summary, s.notes, ...s.transcript.map((t) => t.text)].join('\n').toLowerCase();
  return words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
}

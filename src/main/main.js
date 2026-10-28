import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { app, BrowserWindow, Menu, Tray, nativeImage, globalShortcut, ipcMain, screen, desktopCapturer, session, shell, clipboard, dialog } from 'electron';
import { createStore, scoreSession, advance } from './state.js';
import { complete, transcribe, buildChatPrompt, buildSummaryPrompt, buildFollowUpPrompt, buildAskPrompt, splitTitle, parseFollowUp } from './ai.js';
import { startCalendar } from './calendar.js';
import { QUICK_ACTIONS } from '../shared/modes.js';

if (!app.requestSingleInstanceLock()) app.quit();

const ROOT = path.join(import.meta.dirname, '..');
const page = (name) => path.join(ROOT, 'renderer', `${name}.html`);
const CONTROL = { w: 163, h: 50 };
const CHAT_W = 540;

let store, tray, calendar;
let quitting = false;
let ending = false;
const wins = {};
const controlPos = { x: 0, y: 0 };
let chatHeight = 152;
const inflight = new Set();

const log = (...a) => console.log(new Date().toISOString(), ...a);
const send = (name, channel, payload) => { if (wins[name] && !wins[name].isDestroyed()) wins[name].webContents.send(channel, payload); };
const broadcast = (channel, payload) => Object.keys(wins).forEach((n) => send(n, channel, payload));

// ---------- windows ----------

const focusable = () => !(store.state.settings.invisible && store.state.settings.noFocusWhenInvisible);

function overlay(name, w, h) {
  const win = new BrowserWindow({
    width: w, height: h, show: false, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, hasShadow: false, focusable: focusable(), title: `MeetInter ${name}`,
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(page(name));
  wins[name] = win;
  return win;
}

// opacity trick avoids the white flash Windows shows when a transparent window appears
function reveal(win) {
  if (win.isVisible()) return;
  win.setOpacity(0);
  focusable() ? win.show() : win.showInactive();
  setTimeout(() => win.setOpacity(1), 30);
}

function createDashboard(hash = '#/sessions') {
  const win = new BrowserWindow({
    width: 1050, height: 700, minWidth: 800, minHeight: 600, show: false, backgroundColor: '#111114',
    autoHideMenuBar: true, title: 'MeetInter',
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(page('dashboard'), { hash: hash.replace(/^#/, '') });
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  wins.dashboard = win;
}

function openDashboard(hash) {
  if (!wins.dashboard || wins.dashboard.isDestroyed()) return createDashboard(hash);
  wins.dashboard.show();
  wins.dashboard.focus();
  if (hash) send('dashboard', 'navigate', hash);
}

function createAudio() {
  const win = new BrowserWindow({
    show: false, title: 'MeetInter audio',
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.loadFile(page('audio'));
  wins.audio = win;
}

const workArea = () => screen.getDisplayNearestPoint({ x: controlPos.x, y: controlPos.y }).workArea;

function placeControl(x, y) {
  const wa = workArea();
  controlPos.x = Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - CONTROL.w));
  controlPos.y = Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - CONTROL.h));
  wins.control.setPosition(controlPos.x, controlPos.y);
  placeChat();
}

function placeChat() {
  const wa = workArea();
  const x = Math.min(Math.max(controlPos.x + CONTROL.w / 2 - CHAT_W / 2, wa.x), wa.x + wa.width - CHAT_W);
  const y = controlPos.y + CONTROL.h + 6;
  const h = Math.min(chatHeight, Math.max(100, wa.y + wa.height - y - 8));
  wins.chat.setBounds({ x: Math.round(x), y: Math.round(y), width: CHAT_W, height: Math.round(h) });
}

function resetPosition() {
  const wa = screen.getPrimaryDisplay().workArea;
  placeControl(wa.x + (wa.width - CONTROL.w) / 2, wa.y + 25);
}

let lastFlags = '';
function applyWindows(state) {
  const { settings, ui } = state;
  const flags = JSON.stringify([settings.invisible, settings.noFocusWhenInvisible, ui.isCapturingScreenshot]);
  if (flags !== lastFlags) {
    lastFlags = flags;
    for (const w of Object.values(wins)) {
      if (w.isDestroyed()) continue;
      w.setContentProtection(settings.invisible || ui.isCapturingScreenshot);
    }
    for (const n of ['control', 'chat', 'notify']) wins[n].setFocusable(focusable());
  }
  const want = {
    chat: ui.showChat,
    control: ui.showChat || !settings.hideChatHidesControl,
    notify: !!ui.upcomingMeeting,
  };
  for (const [n, on] of Object.entries(want)) on ? reveal(wins[n]) : wins[n].hide();
}

// ---------- reacting to state changes ----------

const seen = {};
const changed = (key, value) => {
  const v = JSON.stringify(value);
  if (seen[key] === v) return false;
  seen[key] = v;
  return true;
};

function sync(state) {
  broadcast('state', state);
  applyWindows(state);
  const { settings, ui } = state;
  if (changed('shortcuts', [settings.shortcuts, ui.recordingShortcut])) registerShortcuts();
  if (changed('login', settings.openAtLogin)) {
    app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args: app.isPackaged ? [] : [app.getAppPath()] });
  }
  if (changed('ics', settings.icsUrl)) calendar?.refresh();
  if (changed('tray', [!!state.session, settings.invisible])) buildTray();
}

const actions = {
  toggleVisibility() {
    const show = !store.state.ui.showChat;
    store.patchUi({ showChat: show });
    if (show && focusable()) { wins.chat.focus(); send('chat', 'chat-focus-input'); } else if (!show) send('chat', 'chat-blur-input');
  },
  ask() {
    if (!store.state.ui.showChat) store.patchUi({ showChat: true });
    send('chat', 'chat-submit');
  },
  clear() { store.clearMessages(); },
  toggleSession() { return store.state.session ? endSession() : startSession(); },
  moveUp: () => placeControl(controlPos.x, controlPos.y - 80),
  moveDown: () => placeControl(controlPos.x, controlPos.y + 80),
  moveLeft: () => placeControl(controlPos.x - 80, controlPos.y),
  moveRight: () => placeControl(controlPos.x + 80, controlPos.y),
  scrollUp: () => send('chat', 'chat-scroll', { deltaY: -240 }),
  scrollDown: () => send('chat', 'chat-scroll', { deltaY: 240 }),
};

function registerShortcuts() {
  globalShortcut.unregisterAll();
  if (store.state.ui.recordingShortcut) return;
  for (const [name, accel] of Object.entries(store.state.settings.shortcuts)) {
    if (!accel || !actions[name]) continue;
    try {
      if (!globalShortcut.register(accel, () => actions[name]())) log('raccourci indisponible :', name, accel);
    } catch (e) { log('raccourci invalide :', name, accel, e.message); }
  }
}

// ---------- tray ----------

function trayIcon() {
  const n = 16, buf = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if ((x - 7.5) ** 2 + (y - 7.5) ** 2 > 49) continue;
    buf.set([0xf6, 0x5c, 0x8b, 0xff], (y * n + x) * 4); // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: n, height: n });
}

function buildTray() {
  const { state } = store;
  tray ??= new Tray(trayIcon());
  tray.setToolTip('MeetInter');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: state.session ? "Arrêter l'écoute" : "Démarrer l'écoute", click: () => actions.toggleSession() },
    { label: state.ui.showChat ? 'Masquer' : 'Afficher', click: () => actions.toggleVisibility() },
    { label: 'Invisible pour le partage', type: 'checkbox', checked: state.settings.invisible, click: (i) => store.patchSettings({ invisible: i.checked }) },
    { type: 'separator' },
    { label: 'Sessions', click: () => openDashboard('#/sessions') },
    { label: 'Préférences', click: () => openDashboard('#/settings') },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- session lifecycle ----------

function startSession() {
  if (store.state.session) return store.state.session;
  const s = store.startSession();
  store.patchUi({ showChat: true });
  return s;
}

const defaultTitle = (ms) => `Réunion du ${new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
const modeOf = (id) => store.state.modes.find((m) => m.id === id) ?? store.state.modes[0];

async function endSession() {
  if (!store.state.session || ending) return;
  ending = true;
  try {
    send('audio', 'audio-flush');
    await sleep(500);
    await Promise.race([Promise.allSettled([...inflight]), sleep(30000)]);
    const live = store.takeSession();
    if (!live.transcript.length && !live.messages.length) return;
    const saved = {
      ...live, endedAt: Date.now(), title: defaultTitle(live.startedAt), notes: '', summary: null, followUpEmail: null,
      status: advance('live', 'summarizing'),
    };
    store.saveSession(saved);
    broadcast('session-updated', saved.id);
    openDashboard(`#/session/${saved.id}`);
    summarize(saved.id);
  } finally { ending = false; }
}

// expects status === 'summarizing'
async function summarize(id) {
  const patch = {};
  try {
    const s = store.loadSession(id);
    if (!s.transcript.some((t) => t.text)) {
      patch.summary = null;
    } else {
      const { settings } = store.state;
      const { system, messages } = buildSummaryPrompt({ mode: modeOf(s.modeId), session: s, outputLanguage: settings.outputLanguage });
      const { title, body } = splitTitle(await complete(settings.ai, { system, messages, smart: settings.smartMode }));
      patch.summary = body;
      if (title && s.title === defaultTitle(s.startedAt)) patch.title = title;
    }
    patch.status = advance('summarizing', 'done');
    patch.error = undefined;
  } catch (e) {
    log('résumé :', e.message);
    patch.status = advance('summarizing', 'error');
    patch.error = e.message;
  }
  store.saveSession({ ...store.loadSession(id), ...patch }); // reload: the user may have edited notes meanwhile
  broadcast('session-updated', id);
}

// ---------- audio / transcription ----------

const queue = [];
let active = 0;
const pump = () => {
  while (active < 4 && queue.length) {
    active++;
    queue.shift()().finally(() => { active--; pump(); });
  }
};
const enqueue = (job) => new Promise((res) => { queue.push(() => job().then(res, res)); pump(); });

let lastNotice = '';
const notice = (message) => {
  if (message === lastNotice) return;
  lastNotice = message;
  send('chat', 'chat-notice', message);
};

function addSegment(role, wavBase64, at) {
  const live = store.state.session;
  if (!live) return;
  const seg = { id: randomUUID(), at, relativeMs: Math.max(0, at - live.startedAt), role, text: '', status: 'transcribing' };
  store.addSegment(seg);
  const job = enqueue(async () => {
    try {
      store.updateSegment(seg.id, await transcribe(store.state.settings.stt, Buffer.from(wavBase64, 'base64')));
      lastNotice = '';
    } catch (e) {
      log('transcription :', e.message);
      store.updateSegment(seg.id, '');
      notice(`Transcription impossible : ${e.message}`);
    }
  });
  inflight.add(job);
  job.finally(() => inflight.delete(job));
}

// ---------- chat ----------

async function captureScreen() {
  const disp = screen.getDisplayNearestPoint(wins.chat.getBounds());
  store.patchUi({ isCapturingScreenshot: true });
  await sleep(150); // let content protection hide our own windows
  try {
    const full = { width: disp.size.width * disp.scaleFactor, height: disp.size.height * disp.scaleFactor };
    const k = Math.min(1, 1920 / full.width);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(full.width * k), height: Math.round(full.height * k) } });
    return (sources.find((s) => s.display_id === String(disp.id)) ?? sources[0])?.thumbnail.toPNG() ?? null;
  } catch (e) {
    log('capture :', e.message);
    return null;
  } finally { store.patchUi({ isCapturingScreenshot: false }); }
}

async function ask({ text, display, quick } = {}) {
  const { settings } = store.state;
  if (!store.state.session) {
    if (!settings.ambient) throw new Error('Aucune session en cours. Démarre l’écoute ou active le mode ambiant.');
    startSession();
  }
  const live = store.state.session;
  const q = QUICK_ACTIONS[quick ?? (text?.trim() ? '' : 'assist')];
  const png = settings.screenUse === 'required' ? await captureScreen() : null;
  const prompt = text?.trim() || (q.sessionPrompt && live.transcript.length ? q.sessionPrompt : q.prompt);
  const history = [...live.messages];
  const user = { id: randomUUID(), role: 'user', text: prompt, display: display ?? text?.trim() ?? q.label, screenshot: !!png };
  const reply = { id: randomUUID(), role: 'assistant', text: '' };
  store.addMessages(user, reply);
  store.patchUi({ showChat: true, chatExpanded: true });

  const { system, messages } = buildChatPrompt({
    mode: modeOf(live.modeId), transcript: live.transcript, history, text: prompt,
    outputLanguage: settings.outputLanguage, hasScreenshot: !!png,
  });
  complete(settings.ai, {
    system, messages, imagePng: png, smart: settings.smartMode,
    onDelta: (delta) => send('chat', 'chat-delta', { messageId: reply.id, delta, done: false }),
  }).then((answer) => {
    store.setMessageText(reply.id, answer.trim() || 'Rien à ajouter pour le moment.');
    send('chat', 'chat-delta', { messageId: reply.id, delta: '', done: true });
  }).catch((e) => {
    log('chat :', e.message);
    store.removeMessage(reply.id);
    send('chat', 'chat-delta', { messageId: reply.id, delta: '', done: true, error: e.message });
  });
  return reply.id;
}

// ---------- IPC ----------

const rowOf = (s) => ({
  id: s.id, title: s.title, startedAt: s.startedAt, endedAt: s.endedAt, status: s.status, modeId: s.modeId,
  preview: (s.summary ?? '').replace(/[#*_`>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160),
});

const ranked = (query) => {
  const all = store.allSessions();
  if (!query?.trim()) return all.map((s) => [s, 0]);
  return all.map((s) => [s, scoreSession(s, query)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || b[0].startedAt - a[0].startedAt);
};

const askAbout = (sessions, question) => {
  const { settings } = store.state;
  const { system, messages } = buildAskPrompt({ sessions, question, outputLanguage: settings.outputLanguage });
  return complete(settings.ai, { system, messages, smart: settings.smartMode });
};

const handlers = {
  getState: () => store.state,
  patchSettings: (p) => store.patchSettings(p),
  patchUi: (p) => store.patchUi(p),
  startSession: () => { startSession(); },
  endSession: () => endSession(),
  ask,
  clearChat: () => actions.clear(),
  dragControl: ({ x, y }) => placeControl(x, y),
  resetPosition,
  resizeChat: (h) => { chatHeight = Math.max(100, Math.round(h)); placeChat(); },
  addSegment,
  openDashboard: (hash) => openDashboard(hash),
  openExternal: (url) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); },
  copy: (text) => clipboard.writeText(String(text)),

  listSessions: (query) => ranked(query).map(([s]) => rowOf(s)),
  getSession: (id) => store.loadSession(id),
  updateSession(id, { notes, title }) {
    const s = store.loadSession(id);
    if (notes !== undefined) s.notes = notes;
    if (title !== undefined) s.title = title;
    store.saveSession(s);
    broadcast('session-updated', id);
  },
  deleteSession(id) { store.deleteSession(id); broadcast('session-updated', id); },
  reanalyze(id) {
    const s = store.loadSession(id);
    store.saveSession({ ...s, status: advance(s.status, 'summarizing'), summary: null, followUpEmail: null, error: undefined });
    broadcast('session-updated', id);
    summarize(id);
  },
  async followUpEmail(id) {
    const s = store.loadSession(id);
    if (s.followUpEmail) return s.followUpEmail;
    const { settings } = store.state;
    const { system, messages } = buildFollowUpPrompt({ session: s, outputLanguage: settings.outputLanguage });
    s.followUpEmail = parseFollowUp(await complete(settings.ai, { system, messages }));
    store.saveSession({ ...store.loadSession(id), followUpEmail: s.followUpEmail });
    return s.followUpEmail;
  },
  askSession: (id, text) => askAbout([store.loadSession(id)], text),
  askPast: (text) => askAbout(ranked(text).slice(0, 6).map(([s]) => s), text),

  saveMode: (m) => store.saveMode(m),
  deleteMode: (id) => store.deleteMode(id),
  async addModeFile(id) {
    const mode = store.state.modes.find((m) => m.id === id);
    if (!mode || mode.builtin) throw new Error('Seuls les modes personnalisés acceptent des fichiers.');
    const { filePaths } = await dialog.showOpenDialog(wins.dashboard, {
      properties: ['openFile', 'multiSelections'], filters: [{ name: 'Texte', extensions: ['txt', 'md', 'markdown', 'csv', 'json'] }],
    });
    const files = filePaths.map((p) => ({ name: path.basename(p), text: fs.readFileSync(p, 'utf8').slice(0, 200000) }));
    return store.saveMode({ ...mode, files: [...mode.files, ...files] });
  },
};

// ---------- boot ----------

app.on('web-contents-created', (_, wc) => {
  wc.setWindowOpenHandler(({ url }) => { handlers.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
});

app.on('second-instance', () => openDashboard());
app.on('before-quit', () => { quitting = true; store?.flush(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'));

  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true)); // only our own local pages load here
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const [screen0] = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: screen0, audio: 'loopback' });
  });

  for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(name, (_e, ...args) => fn(...args));

  overlay('control', CONTROL.w, CONTROL.h);
  overlay('chat', CHAT_W, chatHeight);
  overlay('notify', 360, 300);
  const wa = screen.getPrimaryDisplay().workArea;
  wins.notify.setPosition(wa.x + wa.width - 376, wa.y + 16);
  resetPosition();
  createAudio();
  createDashboard();

  calendar = startCalendar({
    getUrl: () => store.state.settings.icsUrl,
    onUpcoming: (e) => store.patchUi({ upcomingMeeting: { title: e.title, start: e.start, url: e.url } }),
    log,
  });
  store.subscribe(sync);
  sync(store.state);
  log('MeetInter prêt');
});

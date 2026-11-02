const { contextBridge, ipcRenderer } = require('electron');

const methods = [
  'getState', 'patchSettings', 'patchUi', 'startSession', 'endSession', 'ask', 'clearChat', 'notchHover',
  'resizeChat', 'addSegment', 'openDashboard', 'openExternal', 'copy',
  'pickerSources', 'pickerChoose', 'videoStart', 'videoChunk', 'videoEnd',
  'listSessions', 'getSession', 'updateSession', 'deleteSession', 'reanalyze', 'followUpEmail', 'askSession', 'askPast',
  'saveMode', 'deleteMode', 'addModeFile',
];
const events = ['chat-focus-input', 'chat-blur-input', 'chat-scroll', 'chat-submit', 'chat-notice', 'navigate', 'session-updated', 'audio-flush'];

const api = Object.fromEntries(methods.map((m) => [m, (...args) => ipcRenderer.invoke(m, ...args)]));
api.onState = (cb) => ipcRenderer.on('state', (_e, s) => cb(s));
api.onChatDelta = (cb) => ipcRenderer.on('chat-delta', (_e, d) => cb(d));
api.on = (channel, cb) => { if (events.includes(channel)) ipcRenderer.on(channel, (_e, d) => cb(d)); };

contextBridge.exposeInMainWorld('api', api);

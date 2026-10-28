import { marked } from '../../node_modules/marked/lib/marked.esm.js';
import { QUICK_ACTIONS } from '../shared/modes.js';

const $ = (s) => document.querySelector(s);
const md = (t) => marked.parse(t, { breaks: true });
const IDLE_MS = 10 * 60 * 1000;

const messages = $('#messages'), input = $('#input'), panel = $('#panel');
let state;
const streams = {};
let signature = '';
let lastChange = Date.now();

const showBanner = (text) => { $('#banner span').textContent = text; $('#banner').hidden = false; };
$('#banner-x').onclick = () => { $('#banner').hidden = true; };

function renderMessages(s) {
  const list = s.session?.messages ?? [];
  const stick = messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 30;
  messages.replaceChildren(...list.map((m) => {
    const el = document.createElement('div');
    el.className = `msg ${m.role}`;
    el.dataset.id = m.id;
    if (m.role === 'user') {
      el.textContent = (m.screenshot ? '🖼 ' : '') + (m.display ?? m.text);
    } else {
      fillAssistant(el, m);
    }
    return el;
  }));
  if (stick) messages.scrollTop = messages.scrollHeight;
}

function fillAssistant(el, m) {
  const text = streams[m.id] ?? m.text;
  el.innerHTML = text ? `<div class="md">${md(text)}</div>` : '<span class="thinking">Réflexion…</span>';
  if (!m.text) return;
  const copy = document.createElement('button');
  copy.className = 'copy';
  copy.textContent = 'Copier';
  copy.onclick = () => api.copy(m.text);
  el.append(copy);
}

function renderLive(s) {
  const live = $('#live');
  const t = s.session?.transcript ?? [];
  live.hidden = !s.session;
  $('#live-title').textContent = `Transcription en direct (${t.length})`;
  $('#live-chev').textContent = s.ui.chatExpanded ? '▾' : '▸';
  $('#live-body').hidden = !s.ui.chatExpanded;
  $('#live-body').replaceChildren(...t.slice(-12).map((seg) => {
    const p = document.createElement('p');
    p.className = `${seg.role}${seg.status === 'transcribing' ? ' pending' : ''}`;
    p.textContent = `${seg.role === 'me' ? 'Moi' : 'Eux'} : ${seg.status === 'transcribing' ? '…' : seg.text}`;
    return p;
  }));
}

function render(s) {
  state = s;
  const sig = s.session ? s.session.transcript.map((x) => x.text.length).join(',') + '|' + s.session.messages.map((m) => m.text.length).join(',') : '';
  if (sig !== signature) { signature = sig; lastChange = Date.now(); $('#idle').hidden = true; }
  renderMessages(s);
  renderLive(s);
  $('#smart').classList.toggle('on', s.settings.smartMode);
  input.placeholder = s.session || s.settings.ambient ? 'Pose une question…' : 'Démarre l’écoute (●) pour poser une question';
}

async function submit(quick) {
  const text = input.value.trim();
  input.value = '';
  try { await api.ask(quick ? { quick } : text ? { text } : { quick: 'assist' }); }
  catch (e) { showBanner(e.message.replace(/^Error invoking remote method '\w+': (Error: )?/, '')); }
}

$('#quick').replaceChildren(...Object.entries(QUICK_ACTIONS).map(([key, a]) => {
  const b = document.createElement('button');
  b.textContent = a.label;
  b.onclick = () => submit(key);
  return b;
}));
$('#form').onsubmit = (e) => { e.preventDefault(); submit(); };
$('#smart').onclick = () => api.patchSettings({ smartMode: !state.settings.smartMode });
$('#live-head').onclick = () => api.patchUi({ chatExpanded: !state.ui.chatExpanded });
$('#still').onclick = () => { lastChange = Date.now(); $('#idle').hidden = true; };
$('#stop').onclick = () => api.endSession();
input.onkeydown = (e) => { if (e.key === 'Escape') input.blur(); };

api.onChatDelta(({ messageId, delta, done, error }) => {
  if (error) showBanner(error);
  if (done) { delete streams[messageId]; render(state); return; }
  streams[messageId] = (streams[messageId] ?? '') + delta;
  const el = messages.querySelector(`[data-id="${messageId}"]`);
  if (!el) return;
  const stick = messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 30;
  fillAssistant(el, { id: messageId, text: '' });
  if (stick) messages.scrollTop = messages.scrollHeight;
});
api.on('chat-notice', showBanner);
api.on('chat-focus-input', () => input.focus());
api.on('chat-blur-input', () => input.blur());
api.on('chat-scroll', ({ deltaY }) => messages.scrollBy({ top: deltaY, behavior: 'smooth' }));
api.on('chat-submit', () => submit());

setInterval(() => { if (state?.session && Date.now() - lastChange > IDLE_MS) $('#idle').hidden = false; }, 15000);

new ResizeObserver(() => api.resizeChat(panel.offsetHeight + 4)).observe(panel);
api.onState(render);
api.getState().then(render);

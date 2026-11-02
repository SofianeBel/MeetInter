import { marked } from '../../node_modules/marked/lib/marked.esm.js';
import { LANGUAGES, SHORTCUT_LABELS, DEFAULT_SHORTCUTS } from '../shared/modes.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const md = (t) => marked.parse(t ?? '', { breaks: true });
const main = $('#main');
const errText = (e) => e.message.replace(/^Error invoking remote method '\w+': (Error: )?/, '');
const fmtDate = (ms) => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const STATUS = { summarizing: ['Analyse…', ''], done: ['Prêt', 'on'], error: ['Erreur', 'err'] };
const badge = (status) => `<span class="badge ${STATUS[status][1]}">${STATUS[status][0]}</span>`;

let state;
let tab = 'summary';

// ---------- routing ----------

const routes = {
  sessions: viewSessions,
  session: viewSession,
  modes: viewModes,
  settings: viewSettings,
};

function route() {
  const [, name = 'sessions', arg] = location.hash.split('/');
  $$('nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === (name === 'session' ? 'sessions' : name)));
  (routes[name] ?? viewSessions)(arg);
}

// ---------- sessions list ----------

async function viewSessions() {
  main.innerHTML = `<h2>Sessions</h2>
    <div class="card"><b>Demander à propos des réunions passées</b>
      <form id="past"><input id="pq" placeholder="Qu’a-t-on décidé avec l’équipe produit ?"><button class="primary">Demander</button></form>
      <div id="pa" class="md selectable"></div></div>
    <div class="bar"><input id="search" placeholder="Rechercher des réunions, des personnes, des sujets…"></div>
    <div id="list"></div>`;
  const load = async () => {
    const rows = await api.listSessions($('#search').value);
    $('#list').innerHTML = rows.length
      ? rows.map((r) => `<div class="row-s" data-id="${r.id}"><div><div class="t">${esc(r.title)}</div><div class="p">${esc(r.preview)}</div></div>
          <div style="text-align:right"><div class="muted">${fmtDate(r.startedAt)}</div>${badge(r.status)}</div></div>`).join('')
      : '<p class="muted">Aucune session pour le moment. Démarre l’écoute avec le bouton à gauche ou Ctrl+Alt+\\.</p>';
  };
  let t;
  $('#search').oninput = () => { clearTimeout(t); t = setTimeout(load, 200); };
  $('#list').onclick = (e) => { const r = e.target.closest('.row-s'); if (r) location.hash = `#/session/${r.dataset.id}`; };
  $('#past').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('#pq').value.trim();
    if (!q) return;
    $('#pa').textContent = 'Recherche…';
    try { $('#pa').innerHTML = md(await api.askPast(q)); } catch (err) { $('#pa').textContent = errText(err); }
  };
  load();
}

// ---------- session detail ----------

async function viewSession(id) {
  const s = await api.getSession(id);
  if (!s) { location.hash = '#/sessions'; return; }
  const mode = state.modes.find((m) => m.id === s.modeId);
  const body = {
    summary: s.status === 'summarizing' ? '<p class="muted">Génération des notes…</p>'
      : s.status === 'error' ? `<p class="badge err">${esc(s.error ?? 'Erreur')}</p><p class="muted">Vérifie le fournisseur IA dans les réglages puis clique sur Ré-analyser.</p>`
      : `<div class="md selectable">${s.summary ? md(s.summary) : '<p class="muted">Aucun résumé (pas de parole transcrite).</p>'}</div>`,
    transcript: `<pre class="tr">${esc(transcriptText(s)) || 'Transcript vide.'}</pre>`,
    notes: `<textarea id="notes" class="big" style="width:100%" placeholder="Tes notes personnelles…">${esc(s.notes)}</textarea>`,
    email: `<div id="email">${s.followUpEmail ? emailHtml(s.followUpEmail) : '<button id="gen" class="primary">Générer l’e-mail de suivi</button>'}</div>`,
    ask: `<form id="askForm" class="bar"><input id="aq" placeholder="Poser une question sur cette réunion…"><button class="primary">Demander</button></form><div id="aa" class="md selectable"></div>`,
  };
  const labels = { summary: 'Résumé', transcript: 'Transcript', notes: 'Notes', email: 'E-mail de suivi', ask: 'Poser une question' };
  main.innerHTML = `<input class="title-in" id="title" value="${esc(s.title)}">
    <div class="muted">${fmtDate(s.startedAt)} · ${mmss((s.endedAt ?? s.startedAt) - s.startedAt)} · ${esc(mode?.name ?? 'Mode supprimé')} ${badge(s.status)}</div>
    <div class="tabs">${Object.entries(labels).map(([k, v]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div>${body[tab]}</div>
    <div class="actions" style="margin-top:24px">
      <button id="cpSummary">Copier le résumé</button><button id="cpTranscript">Copier le transcript</button>
      <button id="again">Ré-analyser</button><button id="del" class="danger">Supprimer</button></div>`;

  $('#title').onchange = (e) => api.updateSession(id, { title: e.target.value });
  $$('.tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; viewSession(id); }));
  $('#cpSummary').onclick = () => api.copy(s.summary ?? '');
  $('#cpTranscript').onclick = () => api.copy(transcriptText(s));
  $('#again').onclick = () => api.reanalyze(id);
  $('#del').onclick = async () => { if (confirm('Supprimer cette session définitivement ?')) { await api.deleteSession(id); location.hash = '#/sessions'; } };
  if ($('#notes')) $('#notes').onchange = (e) => api.updateSession(id, { notes: e.target.value });
  if ($('#gen')) $('#gen').onclick = async () => {
    $('#email').textContent = 'Rédaction…';
    try { $('#email').innerHTML = emailHtml(await api.followUpEmail(id)); wireEmail(); } catch (e) { $('#email').textContent = errText(e); }
  };
  if (s.followUpEmail) wireEmail();
  if ($('#askForm')) $('#askForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!$('#aq').value.trim()) return;
    $('#aa').textContent = 'Réflexion…';
    try { $('#aa').innerHTML = md(await api.askSession(id, $('#aq').value)); } catch (err) { $('#aa').textContent = errText(err); }
  };
}

const transcriptText = (s) => s.transcript.filter((t) => t.text).map((t) => `[${mmss(t.relativeMs)}] ${t.role === 'me' ? 'Moi' : 'Eux'} : ${t.text}`).join('\n');
const emailHtml = (m) => `<div class="f"><span>Objet</span><input id="subj" value="${esc(m.subject)}"></div>
  <textarea id="body" class="big" style="width:100%;min-height:200px">${esc(m.body)}</textarea>
  <div class="actions" style="margin-top:8px"><button id="mailto" class="primary">Ouvrir dans la messagerie</button><button id="cpMail">Copier</button></div>`;
function wireEmail() {
  $('#mailto').onclick = () => api.openExternal(`mailto:?subject=${encodeURIComponent($('#subj').value)}&body=${encodeURIComponent($('#body').value)}`);
  $('#cpMail').onclick = () => api.copy(`${$('#subj').value}\n\n${$('#body').value}`);
}

// ---------- modes ----------

let editing = null;

function viewModes() {
  const active = state.settings.activeModeId;
  main.innerHTML = `<h2>Modes</h2><p class="muted">Le mode actif oriente les réponses en direct et le plan des notes de fin de session.</p>
    <div class="actions"><button id="new" class="primary">Nouveau mode</button></div>
    <div id="editor"></div>
    ${state.modes.map((m) => `<div class="card" data-id="${m.id}"><div class="actions" style="justify-content:space-between">
        <div><b>${esc(m.name)}</b> ${m.builtin ? '<span class="badge">intégré</span>' : ''} ${m.id === active ? '<span class="badge on">actif</span>' : ''}
        <div class="muted" style="margin-top:4px">${esc(m.chatPrompt || 'Aucune consigne temps réel.')}</div>
        <div class="muted">Sections : ${m.summarySections.map((x) => esc(x.title)).join(', ')}${m.files.length ? ` · ${m.files.length} fichier(s)` : ''}</div></div>
        <div class="actions">${m.id === active ? '' : `<button data-a="activate">Activer</button>`}
          <button data-a="${m.builtin ? 'dup' : 'edit'}">${m.builtin ? 'Dupliquer' : 'Modifier'}</button></div></div></div>`).join('')}`;
  if (editing) renderEditor();
  $('#new').onclick = () => { editing = { name: '', chatPrompt: '', summarySections: [{ title: 'Résumé', prompt: 'Aperçu concis de la conversation.' }], files: [] }; viewModes(); };
  main.onclick = (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const m = state.modes.find((x) => x.id === b.closest('.card').dataset.id);
    if (b.dataset.a === 'activate') api.patchSettings({ activeModeId: m.id });
    else {
      editing = b.dataset.a === 'dup' ? { name: `${m.name} (copie)`, chatPrompt: m.chatPrompt, summarySections: structuredClone(m.summarySections), files: [] } : structuredClone(m);
      viewModes();
      window.scrollTo?.(0, 0); main.scrollTop = 0;
    }
  };
}

function renderEditor() {
  const m = editing;
  $('#editor').innerHTML = `<div class="card"><h3 style="margin-top:0">${m.id ? 'Modifier le mode' : 'Nouveau mode'}</h3>
    <div class="f"><span>Nom</span><input id="m-name" value="${esc(m.name)}"></div>
    <div class="f"><span>Consigne temps réel</span><textarea id="m-chat" rows="3">${esc(m.chatPrompt)}</textarea></div>
    <h3>Plan des notes</h3><div id="secs">${m.summarySections.map(secRow).join('')}</div>
    <button id="add-sec">Ajouter une section</button>
    <h3>Fichiers de référence</h3>${m.files.map((f, i) => `<div class="actions"><span>${esc(f.name)} <span class="muted">(${f.text.length} car.)</span></span><button data-rm="${i}" class="danger">Retirer</button></div>`).join('')}
    <div class="actions" style="margin-top:6px"><button id="add-file">Ajouter un fichier texte</button></div>
    <div class="actions" style="margin-top:16px"><button id="save" class="primary">Enregistrer</button><button id="cancel">Annuler</button>
      ${m.id ? '<button id="delete" class="danger">Supprimer</button>' : ''}</div></div>`;
  const collect = () => {
    m.name = $('#m-name').value.trim();
    m.chatPrompt = $('#m-chat').value;
    m.summarySections = $$('.sec').map((r) => ({ title: $('.s-t', r).value.trim(), prompt: $('.s-p', r).value.trim() })).filter((s) => s.title);
  };
  $('#add-sec').onclick = () => $('#secs').insertAdjacentHTML('beforeend', secRow({ title: '', prompt: '' }));
  $('#secs').onclick = (e) => { if (e.target.dataset.del !== undefined) e.target.closest('.sec').remove(); };
  $$('[data-rm]').forEach((b) => (b.onclick = () => { collect(); m.files.splice(+b.dataset.rm, 1); renderEditor(); }));
  $('#add-file').onclick = async () => {
    collect();
    if (!m.name) { alert('Donne d’abord un nom au mode.'); return; }
    try {
      const saved = m.id ? m : await api.saveMode(m);
      editing = await api.addModeFile(saved.id);
      viewModes();
    } catch (e) { alert(errText(e)); }
  };
  $('#save').onclick = async () => {
    collect();
    if (!m.name) { alert('Le nom est obligatoire.'); return; }
    await api.saveMode(m);
    editing = null;
    viewModes();
  };
  $('#cancel').onclick = () => { editing = null; viewModes(); };
  if ($('#delete')) $('#delete').onclick = async () => { if (confirm('Supprimer ce mode ?')) { await api.deleteMode(m.id); editing = null; viewModes(); } };
}
const secRow = (s) => `<div class="sec"><input class="s-t" placeholder="Titre" value="${esc(s.title)}"><input class="s-p" placeholder="Ce que cette section doit contenir" value="${esc(s.prompt)}"><button data-del class="danger">✕</button></div>`;

// ---------- settings ----------

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const input = (path, type = 'text', extra = '') => `<input data-path="${path}" type="${type}" value="${esc(get(state.settings, path) ?? '')}" ${extra}>`;
const check = (path) => `<input data-path="${path}" type="checkbox" ${get(state.settings, path) ? 'checked' : ''}>`;
const select = (path, opts) => `<select data-path="${path}">${opts.map(([v, l]) => `<option value="${v}" ${get(state.settings, path) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const row = (label, html) => `<label class="f"><span>${label}</span>${html}</label>`;

const ACCEL = {
  Backslash: '\\', Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};
const accelerator = (e) => {
  const key = ACCEL[e.code] ?? e.code.replace(/^Key|^Digit/, '');
  if (/^(Control|Shift|Alt|Meta)/.test(e.code) || !key) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', key].filter(Boolean).join('+');
};

function viewSettings() {
  main.innerHTML = `<h2>Réglages</h2>
    <h3>Intelligence artificielle</h3>
    ${row('Fournisseur', select('ai.provider', [['anthropic', 'Anthropic (clé API)'], ['openai', 'OpenAI ou compatible (Ollama, LM Studio…)'], ['claude-cli', 'Claude Code (CLI)'], ['codex-cli', 'Codex (CLI)']]))}
    ${row('Modèle', input('ai.model'))}${row('Modèle « Smart »', input('ai.smartModel'))}
    ${row('Clé API', input('ai.apiKey', 'password', 'placeholder="vide = variable d’environnement"'))}
    ${row('URL de base (optionnel)', input('ai.baseUrl', 'text', 'placeholder="http://localhost:11434/v1"'))}
    ${row('Mode Smart (réflexion approfondie)', check('smartMode'))}
    <h3>Transcription</h3>
    ${row('URL de base', input('stt.baseUrl'))}${row('Clé API', input('stt.apiKey', 'password'))}${row('Modèle', input('stt.model'))}
    ${row('Langue parlée', select('stt.language', [['auto', 'Détection automatique'], ...LANGUAGES]))}
    <h3>Langue et comportement</h3>
    ${row('Langue des réponses', select('outputLanguage', [['auto', 'Celle de la conversation'], ...LANGUAGES]))}
    ${row('Invisible au partage d’écran', check('invisible'))}
    ${row('Ne pas voler le focus quand invisible', check('noFocusWhenInvisible'))}
    ${row('Masquer cache aussi la pilule', check('hideChatHidesControl'))}
    ${row('Utiliser l’écran', select('screenUse', [['required', 'Joindre une capture à chaque question'], ['off', 'Jamais']]))}
    ${row('Mode ambiant (chat sans session démarrée)', check('ambient'))}
    ${row('Lancer au démarrage de Windows', check('openAtLogin'))}
    <h3>Calendrier</h3>
    ${row('Adresse iCal secrète (.ics)', input('icsUrl', 'text', 'placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"'))}
    <h3>Raccourcis globaux</h3>
    ${Object.entries(SHORTCUT_LABELS).map(([k, l]) => row(l, `<input data-sc="${k}" readonly value="${esc(state.settings.shortcuts[k] ?? '')}" placeholder="Clique puis appuie sur la combinaison">`)).join('')}
    <div class="actions" style="margin-top:12px"><button id="rst-sc">Raccourcis par défaut</button></div>`;

  main.onchange = (e) => {
    const el = e.target.closest('[data-path]');
    if (!el) return;
    const value = el.type === 'checkbox' ? el.checked : el.value;
    const patch = {};
    el.dataset.path.split('.').reduce((o, k, i, a) => (o[k] = i === a.length - 1 ? value : {}), patch);
    api.patchSettings(patch);
  };
  $$('[data-sc]').forEach((el) => {
    el.onfocus = () => api.patchUi({ recordingShortcut: true });
    el.onblur = () => api.patchUi({ recordingShortcut: false });
    el.onkeydown = (e) => {
      e.preventDefault();
      if (e.code === 'Escape') return el.blur();
      const accel = e.code === 'Backspace' || e.code === 'Delete' ? '' : accelerator(e);
      if (accel === null) return;
      el.value = accel;
      api.patchSettings({ shortcuts: { [el.dataset.sc]: accel } });
      el.blur();
    };
  });
  $('#rst-sc').onclick = async () => { await api.patchSettings({ shortcuts: DEFAULT_SHORTCUTS }); viewSettings(); };
}

// ---------- boot ----------

const rec = $('#drec');
rec.onclick = () => (state.session ? api.endSession() : api.startSession());
const onState = (s) => {
  state = s;
  rec.textContent = s.session ? 'Arrêter l’écoute' : 'Démarrer l’écoute';
  const key = JSON.stringify([s.modes.map((m) => [m.id, m.name]), s.settings.activeModeId]);
  if (key !== modesKey && !editing && location.hash.startsWith('#/modes')) viewModes();
  modesKey = key;
};
let modesKey = '';

window.addEventListener('hashchange', route);
api.on('navigate', (h) => { location.hash = h; });
api.on('session-updated', (id) => {
  if (location.hash === `#/session/${id}` || (location.hash.startsWith('#/sessions') || location.hash === '')) route();
});
api.onState(onState);
api.getState().then((s) => { onState(s); route(); });

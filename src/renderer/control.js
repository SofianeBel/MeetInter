const $ = (s) => document.querySelector(s);
const logo = $('#logo'), ask = $('#ask'), rec = $('#rec');
let state;

const render = (s) => {
  state = s;
  ask.textContent = s.ui.showChat ? 'Masquer' : 'Demander';
  rec.classList.toggle('live', !!s.session);
  rec.textContent = s.session ? '■' : '●';
  rec.title = s.session ? 'Arrêter l’écoute' : 'Démarrer l’écoute';
  logo.classList.toggle('me', s.ui.meSpeaking);
  logo.classList.toggle('them', s.ui.themSpeaking && !s.ui.meSpeaking);
};

ask.onclick = () => api.patchUi({ showChat: !state.ui.showChat });
rec.onclick = () => (state.session ? api.endSession() : api.startSession());

logo.onclick = () => api.openDashboard();
// window ignores the mouse outside the notch; take clicks only while hovered
const notch = $('#notch');
notch.onmouseenter = () => api.notchHover(true);
notch.onmouseleave = () => api.notchHover(false);

api.onState(render);
api.getState().then(render);

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

let drag = null;
logo.onpointerdown = (e) => {
  logo.setPointerCapture(e.pointerId);
  drag = { dx: e.screenX - window.screenX, dy: e.screenY - window.screenY, sx: e.screenX, sy: e.screenY, moved: false };
};
logo.onpointermove = (e) => {
  if (!drag) return;
  if (Math.hypot(e.screenX - drag.sx, e.screenY - drag.sy) > 4) drag.moved = true;
  if (drag.moved) api.dragControl({ x: e.screenX - drag.dx, y: e.screenY - drag.dy });
};
logo.onpointerup = () => {
  if (drag && !drag.moved) api.openDashboard();
  drag = null;
};
logo.ondblclick = () => api.resetPosition();

api.onState(render);
api.getState().then(render);

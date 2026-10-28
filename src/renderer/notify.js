const $ = (s) => document.querySelector(s);
let meeting = null;

const render = ({ ui }) => {
  meeting = ui.upcomingMeeting;
  if (!meeting) return;
  $('#title').textContent = meeting.title;
  const min = Math.round((meeting.start - Date.now()) / 60000);
  $('#when').textContent = min > 0 ? `Commence dans ${min} min` : 'Commence maintenant';
  $('#join').hidden = !meeting.url;
};

$('#start').onclick = async () => { await api.startSession(); if (meeting?.url) api.openExternal(meeting.url); };
$('#join').onclick = () => { api.openExternal(meeting.url); api.patchUi({ upcomingMeeting: null }); };
$('#dismiss').onclick = () => api.patchUi({ upcomingMeeting: null });

api.onState(render);
api.getState().then(render);

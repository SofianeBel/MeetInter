import { createSegmenter, encodeWav, SAMPLE_RATE } from '../shared/vad.js';

const seg = { me: createSegmenter(), them: createSegmenter() };
const speaking = { me: false, them: false };
let capture = null;

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

const emit = (role, s) => api.addSegment(role, b64(encodeWav(s.samples)), capture.t0 + s.startMs);

function feed(role, samples) {
  // mute the mic while the others speak, otherwise the speakers feed back into it
  const input = role === 'me' && seg.them.speaking ? new Float32Array(samples.length) : samples;
  for (const s of seg[role].push(input)) emit(role, s);
  if (seg[role].speaking !== speaking[role]) {
    speaking[role] = seg[role].speaking;
    api.patchUi({ [role === 'me' ? 'meSpeaking' : 'themSpeaking']: speaking[role] });
  }
}

async function start() {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const streams = [];
  const tap = (role, stream) => {
    if (capture?.ctx !== ctx) return stream.getTracks().forEach((t) => t.stop()); // session ended while permissions were pending
    if (!stream.getAudioTracks().length) return;
    streams.push(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(node);
    node.connect(ctx.destination);
    node.onaudioprocess = (e) => feed(role, e.inputBuffer.getChannelData(0).slice());
  };
  capture = { ctx, streams, t0: Date.now() };
  try { tap('me', await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })); }
  catch (e) { console.error('micro indisponible :', e.message); }
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    display.getVideoTracks().forEach((t) => t.stop());
    tap('them', display);
  } catch (e) { console.error('son système indisponible :', e.message); }
}

function stop() {
  capture.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  capture.ctx.close();
  capture = null;
  for (const r of ['me', 'them']) { seg[r].flush(); speaking[r] = false; }
}

const onState = (s) => {
  if (s.session && !capture) start();
  else if (!s.session && capture) stop();
};

api.on('audio-flush', () => {
  if (!capture) return;
  for (const r of ['me', 'them']) { const s = seg[r].flush(); if (s) emit(r, s); }
});
api.onState(onState);
api.getState().then(onState);

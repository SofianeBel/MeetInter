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

// video of the chosen window + mic and system sound mixed apart from the VAD path, streamed to main in 3 s chunks
function record(video, streams) {
  const mix = new AudioContext();
  const out = mix.createMediaStreamDestination();
  for (const s of streams) mix.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(out);
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(new MediaStream([video, ...out.stream.getAudioTracks()]), {
    mimeType, videoBitsPerSecond: 4e6, audioBitsPerSecond: 128e3, videoKeyFrameIntervalDuration: 2000,
  });
  let writing = Promise.resolve();
  rec.onstart = () => { writing = api.videoStart(Date.now()); };
  rec.ondataavailable = (e) => {
    writing = writing.then(async () => api.videoChunk(new Uint8Array(await e.data.arrayBuffer()))).catch((err) => console.error('vidéo :', err.message));
  };
  rec.onstop = () => { writing.finally(() => api.videoEnd()); mix.close(); video.stop(); };
  rec.onerror = (e) => console.error('enregistrement vidéo :', e.error?.message);
  video.onended = () => rec.state !== 'inactive' && rec.stop(); // recorded window closed: the session goes on without video
  rec.start(3000);
  return rec;
}

async function start(withVideo) {
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
    const video = withVideo ? { width: { max: 1280 }, height: { max: 720 }, frameRate: { ideal: 60, max: 60 } } : true;
    const display = await navigator.mediaDevices.getDisplayMedia({ video, audio: true });
    const [track] = display.getVideoTracks();
    if (withVideo && capture?.ctx === ctx && track) {
      display.removeTrack(track);
      streams.push(new MediaStream([track]));
      tap('them', display);
      capture.recorder = record(track, streams.filter((s) => s.getAudioTracks().length));
    } else {
      display.getVideoTracks().forEach((t) => t.stop());
      tap('them', display);
    }
  } catch (e) { console.error('son système indisponible :', e.message); }
}

function stop() {
  if (capture.recorder?.state === 'recording') capture.recorder.stop();
  capture.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  capture.ctx.close();
  capture = null;
  for (const r of ['me', 'them']) { seg[r].flush(); speaking[r] = false; }
}

const onState = (s) => {
  if (s.session && !capture) start(s.session.recordVideo);
  else if (!s.session && capture) stop();
};

api.on('audio-flush', () => {
  if (!capture) return;
  if (capture.recorder?.state === 'recording') capture.recorder.stop();
  for (const r of ['me', 'them']) { const s = seg[r].flush(); if (s) emit(r, s); }
});
api.onState(onState);
api.getState().then(onState);

export const SAMPLE_RATE = 16000;
const FRAME = 480; // 30 ms at 16 kHz
const FRAME_MS = 30;

export const rms = (s) => {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / (s.length || 1));
};

const DEFAULTS = {
  startRms: 0.02, endRms: 0.012, // hysteresis: loud to open, only moderately loud to stay open
  preRollMs: 300, silenceMs: 600, maxMs: 20000, minSpeechMs: 400,
};

const concat = (frames) => {
  const out = new Float32Array(frames.length * FRAME);
  frames.forEach((f, i) => out.set(f, i * FRAME));
  return out;
};

// Push arbitrary-length mono 16 kHz samples; push() returns the segments completed by them.
export function createSegmenter(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const preRollFrames = Math.round(o.preRollMs / FRAME_MS);
  const silenceFrames = Math.round(o.silenceMs / FRAME_MS);
  const maxFrames = Math.floor(o.maxMs / FRAME_MS);
  const minFrames = Math.round(o.minSpeechMs / FRAME_MS);

  let pending = new Float32Array(0);
  let ring = [];
  let seg = null; // { frames, first, last, quiet, startFrame }
  let frameNo = 0;

  const close = () => {
    const s = seg;
    seg = null;
    if (s.first === null || s.last - s.first + 1 < minFrames) return null;
    const kept = s.frames.slice(0, s.last + 1 + Math.min(s.quiet, preRollFrames));
    return { samples: concat(kept), startMs: s.startFrame * FRAME_MS, durationMs: kept.length * FRAME_MS };
  };

  const onFrame = (f) => {
    const loud = rms(f) >= (seg ? o.endRms : o.startRms);
    frameNo++;
    if (!seg) {
      if (!loud) { ring.push(f); if (ring.length > preRollFrames) ring.shift(); return null; }
      seg = { frames: [...ring, f], first: ring.length, last: ring.length, quiet: 0, startFrame: frameNo - 1 - ring.length };
      ring = [];
      return null;
    }
    seg.frames.push(f);
    if (loud) { seg.last = seg.frames.length - 1; seg.first ??= seg.last; seg.quiet = 0; } else seg.quiet++;
    if (seg.quiet >= silenceFrames) return close();
    if (seg.frames.length >= maxFrames) {
      const out = close();
      // speech continues: a fresh segment starts right away, without pre-roll
      seg = { frames: [], first: null, last: -1, quiet: 0, startFrame: frameNo };
      return out;
    }
    return null;
  };

  return {
    get speaking() { return seg !== null; },
    push(samples) {
      const buf = new Float32Array(pending.length + samples.length);
      buf.set(pending); buf.set(samples, pending.length);
      const out = [];
      let i = 0;
      for (; i + FRAME <= buf.length; i += FRAME) {
        const r = onFrame(buf.subarray(i, i + FRAME).slice());
        if (r) out.push(r);
      }
      pending = buf.slice(i);
      return out;
    },
    flush() {
      pending = new Float32Array(0);
      const r = seg ? close() : null;
      ring = [];
      return r;
    },
  };
}

export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

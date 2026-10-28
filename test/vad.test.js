import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSegmenter, encodeWav } from '../src/shared/vad.js';

const SR = 16000;
const tone = (ms, amp = 0.2) => Float32Array.from({ length: SR * ms / 1000 }, (_, i) => amp * Math.sin(i / 5));
const silence = (ms) => new Float32Array(SR * ms / 1000);
const feed = (seg, ...chunks) => chunks.flatMap((c) => seg.push(c));

test('silence produces no segment', () => {
  assert.equal(feed(createSegmenter(), silence(3000)).length, 0);
});

test('speech followed by 600 ms of silence yields one segment with pre-roll', () => {
  const out = feed(createSegmenter(), silence(1000), tone(1000), silence(1000));
  assert.equal(out.length, 1);
  assert.ok(out[0].durationMs >= 1000 + 300 && out[0].durationMs <= 1000 + 300 + 300 + 60, `duration ${out[0].durationMs}`);
  assert.equal(out[0].samples.length, out[0].durationMs * 16);
  assert.ok(out[0].startMs >= 600 && out[0].startMs <= 750, `start ${out[0].startMs}`);
});

test('a blip shorter than 400 ms is dropped', () => {
  assert.equal(feed(createSegmenter(), tone(120), silence(1500)).length, 0);
});

test('a pause shorter than 600 ms does not split the segment', () => {
  const out = feed(createSegmenter(), tone(800), silence(300), tone(800), silence(1000));
  assert.equal(out.length, 1);
});

test('a pause of 700 ms splits into two segments', () => {
  assert.equal(feed(createSegmenter(), tone(800), silence(700), tone(800), silence(1000)).length, 2);
});

test('continuous speech is cut at 20 s', () => {
  const out = feed(createSegmenter(), tone(25000), silence(1000));
  assert.equal(out.length, 2);
  assert.ok(out[0].durationMs <= 20000 && out[0].durationMs > 19900);
});

test('hysteresis keeps a quiet tail inside the segment', () => {
  const out = feed(createSegmenter(), tone(500, 0.2), tone(500, 0.02), silence(1000));
  assert.equal(out.length, 1);
  assert.ok(out[0].durationMs >= 900);
});

test('arbitrary chunk sizes give the same result as one chunk', () => {
  const all = Float32Array.from([...silence(500), ...tone(1000), ...silence(1000)]);
  const seg = createSegmenter();
  const out = [];
  for (let i = 0; i < all.length; i += 777) out.push(...seg.push(all.subarray(i, i + 777)));
  assert.equal(out.length, 1);
});

test('flush returns the speech in progress', () => {
  const seg = createSegmenter();
  seg.push(tone(1000));
  assert.equal(seg.flush()?.durationMs >= 900, true);
  assert.equal(seg.flush(), null);
});

test('encodeWav writes a 16 kHz mono PCM16 header', () => {
  const wav = encodeWav(tone(100));
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(wav.length, 44 + 1600 * 2);
});

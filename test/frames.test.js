import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentFrames } from '../src/shared/frames.js';

const f = (at) => ({ at, png: Buffer.from(String(at)) });

test('recent frames keep those younger than 5.5 s, oldest first', () => {
  assert.deepEqual(recentFrames([f(4000), f(1000), f(4400), f(9000)], 9500).map((x) => x.at), [4400, 9000]);
});

test('recent frames keep at most the 5 newest', () => {
  const frames = [5000, 6000, 7000, 8000, 9000, 9900].map(f);
  assert.deepEqual(recentFrames(frames, 10000).map((x) => x.at), [6000, 7000, 8000, 9000, 9900]);
});

test('no frames gives no frames', () => {
  assert.deepEqual(recentFrames([], 10000), []);
});

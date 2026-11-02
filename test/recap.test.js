import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoTime, segmentAt } from '../src/shared/recap.js';

const seg = (relativeMs) => ({ relativeMs });
const lines = [seg(1000), seg(5000), seg(12000)];

test('video time subtracts the recorder start offset', () => {
  assert.equal(videoTime(seg(5000), 800), 4200);
});

test('a segment spoken before the video started maps to 0', () => {
  assert.equal(videoTime(seg(300), 800), 0);
});

test('nothing is current before the first segment', () => {
  assert.equal(segmentAt(lines, 0, 500), -1);
});

test('a time between two segments points at the earlier one', () => {
  assert.equal(segmentAt(lines, 800, 4199), 0);
  assert.equal(segmentAt(lines, 800, 4200), 1);
});

test('a time after the last segment stays on the last one', () => {
  assert.equal(segmentAt(lines, 800, 60000), 2);
});

test('an empty transcript has no current segment', () => {
  assert.equal(segmentAt([], 800, 1000), -1);
});

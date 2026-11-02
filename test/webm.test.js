import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeSeekable } from '../src/main/webm.js';

const hex = (s) => Buffer.from(s.replace(/\s/g, ''), 'hex');
const el = (id, ...body) => { const b = Buffer.concat(body); return Buffer.concat([hex(id), Buffer.from([0x80 | b.length]), b]); };
const unknown = (id) => Buffer.concat([hex(id), hex('01ffffffffffffff')]);
const block = (track, rel, key = true) => { const b = Buffer.alloc(4); b[0] = 0x80 | track; b.writeInt16BE(rel, 1); b[3] = key ? 0x80 : 0; return el('a3', b, Buffer.from('frame')); };

// what MediaRecorder writes: unknown-size Segment and Clusters, no Duration, no Cues
const live = Buffer.concat([
  el('1a45dfa3', el('4282', Buffer.from('webm'))),
  unknown('18538067'),
  el('1549a966', el('2ad7b1', hex('0f4240'))),
  el('1654ae6b', el('ae', el('d7', hex('01')), el('83', hex('02'))), el('ae', el('d7', hex('02')), el('83', hex('01')))),
  unknown('1f43b675'), el('e7', hex('00')), block(1, 0), block(2, 33),
  unknown('1f43b675'), el('e7', hex('07d0')), block(2, 0), block(1, 500),
  unknown('1f43b675'), el('e7', hex('0bb8')), block(1, 0), block(2, 40, false),
  hex('a3 85 81 00'), // truncated tail of a crash
]);

const segmentStart = (buf) => buf.indexOf(hex('18538067')) + 12;
const u64After = (buf, idHex) => {
  const out = [];
  for (let i = buf.indexOf(hex(idHex)); i >= 0; i = buf.indexOf(hex(idHex), i + 1)) out.push(Number(buf.readBigUInt64BE(i + idHex.length / 2 + 8)));
  return out;
};

test('a live WebM gets a duration and cues on the video keyframe of each cluster', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mi-')), 'x.webm');
  fs.writeFileSync(file, live);
  await makeSeekable(file);
  const out = fs.readFileSync(file);
  const d = out.indexOf(hex('4489 0100000000000008'));
  assert.equal(out.readDoubleBE(d + 10), 3040);
  const s = segmentStart(out);
  const positions = u64After(out, 'f1');
  assert.equal(positions.length, 2, 'no cue for the cluster without a video keyframe');
  for (const p of positions) assert.equal(out.readUInt32BE(s + p), 0x1f43b675);
  assert.deepEqual(u64After(out, 'b3'), [33, 2000], 'cue time = keyframe time');
  assert.deepEqual(u64After(out, 'f7'), [2, 2], 'video track only');
  assert.equal(out.indexOf(hex('a3 85 81 00')), -1, 'truncated tail dropped');
  const cuesAt = u64After(out, '53ac')[2];
  assert.equal(out.readUInt32BE(s + cuesAt), 0x1c53bb6b, 'SeekHead points at Cues');
});

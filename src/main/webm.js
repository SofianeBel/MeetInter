import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

// MediaRecorder writes a live WebM: no Duration, no Cues, so players can neither show the length nor seek fast.
// makeSeekable rewrites it as EBML header + Segment(SeekHead, Info + Duration, Tracks, Clusters…, Cues).

const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, Duration: 0x4489, Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, Cluster: 0x1f43b675,
  Timecode: 0xe7, SimpleBlock: 0xa3, Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7,
  CueTrack: 0xf7, CueClusterPosition: 0xf1,
};
const TOP = new Set([ID.SeekHead, ID.Info, ID.Tracks, ID.Cluster, ID.Cues, 0x1254c367, 0x1941a469, 0x1043a770]); // + Tags, Attachments, Chapters

const vlen = (byte) => Math.clz32(byte) - 23; // 1..8, 9 = invalid
const uint = (b) => b.reduce((n, x) => n * 256 + x, 0);

function reader(fh) {
  let buf = Buffer.alloc(0), start = 0;
  return async (pos, n) => {
    if (pos < start || pos + n > start + buf.length) {
      buf = Buffer.alloc(Math.max(n, 1 << 20));
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      buf = buf.subarray(0, bytesRead);
      start = pos;
    }
    return buf.subarray(pos - start, pos - start + n);
  };
}

// element header at pos → { id, pos, size (null = unknown), data, end } or null when truncated
async function header(read, pos) {
  const b = await read(pos, 12);
  const il = vlen(b[0] ?? 0), sl = vlen(b[il] ?? 0);
  if (il > 4 || sl > 8 || b.length < il + sl) return null;
  let size = b[il] & (0xff >> sl), unknown = size === 0xff >> sl;
  for (let k = 1; k < sl; k++) { size = size * 256 + b[il + k]; unknown &&= b[il + k] === 0xff; }
  const data = pos + il + sl;
  return { id: uint(b.subarray(0, il)), pos, size: unknown ? null : size, data, end: unknown ? null : data + size };
}

async function* children(read, from, to) {
  for (let p = from; p < to;) {
    const e = await header(read, p);
    if (!e || e.end == null || e.end > to) return;
    yield e;
    p = e.end;
  }
}

const idBytes = (id) => Buffer.from(id.toString(16).padStart(id > 0xffffff ? 8 : id > 0xffff ? 6 : id > 0xff ? 4 : 2, '0'), 'hex');
const el = (id, ...payload) => {
  const body = Buffer.concat(payload), size = Buffer.alloc(8);
  size.writeBigUInt64BE(BigInt(body.length) | (1n << 56n)); // 8-byte size vint
  return Buffer.concat([idBytes(id), size, body]);
};
const u64 = (id, n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return el(id, b); };
const f64 = (id, x) => { const b = Buffer.alloc(8); b.writeDoubleBE(x); return el(id, b); };

export async function makeSeekable(file) {
  const fh = await fs.promises.open(file, 'r');
  let head, cues, from, to;
  try {
    const { size: eof } = await fh.stat();
    const read = reader(fh);
    const ebml = await header(read, 0);
    const seg = ebml?.id === ID.EBML && await header(read, ebml.end);
    if (seg?.id !== ID.Segment) throw new Error('pas un fichier WebM');
    const segEnd = Math.min(eof, seg.end ?? eof);

    let info, tracks, video, duration = 0;
    const clusters = [];
    for (let p = seg.data; p < segEnd;) {
      const e = await header(read, p);
      if (!e) break;
      if (e.id !== ID.Cluster) {
        if (clusters.length || e.end == null || e.end > segEnd) break;
        if (e.id === ID.Info) info = e;
        if (e.id === ID.Tracks) {
          tracks = e;
          for await (const t of children(read, e.data, e.end)) {
            const f = {};
            if (t.id === ID.TrackEntry) for await (const x of children(read, t.data, t.end)) f[x.id] = uint(await read(x.data, x.size));
            if (f[ID.TrackType] === 1) video = f[ID.TrackNumber];
          }
        }
        p = e.end;
        continue;
      }
      const c = { pos: p, time: 0, key: null };
      p = e.data;
      // a live cluster has unknown size: it ends at the next top-level element; a truncated tail is dropped
      for (const limit = e.end ?? segEnd; p < limit;) {
        const x = await header(read, p);
        if (!x || x.end == null || x.end > limit || TOP.has(x.id)) break;
        if (x.id === ID.Timecode) c.time = uint(await read(x.data, x.size));
        if (x.id === ID.SimpleBlock) {
          const b = await read(x.data, 12), n = vlen(b[0]);
          const t = c.time + b.readInt16BE(n);
          duration = Math.max(duration, t);
          if (c.key == null && b[n + 2] & 0x80 && (b[0] & 0x7f) === video) c.key = t;
        }
        p = x.end;
      }
      clusters.push(c);
      to = p;
    }
    if (!info || !tracks || video == null || !clusters.length) throw new Error('WebM incomplet');
    from = clusters[0].pos;

    const whole = async (e) => Buffer.from(await read(e.pos, e.end - e.pos));
    const infoKids = [];
    for await (const x of children(read, info.data, info.end)) if (x.id !== ID.Duration) infoKids.push(await whole(x));

    const infoEl = el(ID.Info, ...infoKids, f64(ID.Duration, duration));
    const tracksEl = await whole(tracks);
    const seek = (id, pos) => el(ID.Seek, el(ID.SeekID, idBytes(id)), u64(ID.SeekPosition, pos));
    const seekLen = el(ID.SeekHead, seek(ID.Info, 0), seek(ID.Tracks, 0), seek(ID.Cues, 0)).length;
    const shift = seekLen + infoEl.length + tracksEl.length - from; // new segment-relative pos = old absolute pos + shift
    // one cue per cluster holding a video keyframe, at that keyframe: the demuxer skips to it, so decoding starts clean
    cues = el(ID.Cues, ...clusters.filter((c) => c.key != null).map((c) => el(ID.CuePoint, u64(ID.CueTime, c.key),
      el(ID.CueTrackPositions, u64(ID.CueTrack, video), u64(ID.CueClusterPosition, c.pos + shift)))));
    const cuesPos = to + shift;
    const body = Buffer.concat([
      el(ID.SeekHead, seek(ID.Info, seekLen), seek(ID.Tracks, seekLen + infoEl.length), seek(ID.Cues, cuesPos)), infoEl, tracksEl,
    ]);
    // Segment size stays unknown: its live clusters have unknown sizes, which a sized parent forbids
    head = Buffer.concat([await read(0, ebml.end), idBytes(ID.Segment), Buffer.from('01ffffffffffffff', 'hex'), body]);
  } finally { await fh.close(); }

  const tmp = `${file}.tmp`;
  const out = fs.createWriteStream(tmp);
  out.write(head);
  if (to > from) await pipeline(fs.createReadStream(file, { start: from, end: to - 1 }), out, { end: false });
  await new Promise((res, rej) => out.end(cues, (e) => (e ? rej(e) : res())));
  await fs.promises.rename(tmp, file);
}

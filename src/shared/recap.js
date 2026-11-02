// Position (ms) of a transcript segment in the session video; offsetMs = recorder start - session start.
export const videoTime = (seg, offsetMs) => Math.max(0, seg.relativeMs - offsetMs);

// Index of the segment playing at video time `ms` (segments sorted by time), -1 before the first one.
export function segmentAt(segments, offsetMs, ms) {
  let i = -1;
  while (i + 1 < segments.length && videoTime(segments[i + 1], offsetMs) <= ms) i++;
  return i;
}

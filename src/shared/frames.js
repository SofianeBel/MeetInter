// What the AI sees of the last 5 seconds: frames are { at, png }, one per second.
export const recentFrames = (frames, now) => frames.filter((f) => now - f.at < 5500).sort((a, b) => a.at - b.at).slice(-5);

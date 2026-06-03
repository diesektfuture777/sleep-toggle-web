// wav.js — pure, dependency-free audio helpers (node-testable, no browser globals)

// channels: array of Float32Array (one per channel), all the same length.
// Returns a Uint8Array of 16-bit PCM WAV bytes.
export function encodeWAV(channels, sampleRate) {
  const numCh = channels.length;
  const numFrames = channels[0].length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataLen = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);

  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);            // fmt chunk size
  view.setUint16(20, 1, true);             // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);

  let off = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      s = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(off, s, true);
      off += 2;
    }
  }
  return new Uint8Array(buffer);
}

// Render the source as (loop + fade) seconds, then equal-power crossfade the
// tail `fade` region back over the head. Returns channels of length
// (input length - fade samples) that loop seamlessly.
export function crossfadeLoop(channels, sampleRate, fadeSec) {
  const fade = Math.floor(fadeSec * sampleRate);
  if (fade <= 0) return channels;
  const total = channels[0].length;
  const outLen = total - fade;
  return channels.map((data) => {
    const out = new Float32Array(outLen);
    out.set(data.subarray(0, outLen));
    for (let i = 0; i < fade; i++) {
      const t = i / fade;                        // 0..1
      const wHead = Math.cos((t * Math.PI) / 2); // 1 -> 0
      const wTail = Math.sin((t * Math.PI) / 2); // 0 -> 1
      out[i] = out[i] * wHead + data[outLen + i] * wTail;
    }
    return out;
  });
}

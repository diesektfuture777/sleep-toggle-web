import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWAV, crossfadeLoop } from '../wav.js';

const str = (bytes, off, len) =>
  String.fromCharCode(...bytes.subarray(off, off + len));
const u32 = (bytes, off) =>
  bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24);
const u16 = (bytes, off) => bytes[off] | (bytes[off + 1] << 8);

test('encodeWAV writes a valid stereo 16-bit PCM header', () => {
  const left = new Float32Array([0, 0.5, -0.5, 1]);
  const right = new Float32Array([0, -0.5, 0.5, -1]);
  const bytes = encodeWAV([left, right], 44100);

  assert.equal(str(bytes, 0, 4), 'RIFF');
  assert.equal(str(bytes, 8, 4), 'WAVE');
  assert.equal(str(bytes, 12, 4), 'fmt ');
  assert.equal(u16(bytes, 20), 1, 'format = PCM');
  assert.equal(u16(bytes, 22), 2, 'channels = 2');
  assert.equal(u32(bytes, 24), 44100, 'sample rate');
  assert.equal(u16(bytes, 34), 16, 'bits per sample');
  assert.equal(str(bytes, 36, 4), 'data');
  // 4 frames * 2 channels * 2 bytes = 16 bytes of data
  assert.equal(u32(bytes, 40), 16);
  assert.equal(bytes.length, 44 + 16);
});

test('encodeWAV clamps and quantizes a full-scale sample', () => {
  const bytes = encodeWAV([new Float32Array([1])], 8000); // mono, one frame
  const lo = bytes[44], hi = bytes[45];
  const val = (hi << 8) | lo;
  assert.equal(val, 0x7fff);
});

test('crossfadeLoop trims the fade region and stays in range', () => {
  const sr = 1000;
  const fadeSec = 0.01; // 10 samples
  const total = 100;
  const data = new Float32Array(total);
  for (let i = 0; i < total; i++) data[i] = Math.sin(i / 5);

  const [out] = crossfadeLoop([data], sr, fadeSec);
  assert.equal(out.length, total - 10, 'output is shortened by the fade length');
  for (const v of out) assert.ok(v >= -1 && v <= 1, 'samples stay in [-1, 1]');
});

test('crossfadeLoop with zero fade returns channels unchanged', () => {
  const data = new Float32Array([0.1, 0.2, 0.3]);
  const [out] = crossfadeLoop([data], 1000, 0);
  assert.equal(out, data, 'zero fade returns the same channel array unchanged');
});

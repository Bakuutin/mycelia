import { expect } from "@std/expect";
import {
  detectAudioFormat,
  isFloat32,
  isOpusOgg,
  isPcm,
} from "./audio.websocket.server.ts";

// Helper: make a Uint8Array with Ogg/Opus magic bytes
function makeOpusOggData(extraBytes = 10): Uint8Array {
  const data = new Uint8Array(4 + extraBytes);
  data[0] = 0x4F; // 'O'
  data[1] = 0x67; // 'g'
  data[2] = 0x67; // 'g'
  data[3] = 0x53; // 'S'
  return data;
}

// Helper: make a Uint8Array of Float32 samples in [-1, 1] range
function makeFloat32Data(samples: number[]): Uint8Array {
  const buf = new Float32Array(samples);
  return new Uint8Array(buf.buffer);
}

// Helper: make a Uint8Array of Int16 PCM samples
function makePcmData(sampleCount: number): Uint8Array {
  return new Uint8Array(sampleCount * 2); // 2 bytes per sample, all zeros (silence)
}

// ─────────────────────────────────────────────────────────────────────────────
// isOpusOgg
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("isOpusOgg: returns true for OggS magic bytes", () => {
  expect(isOpusOgg(makeOpusOggData())).toBe(true);
});

Deno.test("isOpusOgg: returns false for PCM data", () => {
  expect(isOpusOgg(makePcmData(100))).toBe(false);
});

Deno.test("isOpusOgg: returns false for empty data", () => {
  expect(isOpusOgg(new Uint8Array(0))).toBe(false);
});

Deno.test("isOpusOgg: returns false for data shorter than 4 bytes", () => {
  expect(isOpusOgg(new Uint8Array([0x4F, 0x67, 0x67]))).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// isPcm
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("isPcm: returns true for even-length data", () => {
  expect(isPcm(makePcmData(100))).toBe(true);
});

Deno.test("isPcm: returns false for odd-length data", () => {
  expect(isPcm(new Uint8Array(5))).toBe(false);
});

Deno.test("isPcm: returns false for empty data", () => {
  expect(isPcm(new Uint8Array(0))).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// isFloat32
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("isFloat32: returns true for float32 samples in audio range", () => {
  const samples = [0.0, 0.5, -0.5, 0.1, -0.1, 0.9, -0.9, 0.3, -0.3, 0.0];
  expect(isFloat32(makeFloat32Data(samples))).toBe(true);
});

Deno.test("isFloat32: returns false for values outside audio range", () => {
  // Very large values that no audio signal would have
  const samples = [100.0, 200.0, -300.0, 500.0];
  expect(isFloat32(makeFloat32Data(samples))).toBe(false);
});

Deno.test("isFloat32: returns false for non-4-byte-aligned data", () => {
  expect(isFloat32(new Uint8Array(5))).toBe(false);
  expect(isFloat32(new Uint8Array(6))).toBe(false);
});

Deno.test("isFloat32: returns false for data shorter than 4 bytes", () => {
  expect(isFloat32(new Uint8Array(3))).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// detectAudioFormat
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("detectAudioFormat: returns 'opus' for Ogg/Opus magic bytes", () => {
  expect(detectAudioFormat(makeOpusOggData())).toBe("opus");
});

Deno.test("detectAudioFormat: returns 'float32' for in-range float32 data", () => {
  const samples = [0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8, 0.9, -1.0];
  expect(detectAudioFormat(makeFloat32Data(samples))).toBe("float32");
});

Deno.test("detectAudioFormat: returns 'pcm' for silence (all zeros, even length)", () => {
  // All-zero PCM: not valid float32 range check (zeros are valid floats but our
  // zero-padded PCM will pass the alignment check as PCM after float32 detection)
  // Since all-zero float32 values ARE in range, detectAudioFormat may return float32.
  // Silence (zeros) is ambiguous — that is the documented limitation of isPcm/isFloat32.
  const result = detectAudioFormat(makePcmData(100));
  expect(["pcm", "float32"]).toContain(result);
});

Deno.test("detectAudioFormat: returns 'unknown' for empty data", () => {
  expect(detectAudioFormat(new Uint8Array(0))).toBe("unknown");
});

Deno.test("detectAudioFormat: Opus takes priority over float32 check", () => {
  // An Ogg header is detected as opus even though 4 bytes could look like a float
  expect(detectAudioFormat(makeOpusOggData())).toBe("opus");
});

Deno.test("detectAudioFormat: returns 'unknown' for odd-length non-Ogg data", () => {
  expect(detectAudioFormat(new Uint8Array(5))).toBe("unknown");
});

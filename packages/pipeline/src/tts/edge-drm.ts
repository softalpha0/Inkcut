import { randomBytes } from "node:crypto";

/**
 * Sec-MS-GEC v2 token for Microsoft Edge's read-aloud voices.
 *
 * Microsoft replaced the plain SHA-256 token in October 2026; the old one now
 * gets HTTP 200/403 instead of a WebSocket. This is a port of drm.py from the
 * Python `edge-tts` 7.3.1 package (rany2/edge-tts), which reverse-engineered
 * the new format: "<CS64 16 hex>-<SHA-256 variant 64 hex>". All arithmetic is
 * modulo 2^32, so 32-bit integer maths matches Python's big integers.
 */

export const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
export const SEC_MS_GEC_VERSION = "2-143.0.3650.75";

const WIN_EPOCH = 11_644_473_600;

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
];
const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6, 0xf0c31573,
  0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564,
];
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];
const SHA256_ADJUSTMENT = 0xc9dc06a7;
const K_FIRST_BLOCK = K.map((k, i) => (i === 14 ? SHA256_ADJUSTMENT : k));
const SIGMA0_ADJUSTMENT = 0x059c0b80;
const SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS: [number, number][] = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

const u32 = (x: number): number => x >>> 0;
const mul = (a: number, b: number): number => Math.imul(a, b) >>> 0;
const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;
const rol16 = (x: number): number => rotr(x, 16);
const sigma0 = (x: number): number => u32(rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3));
const sigma1 = (x: number): number => u32(rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10));

function expandSchedule(words: number[], firstWord = 16): void {
  for (let i = firstWord; i < 64; i++) {
    words.push(u32(sigma1(words[i - 2]!) + words[i - 7]! + sigma0(words[i - 15]!) + words[i - 16]!));
  }
}

function rounds(state: number[], words: number[], firstRound = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state as [number, number, number, number, number, number, number, number];
  const constants = firstRound === 14 ? K_FIRST_BLOCK : K;
  for (let i = firstRound; i < 64; i++) {
    const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = g ^ (e & (f ^ g));
    const t1 = u32(h + u32(s1) + u32(ch) + constants[i]! + words[i]!);
    const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) | (c & (a | b));
    const t2 = u32(u32(s0) + u32(maj));
    h = g;
    g = f;
    f = e;
    e = u32(d + t1);
    d = c;
    c = b;
    b = a;
    a = u32(t1 + t2);
  }
  return [a, b, c, d, e, f, g, h];
}

function addState(x: number[], y: number[]): number[] {
  return x.map((v, i) => u32(v + y[i]!));
}

/** State after the hidden first block, which ends with the first 7 bytes of data. */
function sha256Init(data: Uint8Array): number[] {
  const words: number[] = new Array<number>(14).fill(0);
  words.push((data[0]! << 16) | (data[1]! << 8) | data[2]!);
  words.push(u32((data[3]! << 24) | (data[4]! << 16) | (data[5]! << 8) | data[6]!));
  for (let i = 16; i < 30; i++) {
    let value = SHA256_SCHEDULE[i - 16]!;
    if (i - 2 >= 14) {
      const s = sigma1(words[i - 2]!);
      value += i === 16 ? u32(s ^ SIGMA1_ADJUSTMENT) : s;
    }
    if (i - 7 >= 14) value += words[i - 7]!;
    if (i - 15 >= 14) {
      const s = sigma0(words[i - 15]!);
      value += i === 29 ? u32(s ^ SIGMA0_ADJUSTMENT) : s;
    }
    words.push(u32(value));
  }
  words.push(
    u32(sigma1(words[28]!) + words[23]! + sigma0(words[15]!) + words[14]! + SHA256_ADJUSTMENT - K[14]!),
  );
  expandSchedule(words, 31);
  return addState(SHA256_INITIAL, rounds(SHA256_STATE, words, 14));
}

export function sha256Variant(data: Uint8Array): Uint8Array {
  if (data.length < 7) throw new Error("Token salt must contain at least seven bytes");
  const length = 57 + data.length;
  const zeros = (((55 - length) % 64) + 64) % 64;
  const padded = new Uint8Array(data.length - 7 + 1 + zeros + 8);
  padded.set(data.subarray(7));
  padded[data.length - 7] = 0x80;
  const view = new DataView(padded.buffer);
  view.setBigUint64(padded.length - 8, BigInt(length * 8));
  let state = sha256Init(data);
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let i = 0; i < 16; i++) words.push(view.getUint32(offset + i * 4));
    expandSchedule(words);
    state = addState(state, rounds(state, words));
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  state.forEach((v, i) => outView.setUint32(i * 4, v));
  return out;
}

/** Little-endian 32-bit words, zero-padded to an even count. */
function wordsLe4Even(data: Uint8Array): number[] {
  const padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
  padded.set(data);
  const view = new DataView(padded.buffer);
  const words: number[] = [];
  for (let i = 0; i < padded.length; i += 4) words.push(view.getUint32(i, true));
  if (words.length % 2) words.push(0);
  return words;
}

export function cs64Digest(data: Uint8Array, digest: Uint8Array): [number, number] {
  const dv = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const keyA = u32(dv.getUint32(0, true) | 1);
  const keyB = u32(dv.getUint32(4, true) | 1);
  const factors = [mul(keyA, CS64_FACTOR), mul(keyB, CS64_FACTOR)];
  const terms = CS64_COEFFICIENTS.map(([coefficient], i) => mul(coefficient, factors[i % 2]!));
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);
  const prefixed = new Uint8Array(data.length + 1);
  prefixed.set(data, 1);
  wordsLe4Even(prefixed).forEach((word, i) => {
    let term = mul(word, i % 2 === 0 ? keyA : keyB);
    let offset = mul(rol16(word), i % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (i === 0) {
      term = u32(term + mul(CS64_ADJUSTMENT0, factors[0]!));
      offset = u32(offset + CS64_ADJUSTMENT1);
    }
    terms.push(term);
    offsets.push(offset);
  });

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i]!;
    const y = terms[i + 1]!;
    let t = rol16(u32(offsets[i]! + x));
    let q = mul(t, 0x76f50f34);
    swapAcc = u32(swapAcc + u32(mul(rol16(q), 0xc3efea97) + q));
    t = rol16(u32(offsets[i + 1]! + y));
    q = mul(t, 0x1881ce3c);
    swapLast = u32(mul(rol16(q), 0x35bd1ec9) + q);
    swapAcc = u32(swapAcc + swapLast);

    state = u32(mul(state, keyA) + x);
    state = mul(rol16(state), 0xcf98b111);
    state = mul(rol16(state), 0x87085b9f);
    state = mul(rol16(state), 0x12ceb96d);
    state = mul(rol16(state), 0x257e1d83);
    acc = u32(acc + state);
    t = u32(mul(state, keyB) + y);
    t = mul(rol16(t), 0xa27416f5);
    t = mul(rol16(t), 0xd38396ff);
    state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = u32(acc + state);
  }
  return [u32(swapLast ^ state), u32(swapAcc ^ acc)];
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

/** The token for a Unix time in seconds (it changes every five minutes). */
export function generateSecMsGec(unixSeconds: number): string {
  let ticks = Math.floor(unixSeconds) + WIN_EPOCH;
  ticks -= ticks % 300;
  // Windows file time in 100 ns units; exact as a BigInt string.
  const fileTime = (BigInt(ticks) * 10_000_000n).toString();
  const data = new TextEncoder().encode(`${fileTime}${TRUSTED_CLIENT_TOKEN}`);
  const digest = sha256Variant(data);
  const [lo, hi] = cs64Digest(data, digest);
  const cs = new Uint8Array(8);
  const view = new DataView(cs.buffer);
  view.setUint32(0, lo, true);
  view.setUint32(4, hi, true);
  return `${hex(cs)}-${hex(digest)}`;
}

/** Random 32-hex-digit machine id sent as the muid cookie. */
export function generateMuid(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

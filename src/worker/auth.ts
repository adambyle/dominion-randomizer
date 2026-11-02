// Password hashing (PBKDF2-SHA256 via WebCrypto) and session tokens.
//
// Accounts only guard game history, so hashing is kept cheap: 2,000 iterations measured about 1.5 ms
// of CPU (10,000 was about 6 ms), well inside the Workers Free plan's 10 ms per request. The
// iteration count is stored with each hash, and sign-in re-hashes old passwords at the current count.

export const PBKDF2_ITERATIONS = 2_000;
const KEY_BITS = 256;

const enc = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomId(bytes = 16): string {
  return toBase64(randomBytes(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<PasswordHash> {
  const salt = randomBytes(16);
  return { hash: toBase64(await derive(password, salt, iterations)), salt: toBase64(salt), iterations };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const actual = await derive(password, fromBase64(stored.salt), stored.iterations);
  return timingSafeEqual(actual, fromBase64(stored.hash));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Session tokens are random; only their SHA-256 is stored, so a database leak can't be replayed. */
export async function sha256(text: string): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

export const SESSION_COOKIE = "dr_session";
export const SESSION_DAYS = 60;

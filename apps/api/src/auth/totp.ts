import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of s.toUpperCase().replace(/=+$/, '')) { const i = ALPHABET.indexOf(c); if (i < 0) throw new Error('bad base32'); value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

/** RFC 4226 HOTP (6 digits, HMAC-SHA1). */
export function hotp(secret: Buffer, counter: number): string {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(c).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, '0');
}
export const newTotpSecret = () => base32Encode(randomBytes(20));
export const otpauthUrl = (secret: string, account: string, issuer = 'LeadDesk') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** RFC 6238 with ±1 step of clock drift. Returns the matched time step (so a code can be used once) or null. */
export function verifyTotp(secretBase32: string, code: string, nowMs: number, lastStep = 0): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32); const step = Math.floor(nowMs / 30_000);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastStep) continue; // replay: never accept a step at or before the last one used
    const want = Buffer.from(hotp(secret, s)), got = Buffer.from(code);
    if (want.length === got.length && timingSafeEqual(want, got)) return s;
  }
  return null;
}

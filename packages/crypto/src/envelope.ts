import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KeyService } from './key-service';

export interface SealedSecret {
  /** nonce(12) || tag(16) || ciphertext */
  ciphertext: Buffer;
  wrappedDek: Buffer;
  keyRef: string;
  /** Non-sensitive display hint, e.g. "••••1234". */
  hint: string;
}

export interface SecretContext { tenantId: string; connectionId: string }

const ctxOf = (c: SecretContext) => ({ tenantId: c.tenantId, connectionId: c.connectionId });
const aad = (c: SecretContext) => Buffer.from(`${c.tenantId}:${c.connectionId}`);

/** Accepts a Buffer or a BSON Binary (what lean() returns for Buffer fields). */
export function asBuffer(x: any): Buffer {
  if (Buffer.isBuffer(x)) return x;
  if (x?.buffer instanceof Uint8Array) return Buffer.from(x.buffer.subarray(0, x.position ?? x.buffer.length));
  if (x instanceof Uint8Array) return Buffer.from(x);
  throw new TypeError('Expected binary data');
}

export function makeHint(plaintext: string): string {
  return plaintext.length <= 4 ? '••••' : `••••${plaintext.slice(-4)}`;
}

/** Envelope encryption: fresh DEK per secret, AES-256-GCM, DEK wrapped by KeyService. */
export async function sealSecret(keys: KeyService, ctx: SecretContext, plaintext: string): Promise<SealedSecret> {
  const dek = randomBytes(32);
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dek, nonce);
  c.setAAD(aad(ctx));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  const wrappedDek = await keys.wrap(dek, ctxOf(ctx));
  dek.fill(0);
  return {
    ciphertext: Buffer.concat([nonce, c.getAuthTag(), ct]),
    wrappedDek,
    keyRef: keys.keyRef,
    hint: makeHint(plaintext),
  };
}

export async function openSecret(keys: KeyService, ctx: SecretContext, sealed: { ciphertext: unknown; wrappedDek: unknown }): Promise<string> {
  const dek = await keys.unwrap(asBuffer(sealed.wrappedDek), ctxOf(ctx));
  try {
    const blob = asBuffer(sealed.ciphertext);
    const nonce = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const ct = blob.subarray(28);
    const d = createDecipheriv('aes-256-gcm', dek, nonce);
    d.setAAD(aad(ctx));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/** Re-encrypt under a new KEK without touching the ciphertext. */
export async function rewrapDek(from: KeyService, to: KeyService, ctx: SecretContext, wrappedDek: Buffer): Promise<Buffer> {
  const dek = await from.unwrap(wrappedDek, ctxOf(ctx));
  try { return await to.wrap(dek, ctxOf(ctx)); } finally { dek.fill(0); }
}

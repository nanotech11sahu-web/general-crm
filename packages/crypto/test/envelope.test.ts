import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { LocalKeyService, openSecret, rewrapDek, sealSecret } from '../src';

const ctx = { tenantId: 't1', connectionId: 'c1' };
const keys = () => new LocalKeyService(randomBytes(32));

describe('envelope encryption', () => {
  it('round-trips and produces a hint', async () => {
    const k = keys();
    const s = await sealSecret(k, ctx, 'super-secret-token-1234');
    expect(s.hint).toBe('••••1234');
    expect(s.ciphertext.toString('utf8')).not.toContain('super-secret');
    expect(await openSecret(k, ctx, s)).toBe('super-secret-token-1234');
  });
  it('uses a unique nonce/DEK each time', async () => {
    const k = keys();
    const a = await sealSecret(k, ctx, 'x'.repeat(10));
    const b = await sealSecret(k, ctx, 'x'.repeat(10));
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });
  it('fails under another tenant/connection context (AAD binding)', async () => {
    const k = keys();
    const s = await sealSecret(k, ctx, 'abcd1234');
    await expect(openSecret(k, { tenantId: 't2', connectionId: 'c1' }, s)).rejects.toThrow();
    await expect(openSecret(k, { tenantId: 't1', connectionId: 'c2' }, s)).rejects.toThrow();
  });
  it('detects tampering', async () => {
    const k = keys();
    const s = await sealSecret(k, ctx, 'abcd1234');
    s.ciphertext[s.ciphertext.length - 1] ^= 1;
    await expect(openSecret(k, ctx, s)).rejects.toThrow();
  });
  it('opens secrets that come back from Mongo as BSON Binary', async () => {
    const k = keys();
    const s = await sealSecret(k, ctx, 'binary-1234');
    const asBinary = (b: Buffer) => ({ buffer: new Uint8Array(b), position: b.length });
    expect(await openSecret(k, ctx, { ciphertext: asBinary(s.ciphertext), wrappedDek: asBinary(s.wrappedDek) })).toBe('binary-1234');
  });
  it('supports KEK rotation by rewrapping the DEK', async () => {
    const a = keys(), b = keys();
    const s = await sealSecret(a, ctx, 'rotate-me-9999');
    const wrapped = await rewrapDek(a, b, ctx, s.wrappedDek);
    expect(await openSecret(b, ctx, { ciphertext: s.ciphertext, wrappedDek: wrapped })).toBe('rotate-me-9999');
    await expect(openSecret(a, ctx, { ciphertext: s.ciphertext, wrappedDek: wrapped })).rejects.toThrow();
  });
});

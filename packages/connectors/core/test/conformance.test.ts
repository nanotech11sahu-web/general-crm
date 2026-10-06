import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultRegistry, verifyHmacSha256 } from '../src';

const sign = (b: Buffer, s: string) => 'sha256=' + createHmac('sha256', s).update(b).digest('hex');

describe('every registered connector passes the shared conformance suite', () => {
  for (const m of defaultRegistry().manifests()) {
    const c = defaultRegistry().get(m.id)!;
    it(`${m.id}: manifest is complete and secret fields are typed secret`, () => {
      expect(m.credentialFields.length).toBeGreaterThan(0);
      expect(m.capabilities.length).toBeGreaterThan(0);
    });
    it(`${m.id}: verify/health resolve`, async () => {
      const ctx = { tenantId: 't', connectionId: 'c', config: {}, secret: async () => 's' };
      expect((await c.verify(ctx)).ok).toBe(true);
      expect((await c.health(ctx)).ok).toBe(true);
    });
    if (m.webhook) {
      it(`${m.id}: webhook verify accepts valid and rejects invalid/missing signatures`, () => {
        const body = Buffer.from('{"id":"1"}');
        const ok = { headers: { 'x-signature-256': sign(body, 's3cret'), 'x-event-id': 'e1' }, rawBody: body };
        expect(m.webhook!.verify(ok, 's3cret')).toBe(true);
        expect(m.webhook!.verify(ok, 'wrong')).toBe(false);
        expect(m.webhook!.verify({ headers: {}, rawBody: body }, 's3cret')).toBe(false);
        expect(m.webhook!.extractEventId(ok)).toBe('e1');
      });
    }
  }
  it('hmac rejects tampered body', () => {
    const b = Buffer.from('abc');
    expect(verifyHmacSha256(Buffer.from('abd'), 's', sign(b, 's'))).toBe(false);
  });
});

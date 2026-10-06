import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src';

describe('registry', () => {
  it('only enables providers whose platform app credentials are configured', () => {
    expect(createRegistry({}).manifests().map((m) => m.id).sort()).toEqual(['ai-groq', 'sms-msg91', 'telephony-exotel', 'website-webhook']);
    const all = createRegistry({ META_APP_ID: 'a', META_APP_SECRET: 's', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'gs' }).manifests().map((m) => m.id).sort();
    expect(all).toEqual(['ai-groq', 'google-sheets', 'meta-leadads', 'sms-msg91', 'telephony-exotel', 'website-webhook', 'whatsapp-cloud']);
  });
  it('every provider manifest is complete and flags secrets correctly', () => {
    const r = createRegistry({ META_APP_ID: 'a', META_APP_SECRET: 's', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'gs' });
    for (const m of r.manifests()) {
      expect(m.credentialFields.length).toBeGreaterThan(0);
      expect(m.capabilities.length).toBeGreaterThan(0);
      for (const f of m.credentialFields) expect(f.type).toBe('secret');
      if (m.webhook?.appLevel) expect(m.webhook.secretKey).toBe('appSecret');
    }
  });
});

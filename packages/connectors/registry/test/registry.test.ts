import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src';

describe('registry', () => {
  it('only enables providers whose platform app credentials are configured', () => {
    expect(createRegistry({}).manifests().map((m) => m.id)).toEqual(['website-webhook']);
    const all = createRegistry({ META_APP_ID: 'a', META_APP_SECRET: 's', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'gs' }).manifests().map((m) => m.id).sort();
    expect(all).toEqual(['google-sheets', 'meta-leadads', 'website-webhook']);
  });
  it('every provider manifest is complete and flags secrets correctly', () => {
    const r = createRegistry({ META_APP_ID: 'a', META_APP_SECRET: 's', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'gs' });
    for (const m of r.manifests()) {
      expect(m.credentialFields.length).toBeGreaterThan(0);
      expect(m.capabilities.length).toBeGreaterThan(0);
      for (const f of m.credentialFields) expect(f.type).toBe('secret');
    }
  });
});

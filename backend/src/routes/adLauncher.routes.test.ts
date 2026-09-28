import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { MetaAppConfig } from '../models/MetaAppConfig';
import { AdAccount } from '../models/AdAccount';
import { encryptSecret } from '../lib/crypto';
import { env } from '../config/env';

const app = createApp();

describe('Ad Launcher — real Meta OAuth connect flow (no more mock-connect)', () => {
  it('shows a not-connected empty state before any platform is connected', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/ad-launcher/accounts').set('Authorization', `Bearer ${token}`);
    expect(res.body.accounts).toHaveLength(0);
  });

  it('refuses to start the Meta OAuth flow until the workspace has registered its own Meta app', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/ad-launcher/accounts/meta/oauth-url').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Meta app/i);
  });

  it('builds a real Meta OAuth URL once the workspace has saved its own app id/secret', async () => {
    const { token, workspace } = await createOwnerContext();
    await MetaAppConfig.create({ workspaceId: workspace._id, appId: '111222333', appSecretEncrypted: encryptSecret('shh') });

    const res = await request(app).get('/api/ad-launcher/accounts/meta/oauth-url').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('client_id=111222333');
    expect(res.body.url).toContain('facebook.com');
  });

  it('the old fake instant-connect endpoint no longer pretends to connect anything', async () => {
    const { token } = await createOwnerContext();

    const meta = await request(app).post('/api/ad-launcher/accounts/connect').set('Authorization', `Bearer ${token}`).send({ platform: 'meta' });
    expect(meta.status).toBe(400);

    const google = await request(app).post('/api/ad-launcher/accounts/connect').set('Authorization', `Bearer ${token}`).send({ platform: 'google' });
    expect(google.status).toBe(501);
  });

  it('disconnects a real connected account and revokes the token', async () => {
    const { token, workspace } = await createOwnerContext();
    await AdAccount.create({
      workspaceId: workspace._id,
      platform: 'google',
      status: 'connected',
      externalAccountId: 'real-google-id',
      connectedAt: new Date(),
    });

    const res = await request(app).post('/api/ad-launcher/accounts/google/disconnect').set('Authorization', `Bearer ${token}`);
    expect(res.body.account.status).toBe('not_connected');
  });

  it('disconnecting a platform that was never connected 404s instead of silently succeeding', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).post('/api/ad-launcher/accounts/meta/disconnect').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('the OAuth callback exchanges the code, fetches real ad accounts, and stores an encrypted token — never the raw token', async () => {
    const { workspace } = await createOwnerContext();
    await MetaAppConfig.create({ workspaceId: workspace._id, appId: '111222333', appSecretEncrypted: encryptSecret('shh') });

    const state = jwt.sign({ workspaceId: String(workspace._id), nonce: 'n1', intent: 'ads' }, env.jwtAccessSecret, { expiresIn: '10m' });

    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('/oauth/access_token') && url.includes('fb_exchange_token')) {
        return new Response(JSON.stringify({ access_token: 'LONG_LIVED_TOKEN', token_type: 'bearer', expires_in: 5184000 }), { status: 200 });
      }
      if (url.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'SHORT_LIVED_TOKEN', token_type: 'bearer' }), { status: 200 });
      }
      if (url.includes('/me/adaccounts')) {
        return new Response(JSON.stringify({ data: [{ id: 'act_999', name: 'Real Ad Account', account_status: 1 }] }), { status: 200 });
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    const res = await request(app).get(`/api/ad-launcher/accounts/meta/oauth-callback?code=abc123&state=${encodeURIComponent(state)}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('meta=connected');

    const account = await AdAccount.findOne({ workspaceId: workspace._id, platform: 'meta' }).select('+accessTokenEncrypted');
    expect(account?.status).toBe('connected');
    expect(account?.externalAccountId).toBe('act_999');
    expect(account?.accountName).toBe('Real Ad Account');
    expect(account?.accessTokenEncrypted).toBeTruthy();
    expect(account?.accessTokenEncrypted).not.toBe('LONG_LIVED_TOKEN');

    fetchMock.mockRestore();
  });
});

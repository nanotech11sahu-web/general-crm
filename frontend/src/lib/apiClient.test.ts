import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { api } from './apiClient';
import { useAuthStore } from '../stores/authStore';

// refreshAccessToken() deliberately calls the bare `axios` module (not the `api` instance) to
// avoid its own request re-entering this file's response interceptor, so the refresh call and
// every other request need separate mock adapters even though they hit the same server in prod.
describe('apiClient — token refresh on 401 (Phase 12 coverage pass)', () => {
  let mock: MockAdapter;
  let rawAxiosMock: MockAdapter;
  const refreshUrl = `${api.defaults.baseURL}/auth/refresh`;

  beforeEach(() => {
    mock = new MockAdapter(api);
    rawAxiosMock = new MockAdapter(axios);
    useAuthStore.getState().clear();
    useAuthStore.getState().setTokens('expired-token', 'valid-refresh-token');
  });

  afterEach(() => {
    mock.restore();
    rawAxiosMock.restore();
  });

  it('attaches the current access token as a Bearer header on every request', async () => {
    mock.onGet('/ping').reply((config) => {
      expect(config.headers?.Authorization).toBe('Bearer expired-token');
      return [200, { ok: true }];
    });
    const res = await api.get('/ping');
    expect(res.data.ok).toBe(true);
  });

  it('transparently refreshes an expired token and retries the original request exactly once', async () => {
    let pingAttempts = 0;
    rawAxiosMock.onPost(refreshUrl).reply(200, { accessToken: 'new-token', refreshToken: 'new-refresh-token' });
    mock.onGet('/protected').reply((config) => {
      pingAttempts += 1;
      if (config.headers?.Authorization === 'Bearer expired-token') {
        return [401, { error: 'expired' }];
      }
      expect(config.headers?.Authorization).toBe('Bearer new-token');
      return [200, { data: 'secret' }];
    });

    const res = await api.get('/protected');
    expect(res.data.data).toBe('secret');
    expect(pingAttempts).toBe(2);
    expect(useAuthStore.getState().accessToken).toBe('new-token');
  });

  it('clears the session and rejects when the refresh token itself is invalid', async () => {
    rawAxiosMock.onPost(refreshUrl).reply(401, { error: 'invalid refresh token' });
    mock.onGet('/protected').reply(401, { error: 'expired' });

    await expect(api.get('/protected')).rejects.toBeTruthy();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });

  it('does not attempt a refresh loop on a second consecutive 401 from the same request', async () => {
    let refreshCalls = 0;
    rawAxiosMock.onPost(refreshUrl).reply(() => {
      refreshCalls += 1;
      return [200, { accessToken: 'still-bad-token', refreshToken: 'still-bad-refresh' }];
    });
    mock.onGet('/always-401').reply(401, { error: 'nope' });

    await expect(api.get('/always-401')).rejects.toBeTruthy();
    expect(refreshCalls).toBe(1); // retried once via the _retry flag, then gave up rather than looping
  });
});

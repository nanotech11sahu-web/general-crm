import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

describe('Auth flow', () => {
  const signupBody = {
    name: 'Ada Owner',
    email: 'ada@example.com',
    password: 'supersecret1',
    workspaceName: 'Ada Agency',
  };

  it('signs up a new user and creates a workspace with an Owner role', async () => {
    const res = await request(app).post('/api/auth/signup').send(signupBody);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(signupBody.email);
    expect(res.body.workspace.name).toBe(signupBody.workspaceName);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('rejects signup validation failures', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'bad' });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate signup email', async () => {
    await request(app).post('/api/auth/signup').send(signupBody);
    const res = await request(app).post('/api/auth/signup').send(signupBody);
    expect(res.status).toBe(409);
  });

  it('logs in with correct credentials and rejects wrong password', async () => {
    await request(app).post('/api/auth/signup').send(signupBody);
    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: signupBody.email, password: signupBody.password });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeDefined();

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: signupBody.email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
  });

  it('returns the authenticated user with full Owner permissions from /me', async () => {
    const signup = await request(app).post('/api/auth/signup').send(signupBody);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signup.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.permissions.settings.delete).toBe(true);
    expect(me.body.permissions.finance.create).toBe(true);
  });

  it('rejects /me without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('refreshes tokens and rejects a reused refresh token', async () => {
    const signup = await request(app).post('/api/auth/signup').send(signupBody);
    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: signup.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeDefined();

    const reused = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: signup.body.refreshToken });
    expect(reused.status).toBe(401);
  });
});

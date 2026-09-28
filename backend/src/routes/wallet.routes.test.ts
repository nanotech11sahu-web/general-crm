import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Wallet — shared credits ledger (Phase 3 engine, Phase 12 coverage pass)', () => {
  it('starts at a zero balance, tops up, and reflects a real transaction log', async () => {
    const { token } = await createOwnerContext();

    const initial = await request(app).get('/api/wallet').set('Authorization', `Bearer ${token}`);
    expect(initial.status).toBe(200);
    expect(initial.body.wallet.balance).toBe(0);
    expect(initial.body.transactions).toHaveLength(0);

    const topUp = await request(app).post('/api/wallet/top-up').set('Authorization', `Bearer ${token}`).send({ amount: 500 });
    expect(topUp.status).toBe(201);

    const after = await request(app).get('/api/wallet').set('Authorization', `Bearer ${token}`);
    expect(after.body.wallet.balance).toBe(500);
    expect(after.body.transactions).toHaveLength(1);
    expect(after.body.transactions[0].amount).toBe(500);
  });

  it('rejects a non-positive top-up amount', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).post('/api/wallet/top-up').set('Authorization', `Bearer ${token}`).send({ amount: -10 });
    expect(res.status).toBe(400);
  });
});

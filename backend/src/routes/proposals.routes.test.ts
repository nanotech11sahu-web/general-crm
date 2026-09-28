import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

async function createProposal(token: string, value = 10000) {
  const res = await request(app).post('/api/proposals').set('Authorization', `Bearer ${token}`).send({ name: 'Website Revamp', value, content: '<p>Scope...</p>' });
  return res.body.proposal._id as string;
}

describe('Proposal Builder', () => {
  it('walks a proposal through the full funnel to Converted', async () => {
    const { token } = await createOwnerContext();
    const id = await createProposal(token);

    await request(app).post(`/api/proposals/${id}/publish`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/proposals/${id}/send`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/proposals/${id}/view`).set('Authorization', `Bearer ${token}`);
    const approve = await request(app).post(`/api/proposals/${id}/approve`).set('Authorization', `Bearer ${token}`).send({ signatureName: 'Jamie Client' });
    expect(approve.status).toBe(200);
    expect(approve.body.proposal.signatureName).toBe('Jamie Client');

    const convert = await request(app).post(`/api/proposals/${id}/convert`).set('Authorization', `Bearer ${token}`);
    expect(convert.status).toBe(200);
    expect(convert.body.proposal.status).toBe('Converted');
  });

  it('rejects an out-of-order transition', async () => {
    const { token } = await createOwnerContext();
    const id = await createProposal(token);
    const res = await request(app).post(`/api/proposals/${id}/send`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('computes the KPI funnel, pipeline value, and win rate', async () => {
    const { token } = await createOwnerContext();
    const wonId = await createProposal(token, 8000);
    await request(app).post(`/api/proposals/${wonId}/publish`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/proposals/${wonId}/send`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/proposals/${wonId}/approve`).set('Authorization', `Bearer ${token}`).send({ signatureName: 'Won Client' });
    await request(app).post(`/api/proposals/${wonId}/convert`).set('Authorization', `Bearer ${token}`);

    const lostId = await createProposal(token, 4000);
    await request(app).post(`/api/proposals/${lostId}/publish`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/proposals/${lostId}/send`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/proposals/${lostId}/decline`).set('Authorization', `Bearer ${token}`);

    const kpis = await request(app).get('/api/proposals/kpis').set('Authorization', `Bearer ${token}`);
    expect(kpis.body.wonValue).toBe(8000);
    expect(kpis.body.winRate).toBe(0.5);
    expect(kpis.body.funnel.Converted).toBe(1);
    expect(kpis.body.funnel.Declined).toBe(1);
  });

  it('locks editing once a proposal has left Built status', async () => {
    const { token } = await createOwnerContext();
    const id = await createProposal(token);
    await request(app).post(`/api/proposals/${id}/publish`).set('Authorization', `Bearer ${token}`);
    const edit = await request(app).patch(`/api/proposals/${id}`).set('Authorization', `Bearer ${token}`).send({ value: 99999 });
    expect(edit.status).toBe(400);
  });
});

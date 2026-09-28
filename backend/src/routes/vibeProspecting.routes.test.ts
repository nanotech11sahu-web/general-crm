import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { creditWallet } from '../services/wallet.service';
import { Contact } from '../models/Contact';

const app = createApp();

describe('Vibe Prospecting (wallet-billed search)', () => {
  it('debits the shared wallet ledger for a real search and returns 5 results', async () => {
    const { token, workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 100, 'top_up');

    const res = await request(app)
      .post('/api/vibe-prospecting/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'salon owners in Mumbai' });

    expect(res.status).toBe(201);
    expect(res.body.search.results).toHaveLength(5);
    expect(res.body.walletBalance).toBe(95);
  });

  it('rejects a search when the wallet balance is insufficient', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/vibe-prospecting/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'anything' });
    expect(res.status).toBe(402);
  });

  it('saves a search result to the CRM as a real Contact', async () => {
    const { token, workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 100, 'top_up');
    const search = await request(app)
      .post('/api/vibe-prospecting/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'gyms in Pune' });

    const resultId = search.body.search.results[0].id;
    const save = await request(app)
      .post(`/api/vibe-prospecting/searches/${search.body.search._id}/results/${resultId}/save`)
      .set('Authorization', `Bearer ${token}`);
    expect(save.status).toBe(201);

    const contact = await Contact.findOne({ workspaceId: workspace._id, source: 'Vibe Prospecting' });
    expect(contact).not.toBeNull();
    expect(contact!.name).toBe(search.body.search.results[0].name);
  });

  it('rejects saving the same result twice', async () => {
    const { token, workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 100, 'top_up');
    const search = await request(app)
      .post('/api/vibe-prospecting/search')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'dentists' });
    const resultId = search.body.search.results[0].id;
    await request(app)
      .post(`/api/vibe-prospecting/searches/${search.body.search._id}/results/${resultId}/save`)
      .set('Authorization', `Bearer ${token}`);
    const second = await request(app)
      .post(`/api/vibe-prospecting/searches/${search.body.search._id}/results/${resultId}/save`)
      .set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(400);
  });

  it('reports real stats: searches today, credits spent, save rate', async () => {
    const { token, workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 100, 'top_up');
    await request(app).post('/api/vibe-prospecting/search').set('Authorization', `Bearer ${token}`).send({ query: 'a' });
    await request(app).post('/api/vibe-prospecting/search').set('Authorization', `Bearer ${token}`).send({ query: 'b' });

    const stats = await request(app).get('/api/vibe-prospecting/stats').set('Authorization', `Bearer ${token}`);
    expect(stats.body.totalSearches).toBe(2);
    expect(stats.body.searchesToday).toBe(2);
    expect(stats.body.creditsSpent7d).toBe(10);
    expect(stats.body.walletBalance).toBe(90);
  });
});

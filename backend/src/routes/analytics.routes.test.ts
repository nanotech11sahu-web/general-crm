import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { creditWallet } from '../services/wallet.service';

const app = createApp();

describe('Cross-module Analytics — numbers match each source module (Phase 10 core DoD)', () => {
  it('Revenue and MRR tiles match Finance\'s own dashboard for the same data', async () => {
    const { token, demoContact } = await createOwnerContext();
    const product = await request(app).post('/api/ecom/products').set('Authorization', `Bearer ${token}`).send({ name: 'Pro Plan', salePrice: 4000 });
    await request(app)
      .post('/api/finance/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, productId: product.body.product._id, billingCycle: 'monthly', price: 4000 });

    const financeDashboard = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${token}`);
    const analytics = await request(app).get('/api/analytics').set('Authorization', `Bearer ${token}`);

    const mrrTile = analytics.body.tiles.find((t: { key: string }) => t.key === 'mrr');
    expect(mrrTile.value).toBe(financeDashboard.body.kpis.mrr);

    const revenueTile = analytics.body.tiles.find((t: { key: string }) => t.key === 'revenue');
    expect(revenueTile.value).toBe(financeDashboard.body.revenueSummary.gross);
  });

  it('Community tile matches Community\'s own dashboard', async () => {
    const { token, workspace, demoContact } = await createOwnerContext();
    await creditWallet(String(workspace._id), 1000, 'top_up');
    const course = await request(app).post('/api/community/courses').set('Authorization', `Bearer ${token}`).send({ name: 'AI 101', description: 'Intro', status: 'published' });
    await request(app).post(`/api/community/courses/${course.body.course._id}/purchase`).set('Authorization', `Bearer ${token}`).send({ contactId: String(demoContact._id) });

    const communityDashboard = await request(app).get('/api/community/dashboard').set('Authorization', `Bearer ${token}`);
    const analytics = await request(app).get('/api/analytics').set('Authorization', `Bearer ${token}`);

    const communityTile = analytics.body.tiles.find((t: { key: string }) => t.key === 'community');
    expect(communityTile.value).toBe(communityDashboard.body.kpis.enrollments);
  });
});

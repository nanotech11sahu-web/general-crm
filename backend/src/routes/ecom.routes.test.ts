import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { creditWallet } from '../services/wallet.service';
import { AiRequestLog } from '../models/AiRequestLog';

const app = createApp();

describe('Ecom products (shared Finance object)', () => {
  it('creates a product and reports it as synced to Finance', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/ecom/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Starter Plan', salePrice: 999 });
    expect(res.status).toBe(201);
    expect(res.body.financeSynced).toBe(true);
    expect(res.body.product.seoSlug).toBe('starter-plan');
    expect(res.body.product.source).toBe('ecom');
  });

  it('de-duplicates SEO slugs within a workspace', async () => {
    const { token } = await createOwnerContext();
    const first = await request(app).post('/api/ecom/products').set('Authorization', `Bearer ${token}`).send({ name: 'Widget', salePrice: 10 });
    const second = await request(app).post('/api/ecom/products').set('Authorization', `Bearer ${token}`).send({ name: 'Widget', salePrice: 15 });
    expect(first.body.product.seoSlug).toBe('widget');
    expect(second.body.product.seoSlug).toBe('widget-2');
  });

  it('enforces the free-tier product quota', async () => {
    const { token } = await createOwnerContext();
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/api/ecom/products').set('Authorization', `Bearer ${token}`).send({ name: `Product ${i}`, salePrice: 10 });
      expect(res.status).toBe(201);
    }
    const eleventh = await request(app).post('/api/ecom/products').set('Authorization', `Bearer ${token}`).send({ name: 'One Too Many', salePrice: 10 });
    expect(eleventh.status).toBe(402);
  });

  it('reports quota usage on the list endpoint', async () => {
    const { token } = await createOwnerContext();
    await request(app).post('/api/ecom/products').set('Authorization', `Bearer ${token}`).send({ name: 'Widget', salePrice: 10 });
    const list = await request(app).get('/api/ecom/products').set('Authorization', `Bearer ${token}`);
    expect(list.body.quota).toEqual({ used: 1, limit: 10 });
  });

  it('creates a collection and links a product to it', async () => {
    const { token } = await createOwnerContext();
    const collection = await request(app).post('/api/ecom/collections').set('Authorization', `Bearer ${token}`).send({ name: 'Software' });
    const product = await request(app)
      .post('/api/ecom/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Pro Plan', salePrice: 1999, collectionId: collection.body.collection._id });
    expect(product.body.product.collectionId).toBe(collection.body.collection._id);
  });

  it('seeds a default "No Tax" tax profile for every new workspace (managed under Settings → Finance → Tax)', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/finance/tax-profiles').set('Authorization', `Bearer ${token}`);
    expect(res.body.profiles).toHaveLength(1);
    expect(res.body.profiles[0].name).toBe('No Tax');
  });
});

describe('Ecom — AI Store Builder (Phase 7 gateway retrofit)', () => {
  it('calls the real AI gateway and returns a structured store suggestion', async () => {
    const { token, workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 100, 'top_up');

    const res = await request(app)
      .post('/api/ecom/ai-store-builder')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'handmade candles' });
    expect(res.status).toBe(200);
    expect(res.body.suggestion.storeName).toContain('Candles');
    expect(res.body.suggestion.suggestedProducts.length).toBeGreaterThan(0);

    const log = await AiRequestLog.findOne({ workspaceId: workspace._id, purpose: 'storeBuilder' }).lean();
    expect(log).toBeTruthy();
  });
});

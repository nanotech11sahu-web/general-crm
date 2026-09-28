import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { Product } from '../models/Product';

const app = createApp();

describe('Dashboard — 14 KPIs wired to real owning modules (Phase 11 core DoD)', () => {
  it('reflects a real paid invoice in the Finance KPI group', async () => {
    const { token, workspace, demoContact } = await createOwnerContext();
    const product = await Product.create({ workspaceId: workspace._id, name: 'Core Plan', salePrice: 5000, seoSlug: 'core-plan' });

    const invoiceRes = await request(app)
      .post('/api/finance/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(demoContact._id), productId: String(product._id), amount: 5000, dueAt: new Date().toISOString() });
    const invoiceId = invoiceRes.body.invoice._id;
    await request(app).post(`/api/finance/invoices/${invoiceId}/mark-paid`).set('Authorization', `Bearer ${token}`).send({ paidAmount: 5000 });

    const dashboard = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.status).toBe(200);
    const financeGroup = dashboard.body.groups.find((g: { group: string }) => g.group === 'Finance');
    const totalRevenue = financeGroup.kpis.find((k: { key: string }) => k.key === 'totalRevenue');
    expect(totalRevenue.value).toBe(5000);

    const contactsGroup = dashboard.body.groups.find((g: { group: string }) => g.group === 'Contacts & CRM');
    const totalContacts = contactsGroup.kpis.find((k: { key: string }) => k.key === 'totalContacts');
    expect(totalContacts.value).toBeGreaterThanOrEqual(1);
  });

  it('persists a member-specific dashboard layout (drag reorder / show-hide)', async () => {
    const { token } = await createOwnerContext();
    const put = await request(app)
      .put('/api/dashboard/layout')
      .set('Authorization', `Bearer ${token}`)
      .send({ layout: [{ key: 'mrr', visible: false }, { key: 'totalRevenue', visible: true }] });
    expect(put.status).toBe(200);

    const get = await request(app).get('/api/dashboard/layout').set('Authorization', `Bearer ${token}`);
    expect(get.body.layout).toEqual([
      { key: 'mrr', visible: false },
      { key: 'totalRevenue', visible: true },
    ]);
  });
});

describe('Notification center — real module events land in the bell feed (Phase 11 core DoD)', () => {
  it('notifies the workspace owner when an invoice goes overdue', async () => {
    const { token, workspace, demoContact } = await createOwnerContext();
    const product = await Product.create({ workspaceId: workspace._id, name: 'Overdue Plan', salePrice: 1000, seoSlug: 'overdue-plan' });
    const invoiceRes = await request(app)
      .post('/api/finance/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(demoContact._id), productId: String(product._id), amount: 1000, dueAt: new Date().toISOString() });

    await request(app).post(`/api/finance/invoices/${invoiceRes.body.invoice._id}/mark-overdue`).set('Authorization', `Bearer ${token}`);

    const notifications = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`);
    expect(notifications.body.notifications.some((n: { type: string }) => n.type === 'finance.invoiceOverdue')).toBe(true);
  });
});

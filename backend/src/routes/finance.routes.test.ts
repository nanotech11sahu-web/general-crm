import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { WorkflowRun } from '../models/WorkflowRun';

const app = createApp();

async function createProduct(token: string, name = 'Pro Plan', salePrice = 999) {
  const res = await request(app).post('/api/ecom/products').set('Authorization', `Bearer ${token}`).send({ name, salePrice });
  return res.body.product;
}

describe('Finance — Products shared with Ecom (Phase 6 core DoD)', () => {
  it('shows an Ecom-created product correctly priced in the Finance Products tab', async () => {
    const { token } = await createOwnerContext();
    const product = await createProduct(token, 'Pro Plan', 4999);

    const res = await request(app).get('/api/finance/products').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const found = res.body.products.find((p: { _id: string }) => p._id === product._id);
    expect(found).toBeTruthy();
    expect(found.salePrice).toBe(4999);
  });
});

describe('Finance — Invoice lifecycle fires triggers and updates dashboard live (Phase 6 core DoD)', () => {
  it('creating and paying an invoice fires the workflow trigger and updates dashboard KPIs', async () => {
    const { token, demoContact } = await createOwnerContext();
    const product = await createProduct(token);

    // Publish a workflow listening for Invoice Paid.
    const workflow = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Invoice Paid Flow', triggerKey: 'finance.invoicePaid' });
    const workflowId = workflow.body.workflow._id;
    const triggerNodeId = workflow.body.workflow.nodes[0].id;
    await request(app)
      .patch(`/api/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        nodes: [workflow.body.workflow.nodes[0], { id: 'action-1', kind: 'add_tag', position: { x: 300, y: 150 }, data: { tagName: 'Paid Customer' } }],
        edges: [{ id: 'e1', source: triggerNodeId, target: 'action-1' }],
      });
    await request(app).post(`/api/workflows/${workflowId}/publish`).set('Authorization', `Bearer ${token}`);

    const createRes = await request(app)
      .post('/api/finance/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, productId: product._id, amount: 1000, dueAt: new Date().toISOString() });
    expect(createRes.status).toBe(201);
    const invoiceId = createRes.body.invoice._id;

    const beforeDashboard = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${token}`);
    expect(beforeDashboard.body.revenueSummary.collected).toBe(0);
    expect(beforeDashboard.body.revenueSummary.outstanding).toBe(1000);

    const payRes = await request(app).post(`/api/finance/invoices/${invoiceId}/mark-paid`).set('Authorization', `Bearer ${token}`).send({});
    expect(payRes.status).toBe(200);
    expect(payRes.body.invoice.status).toBe('paid');

    const afterDashboard = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${token}`);
    expect(afterDashboard.body.revenueSummary.collected).toBe(1000);
    expect(afterDashboard.body.revenueSummary.outstanding).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const run = await WorkflowRun.findOne({ workflowId }).lean();
    expect(run?.status).toBe('success');
  });

  it('marks an invoice overdue and fires finance.invoiceOverdue', async () => {
    const { token, demoContact } = await createOwnerContext();
    const product = await createProduct(token);
    const invoice = await request(app)
      .post('/api/finance/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, productId: product._id, amount: 500, dueAt: new Date().toISOString() });

    const res = await request(app).post(`/api/finance/invoices/${invoice.body.invoice._id}/mark-overdue`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('overdue');

    const dashboard = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.overdueInvoices).toHaveLength(1);
  });

  it('an installment invoice fires installment-specific triggers instead of the generic ones', async () => {
    const { token, demoContact } = await createOwnerContext();
    const product = await createProduct(token);
    const invoice = await request(app)
      .post('/api/finance/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, productId: product._id, amount: 300, dueAt: new Date().toISOString(), installmentNumber: 1, installmentsTotal: 3 });
    expect(invoice.body.invoice.installmentsTotal).toBe(3);

    const paid = await request(app).post(`/api/finance/invoices/${invoice.body.invoice._id}/mark-paid`).set('Authorization', `Bearer ${token}`).send({});
    expect(paid.body.invoice.status).toBe('paid');
  });
});

describe('Finance — Subscriptions', () => {
  it('creates a subscription, computes MRR, and cancels it', async () => {
    const { token, demoContact } = await createOwnerContext();
    const product = await createProduct(token);

    const sub = await request(app)
      .post('/api/finance/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, productId: product._id, billingCycle: 'monthly', price: 2000 });
    expect(sub.status).toBe(201);

    const dashboard = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.kpis.mrr).toBe(2000);
    expect(dashboard.body.kpis.arr).toBe(24000);
    expect(dashboard.body.kpis.activeSubscriptions).toBe(1);

    const cancel = await request(app).post(`/api/finance/subscriptions/${sub.body.subscription._id}/cancel`).set('Authorization', `Bearer ${token}`);
    expect(cancel.body.subscription.status).toBe('cancelled');

    const dashboardAfter = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboardAfter.body.kpis.mrr).toBe(0);
  });

  it('paying a subscription-linked invoice advances nextBillingAt and marks the subscription active', async () => {
    const { token, demoContact } = await createOwnerContext();
    const product = await createProduct(token);
    const sub = await request(app)
      .post('/api/finance/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, productId: product._id, billingCycle: 'monthly', price: 1500 });

    const invoice = await request(app)
      .post('/api/finance/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, productId: product._id, subscriptionId: sub.body.subscription._id, amount: 1500, dueAt: new Date().toISOString() });

    const before = sub.body.subscription.nextBillingAt;
    await request(app).post(`/api/finance/invoices/${invoice.body.invoice._id}/mark-paid`).set('Authorization', `Bearer ${token}`).send({});

    const subs = await request(app).get('/api/finance/subscriptions').set('Authorization', `Bearer ${token}`);
    const updated = subs.body.subscriptions.find((s: { _id: string }) => s._id === sub.body.subscription._id);
    expect(updated.status).toBe('active');
    expect(new Date(updated.nextBillingAt).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});

describe('Finance — Reconciliation (Phase 6 core DoD)', () => {
  it('correctly flags an intentionally-mismatched test transaction as Open, then lets it be Resolved', async () => {
    const { token, demoContact } = await createOwnerContext();
    const product = await createProduct(token);
    const invoice = await request(app)
      .post('/api/finance/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, productId: product._id, amount: 1000, dueAt: new Date().toISOString() });

    // Pay a different amount than the invoice total to intentionally create a mismatch.
    await request(app)
      .post(`/api/finance/invoices/${invoice.body.invoice._id}/mark-paid`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paidAmount: 750 });

    const dashboard = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.reconciliation.open).toBe(1);
    expect(dashboard.body.reconciliation.resolved).toBe(0);
    expect(dashboard.body.reconciliation.total).toBe(1);

    const transactions = await request(app).get('/api/finance/transactions?unresolved=true').set('Authorization', `Bearer ${token}`);
    expect(transactions.body.transactions).toHaveLength(1);
    const transactionId = transactions.body.transactions[0]._id;

    const resolve = await request(app).post(`/api/finance/transactions/${transactionId}/resolve`).set('Authorization', `Bearer ${token}`);
    expect(resolve.body.transaction.resolved).toBe(true);

    const dashboardAfter = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboardAfter.body.reconciliation.open).toBe(0);
    expect(dashboardAfter.body.reconciliation.resolved).toBe(1);
  });

  it('a one-time payment transaction fires finance.oneTimePayment and is matched by default', async () => {
    const { token, demoContact } = await createOwnerContext();
    const res = await request(app)
      .post('/api/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, amount: 250, method: 'manual' });
    expect(res.status).toBe(201);
    expect(res.body.transaction.matched).toBe(true);
  });

  it('refunding a transaction is reflected in the revenue waterfall', async () => {
    const { token, demoContact } = await createOwnerContext();
    const txn = await request(app)
      .post('/api/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, amount: 400, method: 'manual' });

    const refund = await request(app).post(`/api/finance/transactions/${txn.body.transaction._id}/refund`).set('Authorization', `Bearer ${token}`);
    expect(refund.body.transaction.status).toBe('refunded');

    const dashboard = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.revenueWaterfall.refunds).toBe(400);
  });

  it('flags a forced-mismatch one-time transaction (no linked invoice) as Open on the dashboard too', async () => {
    const { token, demoContact } = await createOwnerContext();
    const res = await request(app)
      .post('/api/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, amount: 500, method: 'manual', forceMismatch: true });
    expect(res.body.transaction.matched).toBe(false);

    const dashboard = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.reconciliation.open).toBe(1);
    expect(dashboard.body.reconciliation.total).toBe(1);
  });
});

describe('Finance — Tax profiles (retrofit from Phase 3 Ecom)', () => {
  it('creates a tax profile under Finance and Ecom continues to see the shared default', async () => {
    const { token } = await createOwnerContext();
    const listBefore = await request(app).get('/api/finance/tax-profiles').set('Authorization', `Bearer ${token}`);
    expect(listBefore.body.profiles).toHaveLength(1);
    expect(listBefore.body.profiles[0].name).toBe('No Tax');

    const created = await request(app)
      .post('/api/finance/tax-profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'GST 18%', ratePercent: 18, isDefault: true });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/finance/tax-profiles').set('Authorization', `Bearer ${token}`);
    expect(list.body.profiles).toHaveLength(2);
    expect(list.body.profiles.find((p: { name: string }) => p.name === 'GST 18%').isDefault).toBe(true);
    expect(list.body.profiles.find((p: { name: string }) => p.name === 'No Tax').isDefault).toBe(false);
  });
});

describe('Finance — Razorpay connect stub', () => {
  it('connects Razorpay via the stub flow', async () => {
    const { token } = await createOwnerContext();
    const before = await request(app).get('/api/finance/razorpay-status').set('Authorization', `Bearer ${token}`);
    expect(before.body.connected).toBe(false);

    const connect = await request(app).post('/api/finance/razorpay-connect').set('Authorization', `Bearer ${token}`);
    expect(connect.body.connected).toBe(true);

    const after = await request(app).get('/api/finance/razorpay-status').set('Authorization', `Bearer ${token}`);
    expect(after.body.connected).toBe(true);
  });
});

describe('Finance — invoice filters, cancellation, and 404 branches (Phase 12 coverage pass)', () => {
  it('filters invoices by status/contactId/dueBefore, paginates, and cancels an open invoice', async () => {
    const { token, demoContact } = await createOwnerContext();
    const product = await request(app).post('/api/ecom/products').set('Authorization', `Bearer ${token}`).send({ name: 'Coverage Plan', salePrice: 500 });

    const invoice = await request(app)
      .post('/api/finance/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(demoContact._id), productId: product.body.product._id, amount: 500, dueAt: new Date(Date.now() + 86400000).toISOString() });
    const invoiceId = invoice.body.invoice._id;

    const byStatus = await request(app).get('/api/finance/invoices').query({ status: 'open' }).set('Authorization', `Bearer ${token}`);
    expect(byStatus.body.invoices).toHaveLength(1);

    const byContact = await request(app).get('/api/finance/invoices').query({ contactId: String(demoContact._id) }).set('Authorization', `Bearer ${token}`);
    expect(byContact.body.invoices).toHaveLength(1);

    const byDueBefore = await request(app).get('/api/finance/invoices').query({ dueBefore: new Date(Date.now() - 86400000).toISOString() }).set('Authorization', `Bearer ${token}`);
    expect(byDueBefore.body.invoices).toHaveLength(0);

    const paged = await request(app).get('/api/finance/invoices').query({ page: 1, limit: 1 }).set('Authorization', `Bearer ${token}`);
    expect(paged.body.limit).toBe(1);

    const cancel = await request(app).post(`/api/finance/invoices/${invoiceId}/cancel`).set('Authorization', `Bearer ${token}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.invoice.status).toBe('cancelled');
  });

  it('404s mark-paid/mark-overdue/cancel/resolve/refund against an unknown id', async () => {
    const { token } = await createOwnerContext();
    const missingId = '000000000000000000000000';

    const markPaid = await request(app).post(`/api/finance/invoices/${missingId}/mark-paid`).set('Authorization', `Bearer ${token}`);
    expect(markPaid.status).toBe(404);

    const markOverdue = await request(app).post(`/api/finance/invoices/${missingId}/mark-overdue`).set('Authorization', `Bearer ${token}`);
    expect(markOverdue.status).toBe(404);

    const cancel = await request(app).post(`/api/finance/invoices/${missingId}/cancel`).set('Authorization', `Bearer ${token}`);
    expect(cancel.status).toBe(404);

    const resolve = await request(app).post(`/api/finance/transactions/${missingId}/resolve`).set('Authorization', `Bearer ${token}`);
    expect(resolve.status).toBe(404);

    const refund = await request(app).post(`/api/finance/transactions/${missingId}/refund`).set('Authorization', `Bearer ${token}`);
    expect(refund.status).toBe(404);
  });

  it('filters transactions by unresolved=true', async () => {
    const { token, demoContact } = await createOwnerContext();
    await request(app)
      .post('/api/finance/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(demoContact._id), amount: 250, forceMismatch: true });

    const unresolved = await request(app).get('/api/finance/transactions').query({ unresolved: 'true' }).set('Authorization', `Bearer ${token}`);
    expect(unresolved.body.transactions.length).toBeGreaterThan(0);
  });
});

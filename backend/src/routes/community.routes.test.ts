import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { creditWallet } from '../services/wallet.service';

const app = createApp();

describe('Community — Course purchase → Finance + access grant (Phase 9 core DoD)', () => {
  it('creates a matching Finance transaction, grants access, and fires Course Access Granted', async () => {
    const { token, workspace, demoContact } = await createOwnerContext();
    await creditWallet(String(workspace._id), 1000, 'top_up');

    const product = await request(app).post('/api/ecom/products').set('Authorization', `Bearer ${token}`).send({ name: 'Pro Course Bundle', salePrice: 2999 });

    const course = await request(app)
      .post('/api/community/courses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Advanced Marketing', description: 'Learn advanced marketing', status: 'published', productId: product.body.product._id });
    expect(course.status).toBe(201);

    const workflow = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Course Access Flow', triggerKey: 'community.courseAccessGranted' });
    const workflowId = workflow.body.workflow._id;
    const triggerNodeId = workflow.body.workflow.nodes[0].id;
    await request(app)
      .patch(`/api/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        nodes: [
          workflow.body.workflow.nodes[0],
          { id: 'tag1', kind: 'add_tag', position: { x: 200, y: 0 }, data: { tagName: 'Course Access Granted' } },
        ],
        edges: [{ id: 'e1', source: triggerNodeId, target: 'tag1' }],
      });
    await request(app).post(`/api/workflows/${workflowId}/publish`).set('Authorization', `Bearer ${token}`);

    const purchase = await request(app)
      .post(`/api/community/courses/${course.body.course._id}/purchase`)
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(demoContact._id) });
    expect(purchase.status).toBe(201);
    expect(purchase.body.enrollment.transactionId).toBeTruthy();

    const financeTransactions = await request(app).get('/api/finance/transactions').set('Authorization', `Bearer ${token}`);
    const tx = financeTransactions.body.transactions.find((t: { _id: string }) => t._id === purchase.body.enrollment.transactionId);
    expect(tx.amount).toBe(2999);

    const contact = await request(app).get(`/api/contacts/${demoContact._id}`).set('Authorization', `Bearer ${token}`);
    expect(contact.body.contact.tagIds.length).toBeGreaterThan(0);

    const dashboard = await request(app).get('/api/community/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.kpis.enrollments).toBe(1);
    expect(dashboard.body.topMembers[0].xp).toBe(50);
  });
});

describe('Community — Courses list/edit, Digital Store, Profile (Phase 12 coverage pass)', () => {
  it('lists and edits courses, 404s on unknown ids, and lists enrollments both ways', async () => {
    const { token, demoContact } = await createOwnerContext();
    const course = await request(app).post('/api/community/courses').set('Authorization', `Bearer ${token}`).send({ name: 'Course A', description: 'Desc' });
    const courseId = course.body.course._id;

    const list = await request(app).get('/api/community/courses').set('Authorization', `Bearer ${token}`);
    expect(list.body.courses).toHaveLength(1);

    const edit = await request(app).patch(`/api/community/courses/${courseId}`).set('Authorization', `Bearer ${token}`).send({ status: 'published' });
    expect(edit.body.course.status).toBe('published');

    const editMissing = await request(app).patch('/api/community/courses/000000000000000000000000').set('Authorization', `Bearer ${token}`).send({ status: 'draft' });
    expect(editMissing.status).toBe(404);

    await request(app).post(`/api/community/courses/${courseId}/purchase`).set('Authorization', `Bearer ${token}`).send({ contactId: String(demoContact._id) });

    const byCourse = await request(app).get(`/api/community/courses/${courseId}/enrollments`).set('Authorization', `Bearer ${token}`);
    expect(byCourse.body.enrollments).toHaveLength(1);

    const byContact = await request(app).get(`/api/community/contacts/${demoContact._id}/enrollments`).set('Authorization', `Bearer ${token}`);
    expect(byContact.body.enrollments).toHaveLength(1);
    expect(byContact.body.enrollments[0].courseId.name).toBe('Course A');
  });

  it('lists/creates store products, coupons, and places a discounted order via Finance', async () => {
    const { token, demoContact } = await createOwnerContext();
    const product = await request(app).post('/api/community/store/products').set('Authorization', `Bearer ${token}`).send({ name: 'Digital Pack', salePrice: 1000 });
    expect(product.status).toBe(201);
    expect(product.body.product.source).toBe('community');

    const productsList = await request(app).get('/api/community/store/products').set('Authorization', `Bearer ${token}`);
    expect(productsList.body.products).toHaveLength(1);

    const coupon = await request(app).post('/api/community/store/coupons').set('Authorization', `Bearer ${token}`).send({ code: 'save20', discountPercent: 20 });
    expect(coupon.status).toBe(201);
    const couponsList = await request(app).get('/api/community/store/coupons').set('Authorization', `Bearer ${token}`);
    expect(couponsList.body.coupons).toHaveLength(1);

    const orderMissingProduct = await request(app)
      .post('/api/community/store/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(demoContact._id), productId: '000000000000000000000000' });
    expect(orderMissingProduct.status).toBe(404);

    const order = await request(app)
      .post('/api/community/store/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(demoContact._id), productId: product.body.product._id, couponCode: 'SAVE20' });
    expect(order.status).toBe(201);
    expect(order.body.order.amount).toBe(800); // 1000 - 20%

    const ordersList = await request(app).get('/api/community/store/orders').set('Authorization', `Bearer ${token}`);
    expect(ordersList.body.orders).toHaveLength(1);
  });

  it('auto-creates a default Community Profile on first read, then persists an edit', async () => {
    const { token } = await createOwnerContext();
    const first = await request(app).get('/api/community/profile').set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(first.body.profile).toBeTruthy();

    const edit = await request(app)
      .patch('/api/community/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ identity: { name: 'My Community', tagline: 'Grow together' } });
    expect(edit.status).toBe(200);
    expect(edit.body.profile.identity.name).toBe('My Community');
  });
});

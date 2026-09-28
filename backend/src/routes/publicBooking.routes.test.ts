import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { Contact } from '../models/Contact';
import { Appointment } from '../models/Appointment';
import { WorkflowRun } from '../models/WorkflowRun';

const app = createApp();

function tomorrowAt(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe('Public booking page (Phase 5 Definition of Done)', () => {
  it('produces a real Calendar event, fires the Appointment Booked trigger, and shows on the contact Appointments tab', async () => {
    const { token } = await createOwnerContext();

    // Publish an event type bookable any day of the week.
    const created = await request(app).post('/api/event-types').set('Authorization', `Bearer ${token}`).send({ name: 'Onboarding Call', templateKey: 'scratch' });
    const eventTypeId = created.body.eventType._id;
    const publicId = created.body.eventType.publicId;
    await request(app)
      .patch(`/api/event-types/${eventTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: true, startTime: '00:00', endTime: '23:00' })) });
    await request(app).post(`/api/event-types/${eventTypeId}/publish`).set('Authorization', `Bearer ${token}`);

    // Build and publish a workflow that tags the contact when an appointment is booked.
    const workflow = await request(app)
      .post('/api/workflows')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Appointment Booked Flow', triggerKey: 'calendar.appointmentBooked' });
    const workflowId = workflow.body.workflow._id;
    const triggerNodeId = workflow.body.workflow.nodes[0].id;
    await request(app)
      .patch(`/api/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        nodes: [workflow.body.workflow.nodes[0], { id: 'action-1', kind: 'add_tag', position: { x: 300, y: 150 }, data: { tagName: 'New Booking' } }],
        edges: [{ id: 'e1', source: triggerNodeId, target: 'action-1' }],
      });
    const publishWorkflow = await request(app).post(`/api/workflows/${workflowId}/publish`).set('Authorization', `Bearer ${token}`);
    expect(publishWorkflow.status).toBe(200);

    // Public visitor loads the booking page (no auth).
    const page = await request(app).get(`/api/public/booking/${publicId}`);
    expect(page.status).toBe(200);
    expect(page.body.eventType.name).toBe('Onboarding Call');

    const startAt = tomorrowAt(10);
    const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);

    const book = await request(app)
      .post(`/api/public/booking/${publicId}/book`)
      .send({
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        formResponses: { name: 'Jamie Booker', email: 'jamie@example.com', phone: '+1 555 0100' },
      });
    expect(book.status).toBe(201);
    expect(book.body.status).toBe('Booked');

    const appointment = await Appointment.findById(book.body.appointmentId).lean();
    expect(appointment).toBeTruthy();
    expect(appointment!.eventTypeId.toString()).toBe(eventTypeId);

    const contact = await Contact.findOne({ email: 'jamie@example.com' }).lean();
    expect(contact).toBeTruthy();
    expect(contact!.source).toBe('Calendar');

    await new Promise((resolve) => setTimeout(resolve, 50));
    const run = await WorkflowRun.findOne({ workflowId }).lean();
    expect(run?.status).toBe('success');

    const appointmentsTab = await request(app)
      .get(`/api/appointments?contactId=${contact!._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(appointmentsTab.status).toBe(200);
    expect(appointmentsTab.body.appointments).toHaveLength(1);
    expect(appointmentsTab.body.appointments[0].status).toBe('Booked');
  });

  it('rejects booking a slot that is already taken', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/event-types').set('Authorization', `Bearer ${token}`).send({ name: 'Slot Test', templateKey: 'scratch' });
    const eventTypeId = created.body.eventType._id;
    const publicId = created.body.eventType.publicId;
    await request(app)
      .patch(`/api/event-types/${eventTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: true, startTime: '00:00', endTime: '23:00' })) });
    await request(app).post(`/api/event-types/${eventTypeId}/publish`).set('Authorization', `Bearer ${token}`);

    const dateStr = tomorrowAt(0).toISOString().slice(0, 10);
    const slotsBefore = await request(app).get(`/api/public/booking/${publicId}/slots?date=${dateStr}`);
    expect(slotsBefore.body.slots.length).toBeGreaterThan(0);
    const firstSlot = slotsBefore.body.slots[0];

    const firstBook = await request(app)
      .post(`/api/public/booking/${publicId}/book`)
      .send({ startAt: firstSlot.startAt, endAt: firstSlot.endAt, formResponses: { name: 'First', email: 'first@example.com' } });
    expect(firstBook.status).toBe(201);

    const slotsAfter = await request(app).get(`/api/public/booking/${publicId}/slots?date=${dateStr}`);
    expect(slotsAfter.body.slots.find((s: { startAt: string }) => s.startAt === firstSlot.startAt)).toBeUndefined();

    const secondBook = await request(app)
      .post(`/api/public/booking/${publicId}/book`)
      .send({ startAt: firstSlot.startAt, endAt: firstSlot.endAt, formResponses: { name: 'Second', email: 'second@example.com' } });
    expect(secondBook.status).toBe(409);
  });

  it('rejects booking with a missing required field', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/event-types').set('Authorization', `Bearer ${token}`).send({ name: 'Field Test', templateKey: 'scratch' });
    await request(app).post(`/api/event-types/${created.body.eventType._id}/publish`).set('Authorization', `Bearer ${token}`);
    const publicId = created.body.eventType.publicId;

    const startAt = tomorrowAt(9);
    const res = await request(app)
      .post(`/api/public/booking/${publicId}/book`)
      .send({ startAt: startAt.toISOString(), endAt: new Date(startAt.getTime() + 1800000).toISOString(), formResponses: { name: 'No Email' } });
    expect(res.status).toBe(400);
  });
});

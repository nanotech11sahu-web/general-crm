import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { eventBus } from '../lib/eventBus';

const app = createApp();

async function createBookedAppointment(token: string) {
  const created = await request(app).post('/api/event-types').set('Authorization', `Bearer ${token}`).send({ name: 'Status Test', templateKey: 'scratch' });
  const eventTypeId = created.body.eventType._id;
  await request(app)
    .patch(`/api/event-types/${eventTypeId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: true, startTime: '00:00', endTime: '23:00' })) });
  await request(app).post(`/api/event-types/${eventTypeId}/publish`).set('Authorization', `Bearer ${token}`);

  const startAt = new Date();
  startAt.setDate(startAt.getDate() + 1);
  startAt.setHours(11, 0, 0, 0);
  const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);

  const book = await request(app)
    .post(`/api/public/booking/${created.body.eventType.publicId}/book`)
    .send({ startAt: startAt.toISOString(), endAt: endAt.toISOString(), formResponses: { name: 'Status Guy', email: 'status@example.com' } });
  return book.body.appointmentId as string;
}

describe('Appointment status transitions', () => {
  it('marks an appointment as No Show and fires the calendar.noShow event', async () => {
    const { token } = await createOwnerContext();
    const appointmentId = await createBookedAppointment(token);

    const heard = new Promise((resolve) => eventBus.once('calendar.noShow', resolve));

    const res = await request(app).patch(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`).send({ status: 'No Show' });
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('No Show');
    await heard;
  });

  it('reschedules an appointment to a new time', async () => {
    const { token } = await createOwnerContext();
    const appointmentId = await createBookedAppointment(token);
    const newStart = new Date();
    newStart.setDate(newStart.getDate() + 2);

    const res = await request(app)
      .patch(`/api/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Rescheduled', startAt: newStart.toISOString(), endAt: new Date(newStart.getTime() + 1800000).toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('Rescheduled');
    expect(new Date(res.body.appointment.startAt).toISOString()).toBe(newStart.toISOString());
  });

  it('filters appointments by status', async () => {
    const { token } = await createOwnerContext();
    const appointmentId = await createBookedAppointment(token);
    await request(app).patch(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`).send({ status: 'Show Up' });

    const res = await request(app).get('/api/appointments?status=Show Up').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.appointments).toHaveLength(1);
  });
});

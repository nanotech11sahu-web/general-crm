import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('School — Setup Progress (Phase 8 core DoD)', () => {
  it('accurately reflects real completion state and gates full functionality', async () => {
    const { token } = await createOwnerContext();

    const before = await request(app).get('/api/school/setup-progress').set('Authorization', `Bearer ${token}`);
    expect(before.body.fullFunctionality).toBe(false);
    expect(before.body.items.find((i: { key: string }) => i.key === 'academicYear').complete).toBe(false);

    await request(app).post('/api/school/academic-years').set('Authorization', `Bearer ${token}`).send({ name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
    const schoolClass = await request(app).post('/api/school/classes').set('Authorization', `Bearer ${token}`).send({ name: 'Grade 5', sections: ['A', 'B'] });
    await request(app).post('/api/school/subjects').set('Authorization', `Bearer ${token}`).send({ name: 'Mathematics', classId: schoolClass.body.schoolClass._id });
    await request(app).post('/api/hrm/staff').set('Authorization', `Bearer ${token}`).send({ name: 'Teacher One', email: 'teacher@example.com', isTeacher: true });
    await request(app).post('/api/school/students').set('Authorization', `Bearer ${token}`).send({ name: 'Student One', classId: schoolClass.body.schoolClass._id, section: 'A' });

    const after = await request(app).get('/api/school/setup-progress').set('Authorization', `Bearer ${token}`);
    expect(after.body.fullFunctionality).toBe(true);
    expect(after.body.items.every((i: { required: boolean; complete: boolean }) => !i.required || i.complete)).toBe(true);

    const dashboard = await request(app).get('/api/school/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.kpis.students).toBe(1);
    expect(dashboard.body.kpis.teachers).toBe(1);
  });
});

describe('School — list endpoints, student status filter, announcements, portal access (Phase 12 coverage pass)', () => {
  it('lists academic years, classes, and subjects', async () => {
    const { token } = await createOwnerContext();
    await request(app).post('/api/school/academic-years').set('Authorization', `Bearer ${token}`).send({ name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
    const schoolClass = await request(app).post('/api/school/classes').set('Authorization', `Bearer ${token}`).send({ name: 'Grade 6' });
    await request(app).post('/api/school/subjects').set('Authorization', `Bearer ${token}`).send({ name: 'Science', classId: schoolClass.body.schoolClass._id });

    const years = await request(app).get('/api/school/academic-years').set('Authorization', `Bearer ${token}`);
    expect(years.body.academicYears).toHaveLength(1);
    const classes = await request(app).get('/api/school/classes').set('Authorization', `Bearer ${token}`);
    expect(classes.body.classes).toHaveLength(1);
    const subjects = await request(app).get('/api/school/subjects').set('Authorization', `Bearer ${token}`);
    expect(subjects.body.subjects).toHaveLength(1);
  });

  it('filters students by status and reports real portal-access counts', async () => {
    const { token } = await createOwnerContext();
    await request(app).post('/api/school/students').set('Authorization', `Bearer ${token}`).send({ name: 'Active Student', status: 'active' });
    await request(app).post('/api/school/students').set('Authorization', `Bearer ${token}`).send({ name: 'Alumni Student', status: 'alumni' });

    const all = await request(app).get('/api/school/students').set('Authorization', `Bearer ${token}`);
    expect(all.body.students).toHaveLength(2);

    const activeOnly = await request(app).get('/api/school/students').query({ status: 'active' }).set('Authorization', `Bearer ${token}`);
    expect(activeOnly.body.students).toHaveLength(1);

    const portal = await request(app).get('/api/school/portal-access').set('Authorization', `Bearer ${token}`);
    expect(portal.status).toBe(200);
    expect(portal.body.portals.find((p: { role: string }) => p.role === 'student').total).toBe(1);
  });

  it('creates and lists School announcements', async () => {
    const { token } = await createOwnerContext();
    const create = await request(app).post('/api/school/announcements').set('Authorization', `Bearer ${token}`).send({ title: 'PTA Meeting', content: 'This Friday at 5pm' });
    expect(create.status).toBe(201);
    const list = await request(app).get('/api/school/announcements').set('Authorization', `Bearer ${token}`);
    expect(list.body.announcements).toHaveLength(1);
  });
});

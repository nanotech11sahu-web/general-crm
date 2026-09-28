import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('HRM — Org Chart (Phase 8 core DoD)', () => {
  it('renders a real tree from Staff data, including AI agent counts', async () => {
    const { token } = await createOwnerContext();

    const ceo = await request(app).post('/api/hrm/staff').set('Authorization', `Bearer ${token}`).send({ name: 'Casey CEO', email: 'casey@example.com', department: 'Leadership' });
    const ceoId = ceo.body.staff._id;
    await request(app)
      .post('/api/hrm/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Riley Report', email: 'riley@example.com', department: 'Sales', managerId: ceoId });

    await request(app).post('/api/ai-suite/agents/install').set('Authorization', `Bearer ${token}`).send({ templateKey: 'marketing' });

    const chart = await request(app).get('/api/hrm/org-chart').set('Authorization', `Bearer ${token}`);
    expect(chart.status).toBe(200);
    expect(chart.body.kpis.totalStaff).toBe(2);
    expect(chart.body.kpis.aiAgentCount).toBe(1);
    expect(chart.body.tree.children).toHaveLength(1);
    expect(chart.body.tree.children[0].name).toBe('Casey CEO');
    expect(chart.body.tree.children[0].children[0].name).toBe('Riley Report');
  });

  it('lists the People directory synced from Staff with manager names resolved', async () => {
    const { token } = await createOwnerContext();
    const mgr = await request(app).post('/api/hrm/staff').set('Authorization', `Bearer ${token}`).send({ name: 'Manager One', email: 'm1@example.com' });
    await request(app)
      .post('/api/hrm/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Report One', email: 'r1@example.com', managerId: mgr.body.staff._id });

    const people = await request(app).get('/api/hrm/people').set('Authorization', `Bearer ${token}`);
    const report = people.body.staff.find((s: { name: string }) => s.name === 'Report One');
    expect(report.managerName).toBe('Manager One');
  });
});

describe('HRM — Hiring/ATS', () => {
  it('creates a Role, a Candidate against it, and an Interview for that candidate', async () => {
    const { token } = await createOwnerContext();
    const role = await request(app).post('/api/hrm/roles').set('Authorization', `Bearer ${token}`).send({ title: 'Backend Engineer', department: 'Engineering', openings: 2 });
    expect(role.status).toBe(201);

    const candidate = await request(app)
      .post('/api/hrm/candidates')
      .set('Authorization', `Bearer ${token}`)
      .send({ roleId: role.body.role._id, name: 'Jordan Dev', email: 'jordan@example.com' });
    expect(candidate.status).toBe(201);

    const interview = await request(app)
      .post('/api/hrm/interviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ candidateId: candidate.body.candidate._id, roleId: role.body.role._id, scheduledAt: new Date().toISOString() });
    expect(interview.status).toBe(201);

    const list = await request(app).get(`/api/hrm/candidates?roleId=${role.body.role._id}`).set('Authorization', `Bearer ${token}`);
    expect(list.body.candidates).toHaveLength(1);
  });
});

describe('HRM — Leave approvals', () => {
  it('submits a leave request and approves it', async () => {
    const { token } = await createOwnerContext();
    const staff = await request(app).post('/api/hrm/staff').set('Authorization', `Bearer ${token}`).send({ name: 'Leave Taker', email: 'lt@example.com' });
    const leave = await request(app)
      .post('/api/hrm/leave')
      .set('Authorization', `Bearer ${token}`)
      .send({ staffId: staff.body.staff._id, type: 'Sick', startDate: '2026-01-01', endDate: '2026-01-02' });
    expect(leave.status).toBe(201);

    const decision = await request(app).post(`/api/hrm/leave/${leave.body.leave._id}/decision`).set('Authorization', `Bearer ${token}`).send({ status: 'approved' });
    expect(decision.body.leave.status).toBe('approved');

    const dashboard = await request(app).get('/api/hrm/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.kpis.pendingLeave).toBe(0);
  });
});

describe('HRM — Departments, edits, filters, announcements, and 404s (Phase 12 coverage pass)', () => {
  it('creates and lists departments', async () => {
    const { token } = await createOwnerContext();
    const create = await request(app).post('/api/hrm/departments').set('Authorization', `Bearer ${token}`).send({ name: 'Engineering' });
    expect(create.status).toBe(201);
    const list = await request(app).get('/api/hrm/departments').set('Authorization', `Bearer ${token}`);
    expect(list.body.departments).toHaveLength(1);
  });

  it('edits Staff, Candidate, and Interview records, and 404s on unknown ids', async () => {
    const { token } = await createOwnerContext();
    const staff = await request(app).post('/api/hrm/staff').set('Authorization', `Bearer ${token}`).send({ name: 'Edit Me', email: 'edit@example.com' });
    const editStaff = await request(app).patch(`/api/hrm/staff/${staff.body.staff._id}`).set('Authorization', `Bearer ${token}`).send({ jobTitle: 'Senior Engineer' });
    expect(editStaff.body.staff.jobTitle).toBe('Senior Engineer');
    const missingStaff = await request(app).patch('/api/hrm/staff/000000000000000000000000').set('Authorization', `Bearer ${token}`).send({ jobTitle: 'x' });
    expect(missingStaff.status).toBe(404);

    const role = await request(app).post('/api/hrm/roles').set('Authorization', `Bearer ${token}`).send({ title: 'QA Engineer' });
    const candidate = await request(app)
      .post('/api/hrm/candidates')
      .set('Authorization', `Bearer ${token}`)
      .send({ roleId: role.body.role._id, name: 'Casey Candidate', email: 'casey.c@example.com' });
    const editCandidate = await request(app).patch(`/api/hrm/candidates/${candidate.body.candidate._id}`).set('Authorization', `Bearer ${token}`).send({ stage: 'Interview' });
    expect(editCandidate.body.candidate.stage).toBe('Interview');
    const missingCandidateEdit = await request(app).patch('/api/hrm/candidates/000000000000000000000000').set('Authorization', `Bearer ${token}`).send({ stage: 'Interview' });
    expect(missingCandidateEdit.status).toBe(404);

    const missingCandidateForInterview = await request(app)
      .post('/api/hrm/interviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ candidateId: '000000000000000000000000', roleId: role.body.role._id, scheduledAt: new Date().toISOString() });
    expect(missingCandidateForInterview.status).toBe(404);

    const interview = await request(app)
      .post('/api/hrm/interviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ candidateId: candidate.body.candidate._id, roleId: role.body.role._id, scheduledAt: new Date().toISOString() });
    const editInterview = await request(app)
      .patch(`/api/hrm/interviews/${interview.body.interview._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'completed', feedback: 'Strong hire' });
    expect(editInterview.body.interview.status).toBe('completed');
    const missingInterview = await request(app).patch('/api/hrm/interviews/000000000000000000000000').set('Authorization', `Bearer ${token}`).send({ status: 'completed' });
    expect(missingInterview.status).toBe(404);

    const filteredInterviews = await request(app).get(`/api/hrm/interviews?candidateId=${candidate.body.candidate._id}`).set('Authorization', `Bearer ${token}`);
    expect(filteredInterviews.body.interviews).toHaveLength(1);

    const filteredRoles = await request(app).get('/api/hrm/roles?status=open').set('Authorization', `Bearer ${token}`);
    expect(filteredRoles.status).toBe(200);
  });

  it('rejects a leave request for an unknown staff member and lists filtered by status', async () => {
    const { token } = await createOwnerContext();
    const missing = await request(app)
      .post('/api/hrm/leave')
      .set('Authorization', `Bearer ${token}`)
      .send({ staffId: '000000000000000000000000', startDate: '2026-01-01', endDate: '2026-01-02' });
    expect(missing.status).toBe(404);

    const missingDecision = await request(app).post('/api/hrm/leave/000000000000000000000000/decision').set('Authorization', `Bearer ${token}`).send({ status: 'approved' });
    expect(missingDecision.status).toBe(404);

    const staff = await request(app).post('/api/hrm/staff').set('Authorization', `Bearer ${token}`).send({ name: 'Filter Leave', email: 'fl@example.com' });
    await request(app).post('/api/hrm/leave').set('Authorization', `Bearer ${token}`).send({ staffId: staff.body.staff._id, startDate: '2026-01-01', endDate: '2026-01-02' });
    const filtered = await request(app).get('/api/hrm/leave?status=pending').set('Authorization', `Bearer ${token}`);
    expect(filtered.body.leave).toHaveLength(1);
  });

  it('creates and lists HRM announcements', async () => {
    const { token } = await createOwnerContext();
    const create = await request(app).post('/api/hrm/announcements').set('Authorization', `Bearer ${token}`).send({ title: 'Holiday Notice', content: 'Office closed Friday' });
    expect(create.status).toBe(201);
    const list = await request(app).get('/api/hrm/announcements').set('Authorization', `Bearer ${token}`);
    expect(list.body.announcements).toHaveLength(1);
  });
});

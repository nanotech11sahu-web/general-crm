import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { Staff, STAFF_STATUSES } from '../models/Staff';
import { Department } from '../models/Department';
import { JobRole, JOB_ROLE_STATUSES } from '../models/JobRole';
import { Candidate, CANDIDATE_STAGES } from '../models/Candidate';
import { Interview } from '../models/Interview';
import { LeaveRequest, LEAVE_TYPES } from '../models/LeaveRequest';
import { Announcement } from '../models/Announcement';
import { computeOrgChart, listStaffWithManagerName } from '../services/orgChart.service';
import { notifyWorkspaceOwner } from '../services/notification.service';

export const hrmRouter = Router();

hrmRouter.use(authenticate);

// --- Dashboard ---
hrmRouter.get('/dashboard', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const workspaceId = req.auth!.workspaceId;
    const [headcount, pendingLeave, openApprovals] = await Promise.all([
      Staff.countDocuments({ workspaceId, status: 'active' }),
      LeaveRequest.countDocuments({ workspaceId, status: 'pending' }),
      LeaveRequest.countDocuments({ workspaceId, status: 'pending' }),
    ]);
    res.json({
      kpis: {
        headcount,
        presentToday: headcount,
        pendingLeave,
        payrollStatus: 'Not run this month',
        openApprovals,
        documentExpiries: 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// --- People (synced from Staff) ---
hrmRouter.get('/people', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const staff = await listStaffWithManagerName(req.auth!.workspaceId);
    res.json({ staff });
  } catch (err) {
    next(err);
  }
});

const staffSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  managerId: z.string().optional(),
  isTeacher: z.boolean().optional(),
  status: z.enum(STAFF_STATUSES).optional(),
});

hrmRouter.post('/staff', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = staffSchema.parse(req.body);
    const staff = await Staff.create({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ staff });
  } catch (err) {
    next(err);
  }
});

hrmRouter.patch('/staff/:id', requirePermission('operations', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = staffSchema.partial().parse(req.body);
    const staff = await Staff.findOneAndUpdate({ _id: req.params.id, workspaceId: req.auth!.workspaceId }, { $set: body }, { new: true });
    if (!staff) throw new HttpError(404, 'Staff member not found');
    res.json({ staff });
  } catch (err) {
    next(err);
  }
});

// --- Org Chart ---
hrmRouter.get('/org-chart', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const chart = await computeOrgChart(req.auth!.workspaceId);
    res.json(chart);
  } catch (err) {
    next(err);
  }
});

hrmRouter.get('/departments', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const departments = await Department.find({ workspaceId: req.auth!.workspaceId }).sort({ name: 1 }).lean();
    res.json({ departments });
  } catch (err) {
    next(err);
  }
});

const departmentSchema = z.object({ name: z.string().min(1) });

hrmRouter.post('/departments', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = departmentSchema.parse(req.body);
    const department = await Department.create({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ department });
  } catch (err) {
    next(err);
  }
});

// --- Hiring / ATS ---
hrmRouter.get('/roles', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (req.query.status && JOB_ROLE_STATUSES.includes(req.query.status as (typeof JOB_ROLE_STATUSES)[number])) {
      filter.status = req.query.status;
    }
    const roles = await JobRole.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ roles });
  } catch (err) {
    next(err);
  }
});

const roleSchema = z.object({
  title: z.string().min(1),
  department: z.string().optional(),
  location: z.string().optional(),
  active: z.boolean().optional(),
  status: z.enum(JOB_ROLE_STATUSES).optional(),
  openings: z.number().optional(),
  salaryRangeMin: z.number().optional(),
  salaryRangeMax: z.number().optional(),
});

hrmRouter.post('/roles', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = roleSchema.parse(req.body);
    const role = await JobRole.create({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ role });
  } catch (err) {
    next(err);
  }
});

hrmRouter.get('/candidates', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (req.query.roleId) filter.roleId = req.query.roleId;
    const candidates = await Candidate.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ candidates });
  } catch (err) {
    next(err);
  }
});

const candidateSchema = z.object({
  roleId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  stage: z.enum(CANDIDATE_STAGES).optional(),
});

hrmRouter.post('/candidates', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = candidateSchema.parse(req.body);
    const role = await JobRole.findOne({ _id: body.roleId, workspaceId: req.auth!.workspaceId });
    if (!role) throw new HttpError(404, 'Role not found');
    const candidate = await Candidate.create({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ candidate });
  } catch (err) {
    next(err);
  }
});

hrmRouter.patch('/candidates/:id', requirePermission('operations', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = candidateSchema.partial().parse(req.body);
    const candidate = await Candidate.findOneAndUpdate({ _id: req.params.id, workspaceId: req.auth!.workspaceId }, { $set: body }, { new: true });
    if (!candidate) throw new HttpError(404, 'Candidate not found');
    res.json({ candidate });
  } catch (err) {
    next(err);
  }
});

hrmRouter.get('/interviews', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (req.query.candidateId) filter.candidateId = req.query.candidateId;
    const interviews = await Interview.find(filter).sort({ scheduledAt: 1 }).lean();
    res.json({ interviews });
  } catch (err) {
    next(err);
  }
});

const interviewSchema = z.object({
  candidateId: z.string().min(1),
  roleId: z.string().min(1),
  interviewerStaffId: z.string().optional(),
  scheduledAt: z.string().min(1),
});

hrmRouter.post('/interviews', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = interviewSchema.parse(req.body);
    const candidate = await Candidate.findOne({ _id: body.candidateId, workspaceId: req.auth!.workspaceId });
    if (!candidate) throw new HttpError(404, 'Candidate not found');
    const interview = await Interview.create({
      workspaceId: req.auth!.workspaceId,
      ...body,
      scheduledAt: new Date(body.scheduledAt),
    });
    res.status(201).json({ interview });
  } catch (err) {
    next(err);
  }
});

hrmRouter.patch('/interviews/:id', requirePermission('operations', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ status: z.enum(['scheduled', 'completed', 'cancelled']).optional(), feedback: z.string().optional() }).parse(req.body);
    const interview = await Interview.findOneAndUpdate({ _id: req.params.id, workspaceId: req.auth!.workspaceId }, { $set: body }, { new: true });
    if (!interview) throw new HttpError(404, 'Interview not found');
    res.json({ interview });
  } catch (err) {
    next(err);
  }
});

// --- Leave ---
hrmRouter.get('/leave', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (req.query.status) filter.status = req.query.status;
    const leave = await LeaveRequest.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ leave });
  } catch (err) {
    next(err);
  }
});

const leaveSchema = z.object({
  staffId: z.string().min(1),
  type: z.enum(LEAVE_TYPES).optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().optional(),
});

hrmRouter.post('/leave', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = leaveSchema.parse(req.body);
    const staff = await Staff.findOne({ _id: body.staffId, workspaceId: req.auth!.workspaceId });
    if (!staff) throw new HttpError(404, 'Staff member not found');
    const leave = await LeaveRequest.create({
      workspaceId: req.auth!.workspaceId,
      ...body,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    });
    await notifyWorkspaceOwner(
      req.auth!.workspaceId,
      'operations.leavePending',
      'Leave request pending approval',
      `${staff.name} requested ${body.type ?? ''} leave`,
      '/operations',
    );
    res.status(201).json({ leave });
  } catch (err) {
    next(err);
  }
});

hrmRouter.post('/leave/:id/decision', requirePermission('operations', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ status: z.enum(['approved', 'rejected']) }).parse(req.body);
    const leave = await LeaveRequest.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: { status: body.status } },
      { new: true },
    );
    if (!leave) throw new HttpError(404, 'Leave request not found');
    res.json({ leave });
  } catch (err) {
    next(err);
  }
});

// --- Announcements ---
hrmRouter.get('/announcements', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const announcements = await Announcement.find({ workspaceId: req.auth!.workspaceId, audience: 'hrm' }).sort({ createdAt: -1 }).lean();
    res.json({ announcements });
  } catch (err) {
    next(err);
  }
});

const announcementSchema = z.object({ title: z.string().min(1), content: z.string().min(1) });

hrmRouter.post('/announcements', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = announcementSchema.parse(req.body);
    const announcement = await Announcement.create({ workspaceId: req.auth!.workspaceId, audience: 'hrm', ...body });
    res.status(201).json({ announcement });
  } catch (err) {
    next(err);
  }
});

export default hrmRouter;

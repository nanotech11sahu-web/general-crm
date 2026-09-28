import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { AcademicYear } from '../models/AcademicYear';
import { SchoolClass } from '../models/SchoolClass';
import { Subject } from '../models/Subject';
import { Staff } from '../models/Staff';
import { Student, STUDENT_STATUSES } from '../models/Student';
import { Announcement } from '../models/Announcement';
import { computeSetupProgress } from '../services/schoolSetup.service';

export const schoolRouter = Router();

schoolRouter.use(authenticate);

schoolRouter.get('/dashboard', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const workspaceId = req.auth!.workspaceId;
    const [students, teachers, classes] = await Promise.all([
      Student.countDocuments({ workspaceId, status: 'active' }),
      Staff.countDocuments({ workspaceId, isTeacher: true, status: 'active' }),
      SchoolClass.countDocuments({ workspaceId }),
    ]);
    res.json({
      kpis: { students, teachers, classes, attendancePercent: 0, eventsToday: 0 },
    });
  } catch (err) {
    next(err);
  }
});

schoolRouter.get('/setup-progress', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const progress = await computeSetupProgress(req.auth!.workspaceId);
    res.json(progress);
  } catch (err) {
    next(err);
  }
});

schoolRouter.get('/academic-years', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const academicYears = await AcademicYear.find({ workspaceId: req.auth!.workspaceId }).sort({ startDate: -1 }).lean();
    res.json({ academicYears });
  } catch (err) {
    next(err);
  }
});

const academicYearSchema = z.object({ name: z.string().min(1), startDate: z.string().min(1), endDate: z.string().min(1), active: z.boolean().optional() });

schoolRouter.post('/academic-years', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = academicYearSchema.parse(req.body);
    const academicYear = await AcademicYear.create({
      workspaceId: req.auth!.workspaceId,
      ...body,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    });
    res.status(201).json({ academicYear });
  } catch (err) {
    next(err);
  }
});

schoolRouter.get('/classes', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const classes = await SchoolClass.find({ workspaceId: req.auth!.workspaceId }).sort({ name: 1 }).lean();
    res.json({ classes });
  } catch (err) {
    next(err);
  }
});

const classSchema = z.object({ name: z.string().min(1), sections: z.array(z.string()).optional() });

schoolRouter.post('/classes', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = classSchema.parse(req.body);
    const schoolClass = await SchoolClass.create({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ schoolClass });
  } catch (err) {
    next(err);
  }
});

schoolRouter.get('/subjects', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const subjects = await Subject.find({ workspaceId: req.auth!.workspaceId }).sort({ name: 1 }).lean();
    res.json({ subjects });
  } catch (err) {
    next(err);
  }
});

const subjectSchema = z.object({ name: z.string().min(1), classId: z.string().optional() });

schoolRouter.post('/subjects', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = subjectSchema.parse(req.body);
    const subject = await Subject.create({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ subject });
  } catch (err) {
    next(err);
  }
});

schoolRouter.get('/students', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (req.query.status && STUDENT_STATUSES.includes(req.query.status as (typeof STUDENT_STATUSES)[number])) {
      filter.status = req.query.status;
    }
    const students = await Student.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ students });
  } catch (err) {
    next(err);
  }
});

const studentSchema = z.object({
  name: z.string().min(1),
  classId: z.string().optional(),
  section: z.string().optional(),
  parentContactId: z.string().optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
});

schoolRouter.post('/students', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = studentSchema.parse(req.body);
    const student = await Student.create({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ student });
  } catch (err) {
    next(err);
  }
});

schoolRouter.get('/announcements', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const announcements = await Announcement.find({ workspaceId: req.auth!.workspaceId, audience: 'school' }).sort({ createdAt: -1 }).lean();
    res.json({ announcements });
  } catch (err) {
    next(err);
  }
});

const announcementSchema = z.object({ title: z.string().min(1), content: z.string().min(1) });

schoolRouter.post('/announcements', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = announcementSchema.parse(req.body);
    const announcement = await Announcement.create({ workspaceId: req.auth!.workspaceId, audience: 'school', ...body });
    res.status(201).json({ announcement });
  } catch (err) {
    next(err);
  }
});

schoolRouter.get('/portal-access', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const workspaceId = req.auth!.workspaceId;
    const [students, teachers] = await Promise.all([
      Student.countDocuments({ workspaceId, status: 'active' }),
      Staff.countDocuments({ workspaceId, isTeacher: true, status: 'active' }),
    ]);
    res.json({
      portals: [
        { role: 'student', accountsEnabled: 0, total: students },
        { role: 'parent', accountsEnabled: 0, total: students },
        { role: 'teacher', accountsEnabled: 0, total: teachers },
      ],
    });
  } catch (err) {
    next(err);
  }
});

export default schoolRouter;

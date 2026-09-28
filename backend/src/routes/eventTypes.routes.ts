import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { EventType, LOCATION_TYPES, ASSIGNMENT_METHODS } from '../models/EventType';
import { DeletedItem } from '../models/DeletedItem';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { computeEventTypeIssues, computeAvailableSlots } from '../services/eventType.service';
import { CALENDAR_TEMPLATE_CATALOG, CALENDAR_TEMPLATE_CATEGORIES } from '../constants/calendarTemplates';

export const eventTypesRouter = Router();

eventTypesRouter.use(authenticate);

eventTypesRouter.get('/templates', requirePermission('calendar', 'read'), async (_req, res) => {
  res.json({ categories: CALENDAR_TEMPLATE_CATEGORIES, templates: CALENDAR_TEMPLATE_CATALOG });
});

eventTypesRouter.get('/', requirePermission('calendar', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const eventTypes = await EventType.find({ workspaceId: req.auth!.workspaceId, archived: false }).sort({ createdAt: -1 }).lean();
    res.json({ eventTypes });
  } catch (err) {
    next(err);
  }
});

const availabilityWindowSchema = z.object({
  day: z.number().min(0).max(6),
  enabled: z.boolean(),
  startTime: z.string(),
  endTime: z.string(),
});

const bookingFormFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'email', 'phone', 'textarea', 'select']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

const createEventTypeSchema = z.object({
  name: z.string().min(1),
  templateKey: z.string().optional(),
  templateCategory: z.string().optional(),
});

eventTypesRouter.post('/', requirePermission('calendar', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createEventTypeSchema.parse(req.body);
    const template = CALENDAR_TEMPLATE_CATALOG.find((t) => t.key === body.templateKey);
    const eventType = await EventType.create({
      workspaceId: req.auth!.workspaceId,
      name: body.name,
      durationMinutes: template?.durationMinutes ?? 30,
      templateKey: template?.key ?? 'scratch',
      templateCategory: template?.category ?? body.templateCategory ?? 'Custom',
      publicId: crypto.randomBytes(6).toString('hex'),
    });
    res.status(201).json({ eventType });
  } catch (err) {
    next(err);
  }
});

eventTypesRouter.get('/:id', requirePermission('calendar', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const eventType = await EventType.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!eventType) throw new HttpError(404, 'Event type not found');
    const issues = computeEventTypeIssues(eventType);
    res.json({ eventType, issues });
  } catch (err) {
    next(err);
  }
});

const updateEventTypeSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  durationMinutes: z.number().min(1).optional(),
  locationType: z.enum(LOCATION_TYPES).optional(),
  locationDetails: z.string().optional(),
  availability: z.array(availabilityWindowSchema).optional(),
  timezone: z.string().optional(),
  bufferBeforeMinutes: z.number().min(0).optional(),
  bufferAfterMinutes: z.number().min(0).optional(),
  minNoticeHours: z.number().min(0).optional(),
  dateRangeDays: z.number().min(1).optional(),
  staffMembershipIds: z.array(z.string()).optional(),
  assignmentMethod: z.enum(ASSIGNMENT_METHODS).optional(),
  requirePayment: z.boolean().optional(),
  price: z.number().min(0).optional(),
  currency: z.string().optional(),
  requireApproval: z.boolean().optional(),
  confirmationMessage: z.string().optional(),
  bookingFormFields: z.array(bookingFormFieldSchema).optional(),
});

eventTypesRouter.patch('/:id', requirePermission('calendar', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateEventTypeSchema.parse(req.body);
    const eventType = await EventType.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!eventType) throw new HttpError(404, 'Event type not found');
    Object.assign(eventType, body);
    await eventType.save();
    const issues = computeEventTypeIssues(eventType);
    res.json({ eventType, issues });
  } catch (err) {
    next(err);
  }
});

eventTypesRouter.post('/:id/publish', requirePermission('calendar', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const eventType = await EventType.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!eventType) throw new HttpError(404, 'Event type not found');
    const issues = computeEventTypeIssues(eventType);
    if (issues.length > 0) throw new HttpError(400, `Cannot publish — ${issues.length} issue(s) found`);
    eventType.status = 'published';
    await eventType.save();
    res.json({ eventType });
  } catch (err) {
    next(err);
  }
});

eventTypesRouter.post('/:id/unpublish', requirePermission('calendar', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const eventType = await EventType.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: { status: 'draft' } },
      { new: true },
    );
    if (!eventType) throw new HttpError(404, 'Event type not found');
    res.json({ eventType });
  } catch (err) {
    next(err);
  }
});

eventTypesRouter.get('/:id/slots', requirePermission('calendar', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const eventType = await EventType.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!eventType) throw new HttpError(404, 'Event type not found');
    const date = String(req.query.date ?? '');
    const slots = await computeAvailableSlots(eventType, date);
    res.json({ slots });
  } catch (err) {
    next(err);
  }
});

eventTypesRouter.delete('/:id', requirePermission('calendar', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const eventType = await EventType.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!eventType) throw new HttpError(404, 'Event type not found');
    await DeletedItem.create({
      workspaceId: req.auth!.workspaceId,
      module: 'calendar',
      originalCollection: 'EventType',
      originalId: eventType._id,
      snapshot: eventType.toObject(),
      deletedBy: req.auth!.userId,
    });
    await eventType.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

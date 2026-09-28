import { Router } from 'express';
import { z } from 'zod';
import { Appointment, APPOINTMENT_STATUSES } from '../models/Appointment';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { emitAppointmentStatusEvent } from '../services/booking.service';

export const appointmentsRouter = Router();

appointmentsRouter.use(authenticate);

appointmentsRouter.get('/', requirePermission('calendar', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const query: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (req.query.contactId) query.contactId = req.query.contactId;
    if (req.query.staffMembershipId) query.staffMembershipId = req.query.staffMembershipId;
    if (req.query.status) query.status = req.query.status;
    if (req.query.from || req.query.to) {
      query.startAt = {
        ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}),
        ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {}),
      };
    }
    const appointments = await Appointment.find(query).sort({ startAt: 1 }).lean();
    res.json({ appointments });
  } catch (err) {
    next(err);
  }
});

const updateStatusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
});

appointmentsRouter.patch('/:id', requirePermission('calendar', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateStatusSchema.parse(req.body);
    const appointment = await Appointment.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!appointment) throw new HttpError(404, 'Appointment not found');

    appointment.status = body.status;
    if (body.startAt) appointment.startAt = new Date(body.startAt);
    if (body.endAt) appointment.endAt = new Date(body.endAt);
    await appointment.save();

    emitAppointmentStatusEvent(String(appointment.workspaceId), String(appointment.contactId), String(appointment._id), body.status);

    res.json({ appointment });
  } catch (err) {
    next(err);
  }
});

import { Router } from 'express';
import { z } from 'zod';
import { Form } from '../models/Form';
import { Funnel } from '../models/Funnel';
import { EventType } from '../models/EventType';
import { HttpError } from '../middleware/errorHandler';
import { submitForm } from '../services/formSubmission.service';
import { computeAvailableSlots } from '../services/eventType.service';
import { bookAppointment } from '../services/booking.service';

export const publicRouter = Router();

// --- Rate limiting (in-memory, per resource+IP, sliding hour window) ---
const submissionLog = new Map<string, number[]>();

function isRateLimited(resourceKey: string, ip: string, limitPerHour: number): boolean {
  const key = `${resourceKey}:${ip}`;
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const timestamps = (submissionLog.get(key) ?? []).filter((t) => t > hourAgo);
  if (timestamps.length >= limitPerHour) {
    submissionLog.set(key, timestamps);
    return true;
  }
  timestamps.push(now);
  submissionLog.set(key, timestamps);
  return false;
}

// Booking pages have no per-event-type rate limit field like Forms do, so a flat cap
// per event-type+IP guards against scripted slot-hogging without needing new schema.
const BOOKING_RATE_LIMIT_PER_HOUR = 20;

publicRouter.get('/forms/:id', async (req, res, next) => {
  try {
    const form = await Form.findOne({ _id: req.params.id, status: 'published', archived: false }).lean();
    if (!form) throw new HttpError(404, 'Form not found or not published');
    res.json({
      form: {
        id: form._id,
        name: form.name,
        fields: form.fields,
        style: form.style,
        settings: { gdprConsent: form.settings.gdprConsent, onSubmitAction: form.settings.onSubmitAction },
      },
    });
  } catch (err) {
    next(err);
  }
});

const submitSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  notARobot: z.boolean().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  referrer: z.string().optional(),
});

publicRouter.post('/forms/:id/submit', async (req, res, next) => {
  try {
    const form = await Form.findOne({ _id: req.params.id, status: 'published', archived: false });
    if (!form) throw new HttpError(404, 'Form not found or not published');

    const ip = req.ip ?? 'unknown';
    if (isRateLimited(`form:${form._id}`, ip, form.settings.rateLimitPerHour)) {
      throw new HttpError(429, 'Too many submissions. Please try again later.');
    }

    const body = submitSchema.parse(req.body);
    if (form.settings.requireCaptcha && !body.notARobot) {
      throw new HttpError(400, 'Please confirm you are not a robot.');
    }
    if (form.settings.gdprConsent && body.data.consent !== true) {
      throw new HttpError(400, 'Consent is required to submit this form.');
    }

    const submission = await submitForm({
      form,
      data: body.data,
      meta: {
        ip,
        utmSource: body.utmSource,
        utmMedium: body.utmMedium,
        utmCampaign: body.utmCampaign,
        referrer: body.referrer,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      submissionId: submission._id,
      onSubmitAction: form.settings.onSubmitAction,
      message: form.settings.onSubmitMessage,
      redirectUrl: form.settings.redirectUrl,
    });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/booking/:publicId', async (req, res, next) => {
  try {
    const eventType = await EventType.findOne({ publicId: req.params.publicId, status: 'published', archived: false }).lean();
    if (!eventType) throw new HttpError(404, 'Booking page not found or not published');
    res.json({
      eventType: {
        id: eventType._id,
        name: eventType.name,
        description: eventType.description,
        durationMinutes: eventType.durationMinutes,
        locationType: eventType.locationType,
        locationDetails: eventType.locationDetails,
        timezone: eventType.timezone,
        requirePayment: eventType.requirePayment,
        price: eventType.price,
        currency: eventType.currency,
        bookingFormFields: eventType.bookingFormFields,
      },
    });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/booking/:publicId/slots', async (req, res, next) => {
  try {
    const eventType = await EventType.findOne({ publicId: req.params.publicId, status: 'published', archived: false });
    if (!eventType) throw new HttpError(404, 'Booking page not found or not published');
    const date = String(req.query.date ?? '');
    const slots = await computeAvailableSlots(eventType, date);
    res.json({ slots });
  } catch (err) {
    next(err);
  }
});

const bookSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  formResponses: z.record(z.string(), z.unknown()),
});

publicRouter.post('/booking/:publicId/book', async (req, res, next) => {
  try {
    const eventType = await EventType.findOne({ publicId: req.params.publicId, status: 'published', archived: false });
    if (!eventType) throw new HttpError(404, 'Booking page not found or not published');

    const ip = req.ip ?? 'unknown';
    if (isRateLimited(`booking:${eventType._id}`, ip, BOOKING_RATE_LIMIT_PER_HOUR)) {
      throw new HttpError(429, 'Too many booking attempts. Please try again later.');
    }

    const body = bookSchema.parse(req.body);
    for (const field of eventType.bookingFormFields) {
      if (field.required && !body.formResponses[field.key]) {
        throw new HttpError(400, `${field.label} is required`);
      }
    }

    const requestedStart = new Date(body.startAt);
    const slotsForDay = await computeAvailableSlots(eventType, body.startAt.slice(0, 10));
    if (!slotsForDay.some((slot) => new Date(slot.startAt).getTime() === requestedStart.getTime())) {
      throw new HttpError(409, 'That time slot is no longer available. Please pick another.');
    }

    const { appointment } = await bookAppointment({
      eventType,
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      formResponses: body.formResponses,
    });

    res.status(201).json({ appointmentId: appointment._id, status: appointment.status });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/funnels/:publicId', async (req, res, next) => {
  try {
    const funnel = await Funnel.findOne({ publicId: req.params.publicId, archived: false }).lean();
    if (!funnel) throw new HttpError(404, 'Site not found');
    res.json({ funnel: { id: funnel._id, name: funnel.name, publicId: funnel.publicId, pages: funnel.pages.map((p) => ({ id: p.id, name: p.name, path: p.path, isHome: p.isHome, status: p.status })) } });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/funnels/:publicId/pages/*', async (req, res, next) => {
  try {
    const funnel = await Funnel.findOne({ publicId: req.params.publicId, archived: false }).lean();
    if (!funnel) throw new HttpError(404, 'Site not found');
    const path = `/${(req.params as unknown as { '0': string })['0'] ?? ''}`;
    const page = funnel.pages.find((p) => p.path === path || (path === '/' && p.isHome));
    if (!page || page.status !== 'active') throw new HttpError(404, 'Page not found or not published');
    res.json({ page, funnelName: funnel.name });
  } catch (err) {
    next(err);
  }
});

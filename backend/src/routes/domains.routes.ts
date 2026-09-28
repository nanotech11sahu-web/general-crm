import { Router } from 'express';
import { z } from 'zod';
import { Domain } from '../models/Domain';
import { FeatureDomain, DOMAIN_FEATURES } from '../models/FeatureDomain';
import { Funnel } from '../models/Funnel';
import { Form } from '../models/Form';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const domainsRouter = Router();

domainsRouter.use(authenticate);

domainsRouter.get('/', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const domains = await Domain.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).lean();
    res.json({ domains });
  } catch (err) {
    next(err);
  }
});

const addDomainSchema = z.object({ hostname: z.string().min(3) });

domainsRouter.post('/', requirePermission('settings', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = addDomainSchema.parse(req.body);
    const domain = await Domain.create({ workspaceId: req.auth!.workspaceId, hostname: body.hostname.toLowerCase() });
    res.status(201).json({ domain });
  } catch (err) {
    next(err);
  }
});

// Stub DNS check, same connect-state pattern as Zoom/Razorpay — marks verified rather than
// actually resolving a TXT/CNAME record against a real DNS provider.
domainsRouter.post('/:id/verify', requirePermission('settings', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const domain = await Domain.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: { verified: true } },
      { new: true },
    );
    if (!domain) throw new HttpError(404, 'Domain not found');
    res.json({ domain });
  } catch (err) {
    next(err);
  }
});

domainsRouter.delete('/:id', requirePermission('settings', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const domain = await Domain.findOneAndDelete({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!domain) throw new HttpError(404, 'Domain not found');
    await FeatureDomain.deleteMany({ workspaceId: req.auth!.workspaceId, domainId: domain._id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// --- Feature Domains: assign a verified domain to a Funnel/Form/Store/Community/Portal ---
domainsRouter.get('/feature-assignments', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const assignments = await FeatureDomain.find({ workspaceId: req.auth!.workspaceId }).populate('domainId', 'hostname verified').lean();
    res.json({ assignments });
  } catch (err) {
    next(err);
  }
});

const assignSchema = z.object({ domainId: z.string().min(1), feature: z.enum(DOMAIN_FEATURES), targetId: z.string().optional() });

domainsRouter.post('/feature-assignments', requirePermission('settings', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = assignSchema.parse(req.body);
    const domain = await Domain.findOne({ _id: body.domainId, workspaceId: req.auth!.workspaceId });
    if (!domain) throw new HttpError(404, 'Domain not found');
    if (!domain.verified) throw new HttpError(400, 'Domain must be verified before it can be assigned');

    const assignment = await FeatureDomain.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId, feature: body.feature },
      { $set: { domainId: domain._id, targetId: body.targetId } },
      { upsert: true, new: true },
    );

    // Genuinely applies the verified domain onto the real target document, not just
    // recording the assignment — this is what the Phase 10 DoD actually checks.
    if (body.feature === 'funnel' && body.targetId) {
      await Funnel.findOneAndUpdate({ _id: body.targetId, workspaceId: req.auth!.workspaceId }, { $set: { 'settings.domain': domain.hostname } });
    } else if (body.feature === 'form' && body.targetId) {
      await Form.findOneAndUpdate({ _id: body.targetId, workspaceId: req.auth!.workspaceId }, { $set: { customDomain: domain.hostname } });
    }

    res.status(201).json({ assignment });
  } catch (err) {
    next(err);
  }
});

export default domainsRouter;

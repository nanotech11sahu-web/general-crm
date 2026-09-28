import { Router } from 'express';
import { z } from 'zod';
import { CallLog } from '../models/CallLog';
import { CallProviderConnection, CALL_PROVIDER_CATALOG } from '../models/CallProviderConnection';
import { SalesActivity } from '../models/SalesActivity';
import { Membership } from '../models/Membership';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';

export const ivrRouter = Router();

ivrRouter.use(authenticate);

ivrRouter.get('/overview', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const calls = await CallLog.find({ workspaceId: req.auth!.workspaceId }).lean();
    const totalCalls = calls.length;
    const connected = calls.filter((c) => c.status === 'completed').length;
    const missed = calls.filter((c) => c.status === 'missed').length;
    const talkTimeSeconds = calls.reduce((sum, c) => sum + c.durationSeconds, 0);
    const uniqueClients = new Set(calls.filter((c) => c.contactId).map((c) => String(c.contactId))).size;
    const agentsActive = new Set(calls.filter((c) => c.agentMembershipId).map((c) => String(c.agentMembershipId))).size;
    res.json({ kpis: { totalCalls, connected, missed, talkTimeSeconds, uniqueClients, agentsActive } });
  } catch (err) {
    next(err);
  }
});

ivrRouter.get('/calls', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const query: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (req.query.direction) query.direction = req.query.direction;
    if (req.query.status) query.status = req.query.status;
    if (req.query.agentMembershipId) query.agentMembershipId = req.query.agentMembershipId;
    if (req.query.source) query.source = req.query.source;
    if (req.query.pipelineId) query.pipelineId = req.query.pipelineId;
    const calls = await CallLog.find(query).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ calls });
  } catch (err) {
    next(err);
  }
});

ivrRouter.get('/agents', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const memberships = await Membership.find({ workspaceId: req.auth!.workspaceId }).populate('userId', 'name email').lean();
    res.json({ agents: memberships });
  } catch (err) {
    next(err);
  }
});

ivrRouter.get('/providers', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const connections = await CallProviderConnection.find({ workspaceId: req.auth!.workspaceId }).lean();
    const providers = CALL_PROVIDER_CATALOG.map((p) => ({
      ...p,
      connected: connections.find((c) => c.providerKey === p.key)?.connected ?? false,
    }));
    res.json({ providers });
  } catch (err) {
    next(err);
  }
});

ivrRouter.post('/providers/:key/connect', requirePermission('sales', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const provider = CALL_PROVIDER_CATALOG.find((p) => p.key === req.params.key);
    if (!provider) return res.status(404).json({ error: 'Unknown provider' });
    const connection = await CallProviderConnection.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId, providerKey: req.params.key },
      { $set: { connected: true, connectedAt: new Date() } },
      { upsert: true, new: true },
    );
    res.json({ providerKey: connection.providerKey, connected: connection.connected });
  } catch (err) {
    next(err);
  }
});

const dialSchema = z.object({
  toNumber: z.string().min(1),
  contactId: z.string().optional(),
  source: z.string().optional(),
});

ivrRouter.post('/dial', requirePermission('sales', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = dialSchema.parse(req.body);
    const durationSeconds = 30 + Math.floor(Math.random() * 240);
    const call = await CallLog.create({
      workspaceId: req.auth!.workspaceId,
      direction: 'outbound' as const,
      status: 'completed',
      fromNumber: 'workspace-line',
      toNumber: body.toNumber,
      agentMembershipId: req.auth!.membershipId,
      contactId: body.contactId,
      source: body.source ?? 'Manual Dial',
      durationSeconds,
    });

    await SalesActivity.create({
      workspaceId: req.auth!.workspaceId,
      membershipId: req.auth!.membershipId,
      type: 'call',
      note: `Dialed ${body.toNumber}`,
    });

    res.status(201).json({ call });
  } catch (err) {
    next(err);
  }
});

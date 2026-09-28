import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { listConversations, getConversationMessages, replyToConversation, simulateInboundChatWidgetMessage, setStarred, setSnoozed } from '../services/inbox.service';
import { CannedReply } from '../models/CannedReply';

export const inboxRouter = Router();

inboxRouter.use(authenticate);

inboxRouter.get('/dashboard', requirePermission('inbox', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const conversations = await listConversations(req.auth!.workspaceId, 'all');
    const unread = conversations.filter((c) => c.unread).length;
    res.json({
      kpis: {
        totalConversations: conversations.length,
        unread,
        starred: conversations.filter((c) => c.starred).length,
        snoozed: conversations.filter((c) => c.snoozedUntil).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

const filterSchema = z.enum(['new', 'all', 'unread', 'starred', 'snoozed']);

inboxRouter.get('/conversations', requirePermission('inbox', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = filterSchema.safeParse(req.query.filter);
    const conversations = await listConversations(req.auth!.workspaceId, parsed.success ? parsed.data : 'all');
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
});

inboxRouter.get('/conversations/:contactId/messages', requirePermission('inbox', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const messages = await getConversationMessages(req.auth!.workspaceId, req.params.contactId);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

const replySchema = z.object({ channel: z.enum(['whatsapp', 'email', 'chatWidget']), message: z.string().min(1) });

inboxRouter.post('/conversations/:contactId/reply', requirePermission('inbox', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = replySchema.parse(req.body);
    const messages = await replyToConversation(req.auth!.workspaceId, req.params.contactId, body.channel, body.message);
    res.status(201).json({ messages });
  } catch (err) {
    next(err);
  }
});

const simulateSchema = z.object({ message: z.string().min(1) });

inboxRouter.post('/conversations/:contactId/simulate-inbound', requirePermission('inbox', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = simulateSchema.parse(req.body);
    const message = await simulateInboundChatWidgetMessage(req.auth!.workspaceId, req.params.contactId, body.message);
    if (!message) throw new HttpError(404, 'Contact not found');
    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

inboxRouter.post('/conversations/:contactId/star', requirePermission('inbox', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ starred: z.boolean() }).parse(req.body);
    const state = await setStarred(req.auth!.workspaceId, req.params.contactId, body.starred);
    res.json({ state });
  } catch (err) {
    next(err);
  }
});

inboxRouter.post('/conversations/:contactId/snooze', requirePermission('inbox', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ snoozedUntil: z.string().nullable() }).parse(req.body);
    const state = await setSnoozed(req.auth!.workspaceId, req.params.contactId, body.snoozedUntil ? new Date(body.snoozedUntil) : null);
    res.json({ state });
  } catch (err) {
    next(err);
  }
});

// --- Settings: canned replies ---
inboxRouter.get('/canned-replies', requirePermission('inbox', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const cannedReplies = await CannedReply.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).lean();
    res.json({ cannedReplies });
  } catch (err) {
    next(err);
  }
});

const cannedReplySchema = z.object({ title: z.string().min(1), body: z.string().min(1) });

inboxRouter.post('/canned-replies', requirePermission('inbox', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = cannedReplySchema.parse(req.body);
    const cannedReply = await CannedReply.create({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ cannedReply });
  } catch (err) {
    next(err);
  }
});

export default inboxRouter;

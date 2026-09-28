import { Router } from 'express';
import { z } from 'zod';
import { VaultFile } from '../models/VaultFile';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const vaultRouter = Router();

vaultRouter.use(authenticate);

vaultRouter.get('/files', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const folder = typeof req.query.folder === 'string' ? req.query.folder : undefined;
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (folder) filter.folder = folder;
    const files = await VaultFile.find(filter).sort({ createdAt: -1 }).lean();
    const allSizes = await VaultFile.find({ workspaceId: req.auth!.workspaceId }).select('sizeBytes').lean();
    const storageUsedBytes = allSizes.reduce((sum, f) => sum + f.sizeBytes, 0);
    res.json({ files, storageUsedBytes });
  } catch (err) {
    next(err);
  }
});

vaultRouter.get('/folders', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const folders = await VaultFile.distinct('folder', { workspaceId: req.auth!.workspaceId });
    res.json({ folders });
  } catch (err) {
    next(err);
  }
});

const uploadSchema = z.object({
  folder: z.string().optional(),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
});

vaultRouter.post('/files', requirePermission('settings', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = uploadSchema.parse(req.body);
    const sizeBytes = Math.ceil((body.dataBase64.length * 3) / 4);
    const file = await VaultFile.create({
      workspaceId: req.auth!.workspaceId,
      folder: body.folder ?? 'General',
      filename: body.filename,
      mimeType: body.mimeType,
      sizeBytes,
      url: `data:${body.mimeType};base64,${body.dataBase64}`,
    });
    res.status(201).json({ file: { ...file.toObject(), url: undefined }, id: file._id });
  } catch (err) {
    next(err);
  }
});

vaultRouter.get('/files/:id', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const file = await VaultFile.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!file) throw new HttpError(404, 'File not found');
    res.json({ file });
  } catch (err) {
    next(err);
  }
});

vaultRouter.delete('/files/:id', requirePermission('settings', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const file = await VaultFile.findOneAndDelete({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!file) throw new HttpError(404, 'File not found');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default vaultRouter;

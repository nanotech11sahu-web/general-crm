import { Router } from 'express';
import { z } from 'zod';
import { Contact } from '../models/Contact';
import { AppIntegration } from '../models/AppIntegration';
import { LeadImportJob, LEAD_IMPORT_SOURCES, LeadImportSourceKey } from '../models/LeadImportJob';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { parseCsv, rowsToLeads, importLeads, fetchGoogleSheetCsv, sampleLeadsFor, sourceLabel } from '../services/leadImport.service';

export const leadImportRouter = Router();

leadImportRouter.use(authenticate);

/** Sources that require a Settings > App Store integration to be connected before they can be used. */
const INTEGRATION_KEY_FOR_SOURCE: Partial<Record<LeadImportSourceKey, string>> = {
  google_sheets: 'google_sheets',
  facebook_lead_ads: 'facebook_lead_ads',
  instagram_lead_ads: 'instagram_lead_ads',
  other_crm: 'other_crm',
};

const SOURCE_DESCRIPTIONS: Record<LeadImportSourceKey, string> = {
  csv: 'Upload a CSV file exported from a spreadsheet — no integration required.',
  google_sheets: 'Pull rows directly from a shared Google Sheet.',
  facebook_lead_ads: 'Sync leads captured by your Facebook Lead Ads forms.',
  instagram_lead_ads: 'Sync leads captured by your Instagram Lead Ads forms.',
  website_forms: 'Leads from your own Forms/Funnels are added automatically — nothing to connect.',
  other_crm: 'Bring leads over from another CRM you have connected.',
  custom: 'Bring in leads from any other source as a CSV.',
};

async function isConnected(workspaceId: string, source: LeadImportSourceKey): Promise<boolean> {
  const integrationKey = INTEGRATION_KEY_FOR_SOURCE[source];
  if (!integrationKey) return true; // native sources (csv, website_forms, custom) need no integration
  const doc = await AppIntegration.findOne({ workspaceId, appKey: integrationKey });
  return doc?.connected ?? false;
}

leadImportRouter.get('/sources', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const workspaceId = req.auth!.workspaceId;
    const sources = await Promise.all(
      LEAD_IMPORT_SOURCES.map(async (key) => ({
        key,
        label: sourceLabel(key),
        description: SOURCE_DESCRIPTIONS[key],
        requiresIntegration: Boolean(INTEGRATION_KEY_FOR_SOURCE[key]),
        integrationKey: INTEGRATION_KEY_FOR_SOURCE[key] ?? null,
        connected: await isConnected(workspaceId, key),
      })),
    );
    res.json({ sources });
  } catch (err) {
    next(err);
  }
});

leadImportRouter.get('/jobs', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const jobs = await LeadImportJob.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
});

function requireConnected(connected: boolean, source: LeadImportSourceKey) {
  if (!connected) {
    throw new HttpError(
      400,
      `${sourceLabel(source)} is not connected yet. Connect it from Settings > App Store first.`,
    );
  }
}

const csvImportSchema = z.object({
  fileName: z.string().optional(),
  content: z.string().min(1, 'File is empty.'),
});

leadImportRouter.post('/csv', requirePermission('leadManagement', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = csvImportSchema.parse(req.body);
    const lowerName = (body.fileName ?? '').toLowerCase();
    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      throw new HttpError(400, 'Excel files are not supported directly yet — please export the sheet as CSV and upload that.');
    }
    const matrix = parseCsv(body.content);
    const { leads, errors } = rowsToLeads(matrix);
    if (leads.length === 0 && errors.length === 0) {
      throw new HttpError(400, 'No rows found in that file.');
    }
    const result = await importLeads({
      workspaceId: req.auth!.workspaceId,
      userId: req.auth!.userId,
      source: 'csv',
      fileName: body.fileName,
      leads,
      rowErrors: errors,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

const googleSheetsSchema = z.object({ sheetUrl: z.string().url() });

leadImportRouter.post('/google-sheets', requirePermission('leadManagement', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = googleSheetsSchema.parse(req.body);
    const connected = await isConnected(req.auth!.workspaceId, 'google_sheets');
    requireConnected(connected, 'google_sheets');

    const csvText = await fetchGoogleSheetCsv(body.sheetUrl);
    const matrix = parseCsv(csvText);
    const { leads, errors } = rowsToLeads(matrix);
    if (leads.length === 0 && errors.length === 0) {
      throw new HttpError(400, 'No rows found in that sheet.');
    }
    const result = await importLeads({
      workspaceId: req.auth!.workspaceId,
      userId: req.auth!.userId,
      source: 'google_sheets',
      fileName: body.sheetUrl,
      leads,
      rowErrors: errors,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

leadImportRouter.post(
  '/facebook-lead-ads/sync',
  requirePermission('leadManagement', 'create'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const connected = await isConnected(req.auth!.workspaceId, 'facebook_lead_ads');
      requireConnected(connected, 'facebook_lead_ads');
      const leads = sampleLeadsFor('facebook_lead_ads');
      const result = await importLeads({
        workspaceId: req.auth!.workspaceId,
        userId: req.auth!.userId,
        source: 'facebook_lead_ads',
        leads,
        rowErrors: [],
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

leadImportRouter.post(
  '/instagram-lead-ads/sync',
  requirePermission('leadManagement', 'create'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const connected = await isConnected(req.auth!.workspaceId, 'instagram_lead_ads');
      requireConnected(connected, 'instagram_lead_ads');
      const leads = sampleLeadsFor('instagram_lead_ads');
      const result = await importLeads({
        workspaceId: req.auth!.workspaceId,
        userId: req.auth!.userId,
        source: 'instagram_lead_ads',
        leads,
        rowErrors: [],
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

const otherCrmSchema = z.object({ content: z.string().min(1, 'File is empty.'), fileName: z.string().optional() });

leadImportRouter.post('/other-crm', requirePermission('leadManagement', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const connected = await isConnected(req.auth!.workspaceId, 'other_crm');
    requireConnected(connected, 'other_crm');
    const body = otherCrmSchema.parse(req.body);
    const matrix = parseCsv(body.content);
    const { leads, errors } = rowsToLeads(matrix);
    if (leads.length === 0 && errors.length === 0) {
      throw new HttpError(400, 'No rows found in that export.');
    }
    const result = await importLeads({
      workspaceId: req.auth!.workspaceId,
      userId: req.auth!.userId,
      source: 'other_crm',
      fileName: body.fileName,
      leads,
      rowErrors: errors,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

const customImportSchema = z.object({ content: z.string().min(1, 'File is empty.'), fileName: z.string().optional() });

leadImportRouter.post('/custom', requirePermission('leadManagement', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = customImportSchema.parse(req.body);
    const matrix = parseCsv(body.content);
    const { leads, errors } = rowsToLeads(matrix);
    if (leads.length === 0 && errors.length === 0) {
      throw new HttpError(400, 'No rows found in that file.');
    }
    const result = await importLeads({
      workspaceId: req.auth!.workspaceId,
      userId: req.auth!.userId,
      source: 'custom',
      fileName: body.fileName,
      leads,
      rowErrors: errors,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

leadImportRouter.get(
  '/website-forms/summary',
  requirePermission('leadManagement', 'read'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const count = await Contact.countDocuments({ workspaceId: req.auth!.workspaceId, source: 'Form' });
      res.json({ count });
    } catch (err) {
      next(err);
    }
  },
);

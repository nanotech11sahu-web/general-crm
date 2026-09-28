import { Types } from 'mongoose';
import { Contact } from '../models/Contact';
import { TimelineEvent } from '../models/TimelineEvent';
import { LeadImportJob, ILeadImportRowError, LeadImportSourceKey } from '../models/LeadImportJob';
import { emitPlatformEvent } from '../lib/eventBus';
import { HttpError } from '../middleware/errorHandler';

export interface ParsedLeadRow {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  city?: string;
  country?: string;
  tags?: string[];
}

const HEADER_ALIASES: Record<string, keyof ParsedLeadRow> = {
  name: 'name',
  fullname: 'name',
  'full name': 'name',
  'contact name': 'name',
  'lead name': 'name',
  email: 'email',
  'email address': 'email',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
  'mobile number': 'phone',
  company: 'company',
  'company name': 'company',
  organization: 'company',
  jobtitle: 'jobTitle',
  'job title': 'jobTitle',
  title: 'jobTitle',
  designation: 'jobTitle',
  city: 'city',
  country: 'country',
  tags: 'tags',
  tag: 'tags',
};

/** Minimal, dependency-free RFC4180-ish CSV parser (handles quoted fields, embedded commas/newlines, escaped quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const normalized = text.replace(/^﻿/, '');

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // skip, \n handles the row break
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export function rowsToLeads(matrix: string[][]): { leads: ParsedLeadRow[]; errors: ILeadImportRowError[] } {
  if (matrix.length === 0) return { leads: [], errors: [] };
  const headers = matrix[0].map((h) => h.trim().toLowerCase());
  const fieldForColumn = headers.map((h) => HEADER_ALIASES[h]);

  const leads: ParsedLeadRow[] = [];
  const errors: ILeadImportRowError[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    if (cells.every((c) => c.trim() === '')) continue;
    const lead: ParsedLeadRow = {};
    cells.forEach((raw, colIdx) => {
      const field = fieldForColumn[colIdx];
      const value = raw.trim();
      if (!field || !value) return;
      if (field === 'tags') {
        lead.tags = value.split(/[;,]/).map((t) => t.trim()).filter(Boolean);
      } else {
        (lead as Record<string, string>)[field] = value;
      }
    });

    if (!lead.name && lead.email) lead.name = lead.email.split('@')[0];
    if (!lead.name && lead.phone) lead.name = lead.phone;

    if (!lead.name && !lead.email && !lead.phone) {
      errors.push({ row: r + 1, message: 'Row has no name, email, or phone — skipped.' });
      continue;
    }
    leads.push(lead);
  }

  return { leads, errors };
}

const SOURCE_LABELS: Record<LeadImportSourceKey, string> = {
  csv: 'CSV / Excel Upload',
  google_sheets: 'Google Sheets',
  facebook_lead_ads: 'Facebook Lead Ads',
  instagram_lead_ads: 'Instagram Lead Ads',
  website_forms: 'Website / Landing Page Forms',
  other_crm: 'Other CRMs',
  custom: 'Other / Custom Source',
};

export function sourceLabel(source: LeadImportSourceKey): string {
  return SOURCE_LABELS[source];
}

export async function importLeads(params: {
  workspaceId: string;
  userId: string;
  source: LeadImportSourceKey;
  fileName?: string;
  leads: ParsedLeadRow[];
  rowErrors: ILeadImportRowError[];
}) {
  const { workspaceId, userId, source, fileName, leads, rowErrors } = params;
  const errors: ILeadImportRowError[] = [...rowErrors];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const label = sourceLabel(source);

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    try {
      let contact = lead.email
        ? await Contact.findOne({ workspaceId, email: lead.email.toLowerCase() })
        : null;

      if (contact) {
        contact.name = lead.name ?? contact.name;
        contact.phone = lead.phone ?? contact.phone;
        contact.company = lead.company ?? contact.company;
        contact.jobTitle = lead.jobTitle ?? contact.jobTitle;
        contact.city = lead.city ?? contact.city;
        contact.country = lead.country ?? contact.country;
        contact.attributionLatest = { source: label, date: new Date() };
        await contact.save();
        await TimelineEvent.create({
          workspaceId,
          contactId: contact._id,
          type: 'lead_import_updated',
          message: `Updated via ${label} import.`,
        });
        updatedCount++;
      } else {
        contact = await Contact.create({
          workspaceId,
          name: lead.name ?? 'Unnamed Lead',
          email: lead.email,
          phone: lead.phone,
          company: lead.company,
          jobTitle: lead.jobTitle,
          city: lead.city,
          country: lead.country,
          source: label,
          attributionFirst: { source: label, date: new Date() },
          attributionLatest: { source: label, date: new Date() },
        });
        await TimelineEvent.create({
          workspaceId,
          contactId: contact._id,
          type: 'contact_created',
          message: `${contact.name} was imported via ${label}.`,
        });
        emitPlatformEvent('contact.created', { workspaceId, contactId: String(contact._id) });
        createdCount++;
      }
    } catch (err) {
      skippedCount++;
      errors.push({ row: i + 2, message: err instanceof Error ? err.message : 'Failed to import row.' });
    }
  }

  const job = await LeadImportJob.create({
    workspaceId: new Types.ObjectId(workspaceId),
    source,
    label,
    fileName,
    status: 'completed',
    totalRows: leads.length + rowErrors.length,
    createdCount,
    updatedCount,
    skippedCount,
    rowErrors: errors,
    createdBy: new Types.ObjectId(userId),
  });

  return { job, createdCount, updatedCount, skippedCount, errors };
}

function googleSheetsCsvUrl(sheetUrl: string): string {
  const idMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    throw new HttpError(400, 'That does not look like a valid Google Sheets URL.');
  }
  const gidMatch = sheetUrl.match(/[?&#]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gid}`;
}

export async function fetchGoogleSheetCsv(sheetUrl: string): Promise<string> {
  const url = googleSheetsCsvUrl(sheetUrl);
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new HttpError(400, 'Could not reach Google Sheets. Check the sharing settings and try again.');
  }
  if (!response.ok) {
    throw new HttpError(400, 'Could not read that sheet — make sure it is shared as "Anyone with the link can view".');
  }
  return response.text();
}

/**
 * Deterministic, clearly-labeled sample leads for ad-platform sources that have no real vendor
 * API wired up yet (same "labeled sample data, not fabricated as real" convention used by Vibe
 * Prospecting elsewhere in this codebase) — used once a workspace has connected the source via
 * Settings > App Store.
 */
export function sampleLeadsFor(source: 'facebook_lead_ads' | 'instagram_lead_ads'): ParsedLeadRow[] {
  const platform = source === 'facebook_lead_ads' ? 'Facebook' : 'Instagram';
  const now = Date.now();
  return [1, 2, 3].map((n) => ({
    name: `${platform} Lead ${n}`,
    email: `${platform.toLowerCase()}.lead${n}.${now}@sample-lead.example`,
    phone: `+1555010${String(n).padStart(4, '0')}`,
    company: `${platform} Sample Co ${n}`,
  }));
}

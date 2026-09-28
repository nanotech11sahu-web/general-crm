import { api } from '../apiClient';

export type LeadImportSourceKey =
  | 'csv'
  | 'google_sheets'
  | 'facebook_lead_ads'
  | 'instagram_lead_ads'
  | 'website_forms'
  | 'other_crm'
  | 'custom';

export interface LeadImportSource {
  key: LeadImportSourceKey;
  label: string;
  description: string;
  requiresIntegration: boolean;
  integrationKey: string | null;
  connected: boolean;
}

export interface LeadImportRowError {
  row: number;
  message: string;
}

export interface LeadImportResult {
  job: { _id: string; createdAt: string };
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: LeadImportRowError[];
}

export interface LeadImportJob {
  _id: string;
  source: LeadImportSourceKey;
  label: string;
  fileName?: string;
  status: 'completed' | 'failed';
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  rowErrors: LeadImportRowError[];
  createdAt: string;
}

export async function getLeadImportSources() {
  const res = await api.get('/lead-import/sources');
  return res.data.sources as LeadImportSource[];
}

export async function getLeadImportJobs() {
  const res = await api.get('/lead-import/jobs');
  return res.data.jobs as LeadImportJob[];
}

export async function importCsv(payload: { fileName: string; content: string }) {
  const res = await api.post('/lead-import/csv', payload);
  return res.data as LeadImportResult;
}

export async function importGoogleSheets(sheetUrl: string) {
  const res = await api.post('/lead-import/google-sheets', { sheetUrl });
  return res.data as LeadImportResult;
}

export async function syncFacebookLeadAds() {
  const res = await api.post('/lead-import/facebook-lead-ads/sync');
  return res.data as LeadImportResult;
}

export async function syncInstagramLeadAds() {
  const res = await api.post('/lead-import/instagram-lead-ads/sync');
  return res.data as LeadImportResult;
}

export async function importOtherCrm(payload: { fileName: string; content: string }) {
  const res = await api.post('/lead-import/other-crm', payload);
  return res.data as LeadImportResult;
}

export async function importCustom(payload: { fileName: string; content: string }) {
  const res = await api.post('/lead-import/custom', payload);
  return res.data as LeadImportResult;
}

export async function getWebsiteFormsSummary() {
  const res = await api.get('/lead-import/website-forms/summary');
  return res.data as { count: number };
}

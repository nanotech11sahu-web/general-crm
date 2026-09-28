import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FileSpreadsheet,
  Sheet,
  Megaphone,
  Camera,
  Globe2,
  Database,
  PlugZap,
  UploadCloud,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import {
  getLeadImportSources,
  getLeadImportJobs,
  importCsv,
  importGoogleSheets,
  importOtherCrm,
  importCustom,
  syncFacebookLeadAds,
  syncInstagramLeadAds,
  getWebsiteFormsSummary,
  type LeadImportResult,
  type LeadImportSourceKey,
} from '../../lib/api/leadImport';

const SOURCE_ICON: Record<LeadImportSourceKey, typeof FileSpreadsheet> = {
  csv: FileSpreadsheet,
  google_sheets: Sheet,
  facebook_lead_ads: Megaphone,
  instagram_lead_ads: Camera,
  website_forms: Globe2,
  other_crm: Database,
  custom: PlugZap,
};

const SOURCE_TONE: Record<LeadImportSourceKey, string> = {
  csv: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  google_sheets: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-300',
  facebook_lead_ads: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300',
  instagram_lead_ads: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  website_forms: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
  other_crm: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  custom: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300',
};

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function ResultSummary({ result }: { result: LeadImportResult }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        <strong>{result.createdCount}</strong> created, <strong>{result.updatedCount}</strong> updated,{' '}
        <strong>{result.skippedCount}</strong> skipped.
      </p>
      {result.errors.length > 0 && (
        <div className="max-h-32 overflow-y-auto rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2">
          {result.errors.map((e, i) => (
            <p key={i} className="text-xs text-[var(--color-text-muted)]">
              Row {e.row}: {e.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function FileImportModal({
  open,
  onClose,
  title,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onImport: (payload: { fileName: string; content: string }) => Promise<LeadImportResult>;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<LeadImportResult | null>(null);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const content = await readFileAsText(file);
      return onImport({ fileName: file.name, content });
    },
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
      queryClient.invalidateQueries({ queryKey: ['lead-import-jobs'] });
      toast('Import complete', { variant: 'success' });
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Import failed.';
      toast('Import failed', { description: message, variant: 'error' });
    },
  });

  function handleClose() {
    setFileName('');
    setResult(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <div className="space-y-4">
        <div
          className="flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-md)] border-2 border-dashed border-[var(--color-border)] p-8 text-center hover:border-[var(--color-primary)]"
          onClick={() => inputRef.current?.click()}
        >
          <UploadCloud className="h-8 w-8 text-[var(--color-text-muted)]" aria-hidden />
          <p className="text-sm font-medium">{fileName || 'Click to choose a CSV file'}</p>
          <p className="text-xs text-[var(--color-text-muted)]">Headers: name, email, phone, company, city, country, tags</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setResult(null);
              mutation.mutate(file);
            }}
          />
        </div>
        {mutation.isPending && <p className="text-sm text-[var(--color-text-muted)]">Importing…</p>}
        {result && <ResultSummary result={result} />}
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function GoogleSheetsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [sheetUrl, setSheetUrl] = useState('');
  const [result, setResult] = useState<LeadImportResult | null>(null);

  const mutation = useMutation({
    mutationFn: () => importGoogleSheets(sheetUrl),
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
      queryClient.invalidateQueries({ queryKey: ['lead-import-jobs'] });
      toast('Sheet imported', { variant: 'success' });
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Import failed.';
      toast('Import failed', { description: message, variant: 'error' });
    },
  });

  function handleClose() {
    setSheetUrl('');
    setResult(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Import from Google Sheets">
      <div className="space-y-4">
        <Input
          label="Google Sheets link"
          placeholder="https://docs.google.com/spreadsheets/d/…"
          value={sheetUrl}
          onChange={(e) => setSheetUrl(e.target.value)}
        />
        <p className="text-xs text-[var(--color-text-muted)]">
          The sheet must be shared as "Anyone with the link can view." First row should be column headers (name, email, phone…).
        </p>
        {result && <ResultSummary result={result} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button size="sm" loading={mutation.isPending} disabled={!sheetUrl} onClick={() => mutation.mutate()}>
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function LeadImportPage() {
  const queryClient = useQueryClient();
  const { data: sources, isLoading } = useQuery({ queryKey: ['lead-import-sources'], queryFn: getLeadImportSources });
  const { data: jobs } = useQuery({ queryKey: ['lead-import-jobs'], queryFn: getLeadImportJobs });
  const { data: formsSummary } = useQuery({ queryKey: ['lead-import-website-forms'], queryFn: getWebsiteFormsSummary });

  const [csvOpen, setCsvOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [crmOpen, setCrmOpen] = useState(false);
  const [sheetsOpen, setSheetsOpen] = useState(false);

  const syncMutation = useMutation({
    mutationFn: (source: 'facebook_lead_ads' | 'instagram_lead_ads') =>
      source === 'facebook_lead_ads' ? syncFacebookLeadAds() : syncInstagramLeadAds(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
      queryClient.invalidateQueries({ queryKey: ['lead-import-jobs'] });
      toast('Sync complete', { description: `${res.createdCount} new leads pulled in.`, variant: 'success' });
    },
    onError: () => toast('Sync failed', { variant: 'error' }),
  });

  if (isLoading || !sources) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="h-40">
            <Skeleton className="h-11 w-11 rounded-2xl" />
            <Skeleton className="mt-4 h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-full" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map((source) => {
          const Icon = SOURCE_ICON[source.key];
          const isNative = !source.requiresIntegration;
          return (
            <Card key={source.key} className="flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${SOURCE_TONE[source.key]}`}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                {isNative ? (
                  <Badge tone="success">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Always on
                  </Badge>
                ) : source.connected ? (
                  <Badge tone="success">Connected</Badge>
                ) : (
                  <Badge tone="neutral">Not connected</Badge>
                )}
              </div>
              <div>
                <h3 className="font-semibold">{source.label}</h3>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">{source.description}</p>
              </div>

              {source.key === 'website_forms' && (
                <p className="text-sm text-[var(--color-text-muted)]">
                  <strong>{formsSummary?.count ?? 0}</strong> leads captured from your Forms/Funnels so far.
                </p>
              )}

              <div className="mt-auto pt-1">
                {!isNative && !source.connected ? (
                  <Link to="/settings/app-store">
                    <Button variant="secondary" size="sm" className="w-full">
                      Connect in Settings <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                ) : source.key === 'csv' ? (
                  <Button size="sm" className="w-full" onClick={() => setCsvOpen(true)}>
                    <UploadCloud className="h-4 w-4" /> Import File
                  </Button>
                ) : source.key === 'google_sheets' ? (
                  <Button size="sm" className="w-full" onClick={() => setSheetsOpen(true)}>
                    <UploadCloud className="h-4 w-4" /> Import Sheet
                  </Button>
                ) : source.key === 'facebook_lead_ads' ? (
                  <Button
                    size="sm"
                    className="w-full"
                    loading={syncMutation.isPending && syncMutation.variables === 'facebook_lead_ads'}
                    onClick={() => syncMutation.mutate('facebook_lead_ads')}
                  >
                    <RefreshCw className="h-4 w-4" /> Sync Leads Now
                  </Button>
                ) : source.key === 'instagram_lead_ads' ? (
                  <Button
                    size="sm"
                    className="w-full"
                    loading={syncMutation.isPending && syncMutation.variables === 'instagram_lead_ads'}
                    onClick={() => syncMutation.mutate('instagram_lead_ads')}
                  >
                    <RefreshCw className="h-4 w-4" /> Sync Leads Now
                  </Button>
                ) : source.key === 'other_crm' ? (
                  <Button size="sm" className="w-full" onClick={() => setCrmOpen(true)}>
                    <UploadCloud className="h-4 w-4" /> Import Export File
                  </Button>
                ) : source.key === 'website_forms' ? (
                  <Button size="sm" variant="secondary" className="w-full" disabled>
                    Automatic
                  </Button>
                ) : (
                  <Button size="sm" className="w-full" onClick={() => setCustomOpen(true)}>
                    <UploadCloud className="h-4 w-4" /> Import File
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <h3 className="mb-3 font-semibold">Recent Imports</h3>
        {!jobs || jobs.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No imports yet — run one from a source above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="py-2 pr-4 font-medium">Source</th>
                  <th className="py-2 pr-4 font-medium">File</th>
                  <th className="py-2 pr-4 font-medium">Created</th>
                  <th className="py-2 pr-4 font-medium">Updated</th>
                  <th className="py-2 pr-4 font-medium">Skipped</th>
                  <th className="py-2 pr-4 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job._id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2 pr-4">{job.label}</td>
                    <td className="py-2 pr-4 text-[var(--color-text-muted)]">{job.fileName ?? '—'}</td>
                    <td className="py-2 pr-4">{job.createdCount}</td>
                    <td className="py-2 pr-4">{job.updatedCount}</td>
                    <td className="py-2 pr-4">{job.skippedCount}</td>
                    <td className="py-2 pr-4 text-[var(--color-text-muted)]">{new Date(job.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <FileImportModal open={csvOpen} onClose={() => setCsvOpen(false)} title="Import CSV / Excel" onImport={importCsv} />
      <FileImportModal open={customOpen} onClose={() => setCustomOpen(false)} title="Import Custom Source" onImport={importCustom} />
      <FileImportModal open={crmOpen} onClose={() => setCrmOpen(false)} title="Import from Other CRM" onImport={importOtherCrm} />
      <GoogleSheetsModal open={sheetsOpen} onClose={() => setSheetsOpen(false)} />
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { listDomains, addDomain, verifyDomain, listFeatureAssignments, assignFeatureDomain } from '../../lib/api/settings';
import { listFunnels } from '../../lib/api/funnels';
import { listForms } from '../../lib/api/forms';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const FEATURES = ['funnel', 'form', 'store', 'community', 'portal'] as const;

export function DomainsTab() {
  const queryClient = useQueryClient();
  const { data: domains, isLoading } = useQuery({ queryKey: ['settings-domains'], queryFn: listDomains });
  const { data: assignments } = useQuery({ queryKey: ['feature-assignments'], queryFn: listFeatureAssignments });
  const { data: funnels } = useQuery({ queryKey: ['funnels-for-domains'], queryFn: listFunnels });
  const { data: forms } = useQuery({ queryKey: ['forms-for-domains'], queryFn: listForms });
  const [hostname, setHostname] = useState('');

  const addMutation = useMutation({
    mutationFn: () => addDomain(hostname),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-domains'] });
      setHostname('');
      toast('Domain added — verify it to make it selectable', { variant: 'success' });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (id: string) => verifyDomain(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-domains'] });
      toast('Domain verified', { variant: 'success' });
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ domainId, feature, targetId }: { domainId: string; feature: string; targetId?: string }) => assignFeatureDomain({ domainId, feature, targetId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feature-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['funnels-for-domains'] });
      queryClient.invalidateQueries({ queryKey: ['forms-for-domains'] });
      toast('Domain applied', { variant: 'success' });
    },
  });

  if (isLoading) return <SkeletonList rows={3} />;

  const verifiedDomains = (domains ?? []).filter((d) => d.verified);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-2">
        <Input label="Add domain" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="go.mybrand.com" />
        <Button size="sm" disabled={!hostname} loading={addMutation.isPending} onClick={() => addMutation.mutate()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </Card>
      <div className="space-y-2">
        {(domains ?? []).map((d) => (
          <Card key={d._id} className="flex items-center justify-between">
            <span className="font-mono text-sm">{d.hostname}</span>
            {d.verified ? (
              <Badge tone="success">Verified</Badge>
            ) : (
              <Button size="sm" variant="secondary" loading={verifyMutation.isPending} onClick={() => verifyMutation.mutate(d._id)}>
                <ShieldCheck className="h-4 w-4" /> Verify
              </Button>
            )}
          </Card>
        ))}
      </div>

      <Card className="space-y-3">
        <h4 className="font-semibold">Feature Domains</h4>
        <p className="text-sm text-[var(--color-text-muted)]">Assign a verified domain to Funnels, Forms, Store, Community, or Portal.</p>
        {FEATURES.map((feature) => {
          const assignment = assignments?.find((a) => a.feature === feature);
          return (
            <div key={feature} className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-2 first:border-0 first:pt-0">
              <span className="w-24 shrink-0 text-sm capitalize">{feature}</span>
              <select
                aria-label={`Domain for ${feature}`}
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
                defaultValue={assignment?.domainId?._id ?? ''}
                onChange={(e) => {
                  const domainId = e.target.value;
                  if (!domainId) return;
                  if (feature === 'funnel' || feature === 'form') return; // needs target selection below
                  assignMutation.mutate({ domainId, feature });
                }}
                disabled={feature === 'funnel' || feature === 'form'}
              >
                <option value="">Select a verified domain…</option>
                {verifiedDomains.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.hostname}
                  </option>
                ))}
              </select>
              {feature === 'funnel' && (
                <select
                  aria-label="Funnel and domain"
                  className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
                  defaultValue=""
                  onChange={(e) => {
                    const [domainId, targetId] = e.target.value.split('|');
                    if (domainId && targetId) assignMutation.mutate({ domainId, feature: 'funnel', targetId });
                  }}
                >
                  <option value="">Apply verified domain to a Funnel…</option>
                  {verifiedDomains.flatMap((d) => (funnels ?? []).map((f) => <option key={`${d._id}-${f._id}`} value={`${d._id}|${f._id}`}>{`${d.hostname} → ${f.name}`}</option>))}
                </select>
              )}
              {feature === 'form' && (
                <select
                  aria-label="Form and domain"
                  className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
                  defaultValue=""
                  onChange={(e) => {
                    const [domainId, targetId] = e.target.value.split('|');
                    if (domainId && targetId) assignMutation.mutate({ domainId, feature: 'form', targetId });
                  }}
                >
                  <option value="">Apply verified domain to a Form…</option>
                  {verifiedDomains.flatMap((d) => (forms ?? []).map((f) => <option key={`${d._id}-${f._id}`} value={`${d._id}|${f._id}`}>{`${d.hostname} → ${f.name}`}</option>))}
                </select>
              )}
              {assignment && <Badge tone="success">{assignment.domainId.hostname}</Badge>}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

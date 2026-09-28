import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Sparkles, Wallet, UserPlus, CheckCircle2 } from 'lucide-react';
import { searchProspects, saveProspect, getVibeStats } from '../../lib/api/vibeProspecting';
import { api } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import type { VibeSearchDoc } from '../../types/leadgen2';

const QUICK_PROMPTS = ['Salon owners in Mumbai', 'SaaS founders in Bengaluru', 'Real estate agents in Delhi', 'Gyms in Pune', 'Restaurants in Hyderabad'];

export function VibeProspectingPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<VibeSearchDoc | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ['vibe-stats'], queryFn: getVibeStats });

  const searchMutation = useMutation({
    mutationFn: () => searchProspects(query),
    onSuccess: (res) => {
      setSearch(res.search);
      queryClient.invalidateQueries({ queryKey: ['vibe-stats'] });
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Search failed';
      toast(message, { variant: 'error' });
    },
  });

  const saveMutation = useMutation({
    mutationFn: (resultId: string) => saveProspect(search!._id, resultId),
    onSuccess: (_contact, resultId) => {
      setSearch((prev) => (prev ? { ...prev, results: prev.results.map((r) => (r.id === resultId ? { ...r, saved: true } : r)) } : prev));
      queryClient.invalidateQueries({ queryKey: ['vibe-stats'] });
      toast('Saved to CRM', { variant: 'success' });
    },
  });

  const topUpMutation = useMutation({
    mutationFn: () => api.post('/wallet/top-up', { amount: 100 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vibe-stats'] });
      toast('Wallet topped up', { variant: 'success', description: '+100 credits' });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Vibe Prospecting</h1>
        <Badge tone="success">NEW</Badge>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[var(--color-primary)]" />
          <p className="text-sm text-[var(--color-text-muted)]">Describe who you're looking for in plain language.</p>
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="Prospect search"
            placeholder="e.g. Salon owners in Mumbai"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button loading={searchMutation.isPending} disabled={!query} onClick={() => searchMutation.mutate()} className="gap-1.5">
            <Search className="h-4 w-4" /> Search
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((p) => (
            <button key={p} type="button" onClick={() => setQuery(p)} className="rounded-full bg-[var(--color-surface-muted)] px-3 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              {p}
            </button>
          ))}
        </div>
      </Card>

      {statsLoading ? (
        <SkeletonList rows={2} />
      ) : (
        stats && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card>
              <p className="text-sm text-[var(--color-text-muted)]">Searches Today</p>
              <p className="mt-1 text-xl font-semibold">{stats.searchesToday}</p>
            </Card>
            <Card>
              <p className="text-sm text-[var(--color-text-muted)]">Leads Saved</p>
              <p className="mt-1 text-xl font-semibold">{stats.leadsSaved}</p>
            </Card>
            <Card>
              <p className="text-sm text-[var(--color-text-muted)]">Credits Spent (7d)</p>
              <p className="mt-1 text-xl font-semibold">{stats.creditsSpent7d}</p>
            </Card>
            <Card className="flex items-center justify-between">
              <div>
                <p className="flex items-center gap-1 text-sm text-[var(--color-text-muted)]">
                  <Wallet className="h-4 w-4" /> Wallet Balance
                </p>
                <p className="mt-1 text-xl font-semibold">{stats.walletBalance}</p>
              </div>
              <Button size="sm" variant="secondary" loading={topUpMutation.isPending} onClick={() => topUpMutation.mutate()}>
                Top Up
              </Button>
            </Card>
          </div>
        )
      )}

      {search && (
        <Card className="space-y-2">
          <h3 className="font-semibold">Results for "{search.query}"</h3>
          {search.results.map((prospect) => (
            <div key={prospect.id} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
              <div>
                <p className="text-sm font-medium">{prospect.name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {prospect.title} at {prospect.company} · {prospect.city}
                </p>
              </div>
              {prospect.saved ? (
                <Badge tone="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Saved
                </Badge>
              ) : (
                <Button size="sm" variant="secondary" className="gap-1.5" loading={saveMutation.isPending} onClick={() => saveMutation.mutate(prospect.id)}>
                  <UserPlus className="h-3.5 w-3.5" /> Save to CRM
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

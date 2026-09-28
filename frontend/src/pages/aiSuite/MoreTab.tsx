import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { listProviderConnections, connectProvider, disconnectProvider } from '../../lib/api/aiSuite';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const PROVIDER_LABELS: Record<string, string> = { gemini: 'Google Gemini', openai: 'OpenAI', claude: 'Anthropic Claude', deepseek: 'DeepSeek', xai: 'xAI (Grok)' };

export function MoreTab() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const { data: providers, isLoading } = useQuery({ queryKey: ['ai-provider-connections'], queryFn: listProviderConnections });

  const connectMutation = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) => connectProvider(provider, apiKey),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['ai-provider-connections'] });
      toast(`${PROVIDER_LABELS[res.provider]} connected`, { variant: 'success' });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (provider: string) => disconnectProvider(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-provider-connections'] });
      toast('Disconnected', { variant: 'success' });
    },
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-1">
        <h3 className="flex items-center gap-1.5 font-semibold">
          <KeyRound className="h-4 w-4" /> Bring Your Own API Key
        </h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          Connect your own provider key to route AI Suite requests through it instead of the workspace's shared gateway wallet.
        </p>
      </Card>

      {isLoading ? (
        <SkeletonList rows={2} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {providers?.map((p) => (
            <Card key={p.provider} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium">{PROVIDER_LABELS[p.provider]}</p>
                {p.connected && <Badge tone="success">Connected</Badge>}
              </div>
              {p.connected ? (
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-[var(--color-text-muted)]">{p.apiKeyMasked}</span>
                  <Button size="sm" variant="ghost" onClick={() => disconnectMutation.mutate(p.provider)}>
                    Disconnect
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    aria-label={`${PROVIDER_LABELS[p.provider]} API key`}
                    placeholder="API key"
                    type="password"
                    value={drafts[p.provider] ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [p.provider]: e.target.value })}
                  />
                  <Button
                    size="sm"
                    disabled={!drafts[p.provider]}
                    loading={connectMutation.isPending}
                    onClick={() => connectMutation.mutate({ provider: p.provider, apiKey: drafts[p.provider] })}
                  >
                    Connect
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

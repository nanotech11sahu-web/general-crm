import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAppStoreIntegrations, connectSmtp, connectGenericIntegration, disconnectGenericIntegration } from '../../lib/api/settings';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const GENERIC_CONNECTABLE = new Set([
  'indiamart',
  'justdial',
  'google_sheets',
  'facebook_lead_ads',
  'instagram_lead_ads',
  'other_crm',
]);

function SmtpCard() {
  const queryClient = useQueryClient();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fromEmail, setFromEmail] = useState('');

  const connectMutation = useMutation({
    mutationFn: () => connectSmtp({ host, port: Number(port), username, password, fromEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-store-integrations'] });
      toast('SMTP connected', { variant: 'success' });
    },
  });

  return (
    <Card className="space-y-2">
      <h4 className="font-semibold">Generic SMTP</h4>
      <div className="grid grid-cols-2 gap-2">
        <Input label="Host" value={host} onChange={(e) => setHost(e.target.value)} />
        <Input label="Port" type="number" value={port} onChange={(e) => setPort(e.target.value)} />
        <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input label="From Email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
      </div>
      <Button size="sm" disabled={!host || !username || !password || !fromEmail} loading={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
        Connect SMTP
      </Button>
    </Card>
  );
}

export function AppStoreTab() {
  const queryClient = useQueryClient();
  const { data: integrations, isLoading } = useQuery({ queryKey: ['app-store-integrations'], queryFn: listAppStoreIntegrations });

  const connectMutation = useMutation({
    mutationFn: (key: string) => connectGenericIntegration(key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-store-integrations'] }),
  });

  const disconnectMutation = useMutation({
    mutationFn: (key: string) => disconnectGenericIntegration(key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-store-integrations'] }),
  });

  if (isLoading) return <SkeletonList rows={3} />;

  const categories = Array.from(new Set((integrations ?? []).map((i) => i.category)));

  return (
    <div className="space-y-4">
      <SmtpCard />
      {categories.map((category) => (
        <div key={category} className="space-y-2">
          <h4 className="font-semibold">{category}</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {(integrations ?? [])
              .filter((i) => i.category === category)
              .map((i) => (
                <Card key={i.key} className="flex items-center justify-between">
                  <span>{i.name}</span>
                  {i.connected ? (
                    <div className="flex items-center gap-2">
                      <Badge tone="success">Connected</Badge>
                      {GENERIC_CONNECTABLE.has(i.key) && (
                        <Button size="sm" variant="ghost" onClick={() => disconnectMutation.mutate(i.key)}>
                          Disconnect
                        </Button>
                      )}
                    </div>
                  ) : GENERIC_CONNECTABLE.has(i.key) ? (
                    <Button size="sm" variant="secondary" onClick={() => connectMutation.mutate(i.key)}>
                      Connect
                    </Button>
                  ) : (
                    <Badge tone="neutral">Not connected</Badge>
                  )}
                </Card>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

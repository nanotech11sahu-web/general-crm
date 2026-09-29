import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import type { AxiosError } from 'axios';
import {
  listAppStoreIntegrations,
  connectSmtp,
  connectGenericIntegration,
  disconnectGenericIntegration,
  getMetaLeadAdsOAuthUrl,
  connectRazorpay,
  disconnectRazorpay,
  getMetaAppConfig,
  saveMetaAppConfig,
  deleteMetaAppConfig,
} from '../../lib/api/settings';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

// Marks a workspace's own record as "connected" without validating anything against the
// provider's API — there's no live sync yet. Real, validated connections (Meta, Razorpay,
// SMTP) are handled by their own dedicated forms below, not this generic path.
const STUB_CONNECTABLE = new Set(['indiamart', 'justdial', 'google_sheets', 'other_crm']);
const META_LEAD_ADS_KEYS = new Set(['facebook_lead_ads', 'instagram_lead_ads']);

const META_ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'Meta did not return an authorization code. Please try connecting again.',
  invalid_state: 'That connection link expired or was tampered with. Please try connecting again.',
  no_pages: 'No Facebook Pages found on your account. Create or get access to a Page first, then reconnect.',
  meta_app_not_configured: 'Your Meta app was removed mid-connection. Reconnect it below, then try again.',
};

function MetaAppCard() {
  const queryClient = useQueryClient();
  const {
    data: config,
    isLoading,
    isError,
    error: configError,
    refetch: refetchConfig,
  } = useQuery({ queryKey: ['meta-app-config'], queryFn: getMetaAppConfig });
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');

  const saveMutation = useMutation({
    mutationFn: () => saveMetaAppConfig({ appId, appSecret }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['meta-app-config'] });
      toast('Meta app saved', { variant: 'success' });
      setAppSecret('');
    },
    onError: (err: AxiosError<{ error?: string }>) => {
      toast('Could not save Meta app', { variant: 'error', description: err.response?.data?.error ?? 'Please try again.' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: deleteMetaAppConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-app-config'] });
      queryClient.invalidateQueries({ queryKey: ['app-store-integrations'] });
      toast('Meta app removed', { variant: 'success' });
    },
  });

  if (isLoading) return <Card className="h-24 animate-pulse" />;

  if (isError) {
    const err = configError as AxiosError<{ error?: string }>;
    const description = err.response?.data?.error ?? err.message ?? 'Could not reach the server.';
    return (
      <Card className="space-y-2 border border-[var(--color-danger)]">
        <h4 className="font-semibold">Meta App (Facebook / Instagram)</h4>
        <p className="text-sm text-[var(--color-danger)]">
          Couldn't load your Meta app status ({err.response?.status ?? 'network error'}): {description}
        </p>
        <Button size="sm" variant="secondary" onClick={() => refetchConfig()}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <Card id="meta-app-card" className="space-y-2 scroll-mt-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">Meta App (Facebook / Instagram)</h4>
        {config?.configured && <Badge tone="success">Configured</Badge>}
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        Every workspace connects its own Meta app — create one at{' '}
        <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="underline">
          developers.facebook.com/apps
        </a>
        , add the "Facebook Login for Business" product, and whitelist this exact redirect URI:
      </p>
      {config?.redirectUri && (
        <code className="block break-all rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs">
          {config.redirectUri}
        </code>
      )}
      {config?.configured ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm">
            App ID: <span className="font-mono">{config.appId}</span>
          </p>
          <Button size="sm" variant="ghost" loading={removeMutation.isPending} onClick={() => removeMutation.mutate()}>
            Remove
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Input label="App ID" value={appId} onChange={(e) => setAppId(e.target.value)} />
            <Input label="App Secret" type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} />
          </div>
          <Button size="sm" disabled={!appId || !appSecret} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            Save Meta App
          </Button>
        </>
      )}
    </Card>
  );
}

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

function RazorpayCard({ connected }: { connected: boolean }) {
  const queryClient = useQueryClient();
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');

  const connectMutation = useMutation({
    mutationFn: () => connectRazorpay({ keyId, keySecret }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-store-integrations'] });
      toast('Razorpay connected', { variant: 'success', description: 'Verified live against your Razorpay account.' });
      setKeySecret('');
    },
    onError: (err: AxiosError<{ error?: string }>) => {
      toast('Could not connect Razorpay', { variant: 'error', description: err.response?.data?.error ?? 'Please check your keys.' });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectRazorpay,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-store-integrations'] });
      toast('Razorpay disconnected', { variant: 'success' });
    },
  });

  if (connected) {
    return (
      <Card className="flex items-center justify-between">
        <div>
          <span className="font-medium">Razorpay</span>
          <p className="text-xs text-[var(--color-text-muted)]">Keys verified live against the Razorpay API.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="success">Connected</Badge>
          <Button size="sm" variant="ghost" loading={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate()}>
            Disconnect
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-2">
      <h4 className="font-semibold">Razorpay</h4>
      <p className="text-xs text-[var(--color-text-muted)]">Get your Key ID and Key Secret from the Razorpay Dashboard → Settings → API Keys.</p>
      <div className="grid grid-cols-2 gap-2">
        <Input label="Key ID" value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_live_..." />
        <Input label="Key Secret" type="password" value={keySecret} onChange={(e) => setKeySecret(e.target.value)} />
      </div>
      <Button size="sm" disabled={!keyId || !keySecret} loading={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
        Connect Razorpay
      </Button>
    </Card>
  );
}

function MetaLeadAdsButton({ appKey, connected }: { appKey: 'facebook_lead_ads' | 'instagram_lead_ads'; connected: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const connectMutation = useMutation({
    mutationFn: () => getMetaLeadAdsOAuthUrl(appKey),
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err: AxiosError<{ error?: string }>) => {
      const description = err.response?.data?.error ?? 'Please try again.';
      const needsMetaApp = err.response?.status === 400 && description.toLowerCase().includes('meta app');
      toast('Could not start Meta connection', { variant: 'error', description });
      if (needsMetaApp) navigate('/settings/app-store#meta-app-card');
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectGenericIntegration(appKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-store-integrations'] });
      toast('Disconnected', { variant: 'success' });
    },
  });

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="success">Connected</Badge>
        <Button size="sm" variant="ghost" onClick={() => disconnectMutation.mutate()}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" variant="secondary" loading={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
      Connect via Meta
    </Button>
  );
}

export function AppStoreTab() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: integrations, isLoading } = useQuery({ queryKey: ['app-store-integrations'], queryFn: listAppStoreIntegrations });

  useEffect(() => {
    if (location.hash !== '#meta-app-card') return;
    const el = document.getElementById('meta-app-card');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('ring-2', 'ring-[var(--color-primary)]');
    const timer = setTimeout(() => el.classList.remove('ring-2', 'ring-[var(--color-primary)]'), 2500);
    return () => clearTimeout(timer);
  }, [location.hash]);

  useEffect(() => {
    const meta = searchParams.get('meta');
    if (!meta) return;
    if (meta === 'connected') {
      queryClient.invalidateQueries({ queryKey: ['app-store-integrations'] });
      toast('Connected via Meta', { variant: 'success' });
    } else if (meta === 'error') {
      const reason = searchParams.get('reason') ?? '';
      toast('Could not connect', { variant: 'error', description: META_ERROR_MESSAGES[reason] ?? reason ?? 'Please try again.' });
    }
    setSearchParams(
      (prev) => {
        prev.delete('meta');
        prev.delete('reason');
        prev.delete('app');
        return prev;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
      <MetaAppCard />
      <RazorpayCard connected={integrations?.find((i) => i.key === 'razorpay')?.connected ?? false} />
      {categories.map((category) => (
        <div key={category} className="space-y-2">
          <h4 className="font-semibold">{category}</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {(integrations ?? [])
              .filter((i) => i.category === category && i.key !== 'razorpay')
              .map((i) => {
                const isMetaLeadAds = META_LEAD_ADS_KEYS.has(i.key);
                const isStub = STUB_CONNECTABLE.has(i.key);
                return (
                  <Card key={i.key} className="flex items-center justify-between gap-2">
                    <div>
                      <span>{i.name}</span>
                      {isStub && (
                        <p className="text-xs text-[var(--color-text-muted)]">Tracked here for your team — no live API sync yet.</p>
                      )}
                    </div>
                    {isMetaLeadAds ? (
                      <MetaLeadAdsButton appKey={i.key as 'facebook_lead_ads' | 'instagram_lead_ads'} connected={i.connected} />
                    ) : i.key === 'meta' ? (
                      <div className="flex items-center gap-2">
                        {i.connected && <Badge tone="success">Connected</Badge>}
                        <Button size="sm" variant="secondary" onClick={() => navigate('/lead-generation/ad-launcher')}>
                          {i.connected ? 'Manage' : 'Connect'} in Ad Launcher
                        </Button>
                      </div>
                    ) : i.connected ? (
                      <div className="flex items-center gap-2">
                        <Badge tone="success">Connected</Badge>
                        {isStub && (
                          <Button size="sm" variant="ghost" onClick={() => disconnectMutation.mutate(i.key)}>
                            Disconnect
                          </Button>
                        )}
                      </div>
                    ) : isStub ? (
                      <Button size="sm" variant="secondary" onClick={() => connectMutation.mutate(i.key)}>
                        Mark Connected
                      </Button>
                    ) : (
                      <Badge tone="neutral">Not implemented</Badge>
                    )}
                  </Card>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

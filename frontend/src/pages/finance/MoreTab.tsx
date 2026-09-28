import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent, CreditCard, Plus } from 'lucide-react';
import { listTaxProfiles, createTaxProfile, getRazorpayStatus, connectRazorpay } from '../../lib/api/finance';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

export function MoreTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TaxProfilesCard />
      <PaymentGatewayCard />
    </div>
  );
}

function TaxProfilesCard() {
  const queryClient = useQueryClient();
  const { data: profiles, isLoading } = useQuery({ queryKey: ['finance-tax-profiles'], queryFn: listTaxProfiles });
  const [name, setName] = useState('');
  const [ratePercent, setRatePercent] = useState(0);

  const createMutation = useMutation({
    mutationFn: () => createTaxProfile({ name, ratePercent }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-tax-profiles'] });
      setName('');
      setRatePercent(0);
      toast('Tax profile created', { variant: 'success' });
    },
  });

  return (
    <Card className="space-y-3">
      <h3 className="flex items-center gap-1.5 font-semibold">
        <Percent className="h-4 w-4" /> Tax Profiles
      </h3>
      <p className="text-xs text-[var(--color-text-muted)]">Shared with Ecom's Add Product modal — create a profile here and it's immediately selectable there.</p>
      {isLoading ? (
        <SkeletonList rows={2} />
      ) : (
        <div className="space-y-1.5">
          {profiles?.map((p) => (
            <div key={p._id} className="flex items-center justify-between text-sm">
              <span>{p.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-muted)]">{p.ratePercent}%</span>
                {p.isDefault && <Badge>Default</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input aria-label="Tax profile name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input aria-label="Rate percent" type="number" placeholder="Rate %" value={ratePercent} onChange={(e) => setRatePercent(Number(e.target.value))} className="w-24" />
        <Button size="sm" className="gap-1" disabled={!name} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
    </Card>
  );
}

function PaymentGatewayCard() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: ['razorpay-status'], queryFn: getRazorpayStatus });

  const connectMutation = useMutation({
    mutationFn: connectRazorpay,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['razorpay-status'] });
      toast('Razorpay connected', { variant: 'success' });
    },
  });

  return (
    <Card className="space-y-3">
      <h3 className="flex items-center gap-1.5 font-semibold">
        <CreditCard className="h-4 w-4" /> Payment Gateway
      </h3>
      <p className="text-sm text-[var(--color-text-muted)]">Connect Razorpay to accept live payments against invoices and subscriptions.</p>
      {status?.connected ? (
        <Badge tone="success">Connected as {status.accountEmail}</Badge>
      ) : (
        <Button size="sm" loading={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
          Connect Razorpay
        </Button>
      )}
    </Card>
  );
}

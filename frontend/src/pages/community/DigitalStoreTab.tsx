import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { listStoreProducts, createStoreProduct, listCoupons, createCoupon, listOrders, createOrder } from '../../lib/api/community';
import { listContacts } from '../../lib/api/contacts';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const STORE_TABS = ['Products', 'Orders', 'Coupons', 'Analytics', 'Domain', 'Store Design'] as const;
const LATER_PHASE = new Set(['Analytics', 'Domain', 'Store Design']);

function ProductsSection() {
  const queryClient = useQueryClient();
  const { data: products, isLoading } = useQuery({ queryKey: ['community-store-products'], queryFn: listStoreProducts });
  const { data: contacts } = useQuery({ queryKey: ['contacts-first-page'], queryFn: () => listContacts({ limit: 20 }) });
  const [name, setName] = useState('');
  const [salePrice, setSalePrice] = useState('');

  const createMutation = useMutation({
    mutationFn: () => createStoreProduct({ name, salePrice: Number(salePrice) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-store-products'] });
      setName('');
      setSalePrice('');
      toast('Product added', { variant: 'success' });
    },
  });

  const orderMutation = useMutation({
    mutationFn: ({ productId, contactId }: { productId: string; contactId: string }) => createOrder({ productId, contactId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-store-orders'] });
      toast('Order placed', { variant: 'success' });
    },
  });

  if (isLoading) return <SkeletonList rows={2} />;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Sale Price" type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
        <Button size="sm" disabled={!name || !salePrice} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        {(products ?? []).map((p) => (
          <Card key={p._id} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-medium">{p.name}</p>
              <span className="text-sm">₹{p.salePrice.toLocaleString()}</span>
            </div>
            {(contacts?.contacts.length ?? 0) > 0 && (
              <select
                aria-label={`Order ${p.name} for a contact`}
                className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) orderMutation.mutate({ productId: p._id, contactId: e.target.value });
                }}
              >
                <option value="" disabled>
                  Place order for…
                </option>
                {contacts?.contacts.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function OrdersSection() {
  const { data: orders, isLoading } = useQuery({ queryKey: ['community-store-orders'], queryFn: listOrders });
  if (isLoading) return <SkeletonList rows={2} />;
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
          <tr>
            <th className="p-3">Amount</th>
            <th className="p-3">Coupon</th>
            <th className="p-3">Date</th>
          </tr>
        </thead>
        <tbody>
          {(orders ?? []).map((o) => (
            <tr key={o._id} className="border-b border-[var(--color-border)] last:border-0">
              <td className="p-3">₹{o.amount.toLocaleString()}</td>
              <td className="p-3">{o.couponCode ?? '—'}</td>
              <td className="p-3">{new Date(o.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function CouponsSection() {
  const queryClient = useQueryClient();
  const { data: coupons, isLoading } = useQuery({ queryKey: ['community-coupons'], queryFn: listCoupons });
  const [code, setCode] = useState('');
  const [discount, setDiscount] = useState('');

  const createMutation = useMutation({
    mutationFn: () => createCoupon({ code, discountPercent: Number(discount) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-coupons'] });
      setCode('');
      setDiscount('');
      toast('Coupon created', { variant: 'success' });
    },
  });

  if (isLoading) return <SkeletonList rows={2} />;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-2">
        <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Input label="Discount %" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        <Button size="sm" disabled={!code || !discount} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </Card>
      <div className="space-y-2">
        {(coupons ?? []).map((c) => (
          <Card key={c._id} className="flex items-center justify-between">
            <span className="font-mono">{c.code}</span>
            <span>{c.discountPercent}% off</span>
            <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge>
            <span className="text-xs text-[var(--color-text-muted)]">{c.redemptions} redemptions</span>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function DigitalStoreTab() {
  const [tab, setTab] = useState<(typeof STORE_TABS)[number]>('Products');
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2">
        {STORE_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              tab === t ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]',
            )}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === 'Products' && <ProductsSection />}
      {tab === 'Orders' && <OrdersSection />}
      {tab === 'Coupons' && <CouponsSection />}
      {LATER_PHASE.has(tab) && <Card className="text-sm text-[var(--color-text-muted)]">{tab} ships in a later phase.</Card>}
    </div>
  );
}

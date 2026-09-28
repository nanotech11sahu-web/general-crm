import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ShoppingBag, Plus, Sparkles } from 'lucide-react';
import { listProducts, createProduct, listCollections, listTaxProfiles, generateAiStoreBuilder } from '../../lib/api/ecom';
import type { AiStoreSuggestion } from '../../lib/api/ecom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const TABS = ['Dashboard', 'Products', 'Collections', 'More'] as const;
type Tab = (typeof TABS)[number];

const MORE_ITEMS = ['Orders', 'Offers', 'Shipping', 'Payments & Finance', 'Reviews', 'Inventory', 'Media Library', 'Analytics', 'Store Design', 'AI Studio', 'Settings'];

export function EcomPage() {
  const [tab, setTab] = useState<Tab>('Dashboard');

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Ecom</h1>
      <nav className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'Dashboard' && <AiStoreBuilderTab />}
      {tab === 'Products' && <ProductsTab />}
      {tab === 'Collections' && <CollectionsTab />}
      {tab === 'More' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {MORE_ITEMS.map((item) => (
            <Card key={item} className="text-sm text-[var(--color-text-muted)]">
              {item}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AiStoreBuilderTab() {
  const [prompt, setPrompt] = useState('');
  const [suggestion, setSuggestion] = useState<AiStoreSuggestion | null>(null);

  const mutation = useMutation({
    mutationFn: () => generateAiStoreBuilder(prompt),
    onSuccess: setSuggestion,
    onError: () => toast('Could not reach the AI gateway (check the workspace wallet balance)', { variant: 'error' }),
  });

  return (
    <Card className="max-w-xl space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-[var(--color-primary)]" />
        <h3 className="font-semibold">AI Store Builder</h3>
      </div>
      <p className="text-sm text-[var(--color-text-muted)]">Describe what you sell and get a starter store name, tagline, collections, and product ideas.</p>
      <div className="flex gap-2">
        <Input aria-label="Describe your store" placeholder="e.g. handmade candles" value={prompt} onChange={(e) => setPrompt(e.target.value)} className="flex-1" />
        <Button disabled={!prompt.trim()} loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Generate
        </Button>
      </div>
      {suggestion && (
        <div className="space-y-2 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-3">
          <p className="font-semibold">{suggestion.storeName}</p>
          <p className="text-sm text-[var(--color-text-muted)]">{suggestion.tagline}</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestion.suggestedCollections.map((c) => (
              <Badge key={c}>{c}</Badge>
            ))}
          </div>
          <ul className="text-sm">
            {suggestion.suggestedProducts.map((p) => (
              <li key={p.name}>
                {p.name} — ₹{p.priceHint.toLocaleString()}
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--color-text-muted)]">Use the Products tab to create these for real.</p>
        </div>
      )}
    </Card>
  );
}

function ProductsTab() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', salePrice: '', mrp: '', sku: '', collectionId: '', taxProfileId: '', visibility: 'draft' as 'draft' | 'published' });

  const { data, isLoading } = useQuery({ queryKey: ['ecom-products'], queryFn: listProducts });
  const { data: collections } = useQuery({ queryKey: ['ecom-collections'], queryFn: listCollections });
  const { data: taxProfiles } = useQuery({ queryKey: ['ecom-tax-profiles'], queryFn: listTaxProfiles });

  const mutation = useMutation({
    mutationFn: () =>
      createProduct({
        name: form.name,
        salePrice: Number(form.salePrice),
        mrp: form.mrp ? Number(form.mrp) : undefined,
        sku: form.sku || undefined,
        collectionId: form.collectionId || undefined,
        taxProfileId: form.taxProfileId || undefined,
        visibility: form.visibility,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ecom-products'] });
      toast('Product synced to Finance', { variant: 'success', description: form.name });
      setOpen(false);
      setForm({ name: '', salePrice: '', mrp: '', sku: '', collectionId: '', taxProfileId: '', visibility: 'draft' });
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not create product';
      toast(message, { variant: 'error' });
    },
  });

  const quota = data?.quota;
  const quotaPercent = quota ? Math.min(100, (quota.used / quota.limit) * 100) : 0;
  const quotaReached = Boolean(quota && quota.used >= quota.limit);

  return (
    <div className="space-y-4">
      {quota && (
        <Card>
          <div className="flex items-center justify-between text-sm">
            <span>
              {quota.used}/{quota.limit} Free tier
            </span>
            {quotaReached && <Badge tone="warning">Upgrade to add more</Badge>}
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
            <div className="h-full bg-[var(--color-primary)]" style={{ width: `${quotaPercent}%` }} />
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" disabled={quotaReached} onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add Product
        </Button>
      </div>

      {isLoading && <SkeletonList rows={3} />}
      {!isLoading && data?.products.length === 0 && (
        <EmptyState icon={ShoppingBag} title="No products yet" description="Add your first product to start selling." actionLabel="Add Product" onAction={() => setOpen(true)} />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.products.map((product) => (
          <Card key={product._id}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{product.name}</h3>
              <Badge tone={product.visibility === 'published' ? 'success' : 'neutral'}>{product.visibility}</Badge>
            </div>
            <p className="mt-1 text-lg font-semibold">
              {product.currency} {product.salePrice.toLocaleString()}
            </p>
            {product.sku && <p className="text-xs text-[var(--color-text-muted)]">SKU: {product.sku}</p>}
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add Product"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!form.name || !form.salePrice} loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Save Product
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Sale Price" type="number" required value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} />
            <Input label="MRP / Compare Price" type="number" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} />
          </div>
          <Input label="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <label className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">Collection</span>
            <select
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
              value={form.collectionId}
              onChange={(e) => setForm({ ...form, collectionId: e.target.value })}
            >
              <option value="">None</option>
              {collections?.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">Tax Profile</span>
            <select
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
              value={form.taxProfileId}
              onChange={(e) => setForm({ ...form, taxProfileId: e.target.value })}
            >
              <option value="">None</option>
              {taxProfiles?.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name} ({t.ratePercent}%)
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">Visibility</span>
            <select
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
              value={form.visibility}
              onChange={(e) => setForm({ ...form, visibility: e.target.value as 'draft' | 'published' })}
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </label>
        </div>
      </Modal>
    </div>
  );
}

function CollectionsTab() {
  const { data: collections, isLoading } = useQuery({ queryKey: ['ecom-collections'], queryFn: listCollections });
  if (isLoading) return <SkeletonList rows={2} />;
  if (!collections?.length) return <EmptyState icon={ShoppingBag} title="No collections yet" description="Group products into collections from the Add Product modal." />;
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {collections.map((c) => (
        <Card key={c._id}>{c.name}</Card>
      ))}
    </div>
  );
}

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { EcomPage } from './EcomPage';

vi.mock('../../lib/api/ecom', () => ({
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  listTaxProfiles: vi.fn(),
  generateAiStoreBuilder: vi.fn(),
}));

import { listProducts, listCollections, listTaxProfiles } from '../../lib/api/ecom';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EcomPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcomPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listCollections as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listTaxProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([{ _id: 't1', name: 'No Tax', ratePercent: 0, isDefault: true }]);
  });

  it('shows the empty state when there are no products', async () => {
    (listProducts as ReturnType<typeof vi.fn>).mockResolvedValue({ products: [], quota: { used: 0, limit: 10 } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Products' }));
    await waitFor(() => expect(screen.getByText('No products yet')).toBeInTheDocument());
    expect(screen.getByText('0/10 Free tier')).toBeInTheDocument();
  });

  it('disables Add Product once the free-tier quota is reached', async () => {
    (listProducts as ReturnType<typeof vi.fn>).mockResolvedValue({
      products: Array.from({ length: 10 }, (_, i) => ({
        _id: String(i),
        name: `Product ${i}`,
        salePrice: 10,
        currency: 'INR',
        seoSlug: `product-${i}`,
        visibility: 'draft',
        images: [],
        stockTracking: false,
        featured: false,
        createdAt: new Date().toISOString(),
      })),
      quota: { used: 10, limit: 10 },
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Products' }));
    await waitFor(() => expect(screen.getByText('Upgrade to add more')).toBeInTheDocument());
    const addButtons = screen.getAllByRole('button', { name: /Add Product/ });
    expect(addButtons[0]).toBeDisabled();
  });
});

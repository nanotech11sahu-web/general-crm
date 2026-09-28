import { api } from '../apiClient';
import type { EcomProduct, EcomCollection, TaxProfileDoc } from '../../types/leadgen2';

export async function listProducts() {
  const res = await api.get('/ecom/products');
  return res.data as { products: EcomProduct[]; quota: { used: number; limit: number } };
}

export async function createProduct(payload: Partial<EcomProduct> & { taxProfileId?: string }) {
  const res = await api.post('/ecom/products', payload);
  return res.data as { product: EcomProduct; financeSynced: boolean };
}

export async function listCollections() {
  const res = await api.get('/ecom/collections');
  return res.data.collections as EcomCollection[];
}

export async function createCollection(name: string) {
  const res = await api.post('/ecom/collections', { name });
  return res.data.collection as EcomCollection;
}

// Tax profiles now live under Settings → Finance → Tax (Phase 6); Ecom's Add Product modal reads from there.
export async function listTaxProfiles() {
  const res = await api.get('/finance/tax-profiles');
  return res.data.profiles as TaxProfileDoc[];
}

export interface AiStoreSuggestion {
  storeName: string;
  tagline: string;
  suggestedCollections: string[];
  suggestedProducts: { name: string; priceHint: number }[];
  seoSlug: string;
}

export async function generateAiStoreBuilder(prompt: string) {
  const res = await api.post('/ecom/ai-store-builder', { prompt });
  return res.data.suggestion as AiStoreSuggestion;
}

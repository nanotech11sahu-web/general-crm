import { api } from '../apiClient';

export interface SearchResult {
  type: 'Contact' | 'Project' | 'Product' | 'Form' | 'Funnel' | 'Workflow';
  id: string;
  label: string;
  subtitle?: string;
  link: string;
}

export async function globalSearch(q: string) {
  if (!q.trim()) return [] as SearchResult[];
  const res = await api.get('/search', { params: { q } });
  return res.data.results as SearchResult[];
}

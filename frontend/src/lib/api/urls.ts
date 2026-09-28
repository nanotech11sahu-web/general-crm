import { api } from '../apiClient';
import type { DomainDoc, ShortLinkDoc } from '../../types/leadgen2';

export async function listDomains() {
  const res = await api.get('/urls/domains');
  return res.data.domains as DomainDoc[];
}

export async function createDomain(hostname: string) {
  const res = await api.post('/urls/domains', { hostname });
  return res.data.domain as DomainDoc;
}

export async function listLinks() {
  const res = await api.get('/urls/links');
  return res.data as { links: ShortLinkDoc[]; hasDomain: boolean };
}

export async function createLink(payload: {
  destinationUrl: string;
  domainId: string;
  title?: string;
  utm?: Record<string, string>;
}) {
  const res = await api.post('/urls/links', payload);
  return res.data as { link: ShortLinkDoc; publicUrl: string };
}

export async function getUrlsDashboard() {
  const res = await api.get('/urls/dashboard');
  return res.data as { kpis: { totalLinks: number; totalClicks: number; uniqueClicks: number; domains: number }; popularLinks: ShortLinkDoc[] };
}

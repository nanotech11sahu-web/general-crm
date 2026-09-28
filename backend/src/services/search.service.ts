import { Types } from 'mongoose';
import { Contact } from '../models/Contact';
import { Project } from '../models/Project';
import { Product } from '../models/Product';
import { Form } from '../models/Form';
import { Funnel } from '../models/Funnel';
import { Workflow } from '../models/Workflow';

export interface SearchResult {
  type: 'Contact' | 'Project' | 'Product' | 'Form' | 'Funnel' | 'Workflow';
  id: string;
  label: string;
  subtitle?: string;
  link: string;
}

export async function globalSearch(workspaceId: string, query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const wsId = new Types.ObjectId(workspaceId);
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const [contacts, projects, products, forms, funnels, workflows] = await Promise.all([
    Contact.find({ workspaceId: wsId, $or: [{ name: regex }, { email: regex }] }).limit(8).select('name email').lean(),
    Project.find({ workspaceId: wsId, title: regex }).limit(8).select('title').lean(),
    Product.find({ workspaceId: wsId, name: regex }).limit(8).select('name').lean(),
    Form.find({ workspaceId: wsId, name: regex }).limit(8).select('name').lean(),
    Funnel.find({ workspaceId: wsId, name: regex }).limit(8).select('name').lean(),
    Workflow.find({ workspaceId: wsId, name: regex }).limit(8).select('name').lean(),
  ]);

  const results: SearchResult[] = [
    ...contacts.map((c) => ({ type: 'Contact' as const, id: String(c._id), label: c.name, subtitle: c.email, link: `/lead-management/contacts/${c._id}` })),
    ...projects.map((p) => ({ type: 'Project' as const, id: String(p._id), label: p.title, link: `/operations` })),
    ...products.map((p) => ({ type: 'Product' as const, id: String(p._id), label: p.name, link: `/lead-generation/ecom` })),
    ...forms.map((f) => ({ type: 'Form' as const, id: String(f._id), label: f.name, link: `/lead-generation/forms/${f._id}` })),
    ...funnels.map((f) => ({ type: 'Funnel' as const, id: String(f._id), label: f.name, link: `/lead-generation/sites/${f._id}` })),
    ...workflows.map((w) => ({ type: 'Workflow' as const, id: String(w._id), label: w.name, link: `/lead-automation/workflows/${w._id}` })),
  ];

  return results;
}

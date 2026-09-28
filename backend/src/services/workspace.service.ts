import { Types } from 'mongoose';
import { Workspace } from '../models/Workspace';
import { Role } from '../models/Role';
import { Membership } from '../models/Membership';
import { Tag } from '../models/Tag';
import { OnboardingTask, ONBOARDING_CHECKLIST } from '../models/OnboardingTask';
import { Pipeline, DEFAULT_B2B_STAGES } from '../models/Pipeline';
import { Contact } from '../models/Contact';
import { Opportunity } from '../models/Opportunity';
import { TimelineEvent } from '../models/TimelineEvent';
import { TaxProfile } from '../models/TaxProfile';
import { fullPermissionMap } from '../constants/modules';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

const DEFAULT_TEMPERATURE_TAGS = [
  { name: 'Hot', color: '#ef4444' },
  { name: 'Warm', color: '#f59e0b' },
  { name: 'Cold', color: '#3b82f6' },
];

export async function createWorkspaceForOwner(ownerUserId: Types.ObjectId, name: string) {
  const workspace = await Workspace.create({
    name,
    slug: slugify(name),
    ownerUserId,
  });

  const ownerRole = await Role.create({
    workspaceId: workspace._id,
    name: 'Owner',
    isSystem: true,
    permissions: fullPermissionMap(),
  });

  const membership = await Membership.create({
    workspaceId: workspace._id,
    userId: ownerUserId,
    roleId: ownerRole._id,
    leadershipTitleIds: [],
    status: 'active',
  });

  await Tag.insertMany(
    DEFAULT_TEMPERATURE_TAGS.map((t) => ({
      workspaceId: workspace._id,
      name: t.name,
      color: t.color,
      appliesTo: ['Contact'],
    })),
  );

  await OnboardingTask.insertMany(
    ONBOARDING_CHECKLIST.map((item, idx) => ({
      workspaceId: workspace._id,
      key: item.key,
      label: item.label,
      order: idx,
      completed: item.key === 'workspace_created',
      completedAt: item.key === 'workspace_created' ? new Date() : undefined,
    })),
  );

  const pipeline = await Pipeline.create({
    workspaceId: workspace._id,
    name: 'B2B Sales Pipeline',
    stages: DEFAULT_B2B_STAGES,
    isDefault: true,
  });

  const demoContact = await Contact.create({
    workspaceId: workspace._id,
    name: 'Demo Lead',
    email: 'demo.lead@example.com',
    phone: '+1 555-0100',
    company: 'Demo Lead Co.',
    jobTitle: 'Head of Growth',
    city: 'Mumbai',
    country: 'India',
    lifecycleStage: 'SQL',
    temperature: 'Hot',
    contactType: 'Lead',
    leadValue: 12000,
    source: 'Seed',
    isDemo: true,
    attributionFirst: { source: 'Website Form', medium: 'organic', date: new Date() },
    attributionLatest: { source: 'Website Form', medium: 'organic', date: new Date() },
  });

  await Opportunity.create({
    workspaceId: workspace._id,
    contactId: demoContact._id,
    pipelineId: pipeline._id,
    stageKey: 'qualified',
    name: `${demoContact.name} — Demo Opportunity`,
    productInterest: 'Core Platform',
    city: demoContact.city,
    value: demoContact.leadValue,
    order: 0,
  });

  await TimelineEvent.create({
    workspaceId: workspace._id,
    contactId: demoContact._id,
    type: 'contact_created',
    message: 'Demo Lead was created as a sample contact for this workspace.',
  });

  await TaxProfile.create({
    workspaceId: workspace._id,
    name: 'No Tax',
    ratePercent: 0,
    isDefault: true,
  });

  return { workspace, membership, role: ownerRole, pipeline, demoContact };
}

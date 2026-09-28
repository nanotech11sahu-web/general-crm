import { Types } from 'mongoose';
import { AdCampaign } from '../models/AdCampaign';
import { Contact } from '../models/Contact';
import { Opportunity } from '../models/Opportunity';
import { Appointment } from '../models/Appointment';
import { SalesActivity } from '../models/SalesActivity';
import { Invoice } from '../models/Invoice';
import { FinanceTransaction } from '../models/FinanceTransaction';
import { Subscription } from '../models/Subscription';
import { WabaAccount } from '../models/WabaAccount';
import { Membership } from '../models/Membership';

const CUSTOMER_STAGES = ['Customer', 'Evangelist'];
const LEAD_STAGES = ['Lead', 'MQL', 'SQL', 'Opportunity'];

export interface DashboardKpiGroup {
  group: string;
  kpis: { key: string; label: string; value: number | string | null; format: 'number' | 'currency' | 'percent' | 'text' }[];
}

export interface DashboardRange {
  from: Date;
  to: Date;
  staffMembershipId?: string;
}

export async function computeDashboardKpis(workspaceId: string, range: DashboardRange): Promise<DashboardKpiGroup[]> {
  const wsId = new Types.ObjectId(workspaceId);
  const { from, to, staffMembershipId } = range;
  const dateMatch = { createdAt: { $gte: from, $lte: to } };

  let assignedUserId: Types.ObjectId | undefined;
  if (staffMembershipId) {
    const membership = await Membership.findOne({ _id: staffMembershipId, workspaceId: wsId }).select('userId').lean();
    assignedUserId = membership?.userId as Types.ObjectId | undefined;
  }

  const contactFilter: Record<string, unknown> = { workspaceId: wsId };
  if (assignedUserId) contactFilter.assignedCloserIds = assignedUserId;

  const [campaigns, newContacts, totalContacts, activeLeads, customers, newCustomers, closedWonOpps, salesCalls, bookings, wabaAccount, invoices, transactions, subscriptions] =
    await Promise.all([
      AdCampaign.find({ workspaceId: wsId, ...dateMatch }).lean(),
      Contact.countDocuments({ ...contactFilter, ...dateMatch }),
      Contact.countDocuments(contactFilter),
      Contact.countDocuments({ ...contactFilter, lifecycleStage: { $in: LEAD_STAGES } }),
      Contact.countDocuments({ ...contactFilter, lifecycleStage: { $in: CUSTOMER_STAGES } }),
      Contact.countDocuments({ ...contactFilter, lifecycleStage: { $in: CUSTOMER_STAGES }, updatedAt: { $gte: from, $lte: to } }),
      Opportunity.find({ workspaceId: wsId, stageKey: 'closed_won', updatedAt: { $gte: from, $lte: to } }).lean(),
      SalesActivity.countDocuments({
        workspaceId: wsId,
        type: 'call',
        ...dateMatch,
        ...(staffMembershipId ? { membershipId: new Types.ObjectId(staffMembershipId) } : {}),
      }),
      Appointment.countDocuments({
        workspaceId: wsId,
        createdAt: { $gte: from, $lte: to },
        ...(staffMembershipId ? { staffMembershipId: new Types.ObjectId(staffMembershipId) } : {}),
      }),
      WabaAccount.findOne({ workspaceId: wsId }).lean(),
      Invoice.find({ workspaceId: wsId, status: 'paid', paidAt: { $gte: from, $lte: to } }).lean(),
      // Excludes invoice-linked transactions — those are already counted via Invoice.paidAmount above,
      // so only standalone one-time payments (no invoiceId) are added here to avoid double-counting.
      FinanceTransaction.find({ workspaceId: wsId, status: { $ne: 'refunded' }, invoiceId: { $exists: false }, createdAt: { $gte: from, $lte: to } }).lean(),
      Subscription.find({ workspaceId: wsId, status: 'active' }).lean(),
    ]);

  const adSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
  const leadsGenerated = campaigns.reduce((sum, c) => sum + c.leads, 0) || newContacts;
  const conversionRate = leadsGenerated > 0 ? Math.round((newCustomers / leadsGenerated) * 10000) / 100 : 0;
  const totalSales = closedWonOpps.reduce((sum, o) => sum + (o.value ?? 0), 0);
  const totalRevenue = invoices.reduce((sum, i) => sum + i.paidAmount, 0) + transactions.reduce((sum, t) => sum + t.amount, 0);
  const mrr = subscriptions.reduce((sum, s) => sum + (s.billingCycle === 'yearly' ? s.price / 12 : s.price), 0);
  const waStatus = !wabaAccount || wabaAccount.status === 'not_connected' ? 'Not Connected' : `Connected (${wabaAccount.qualityRating ?? 'unrated'})`;

  return [
    {
      group: 'Marketing & Leads',
      kpis: [
        { key: 'adSpend', label: 'Ad Spend', value: adSpend, format: 'currency' },
        { key: 'leadsGenerated', label: 'Leads Generated', value: leadsGenerated, format: 'number' },
        { key: 'conversionRate', label: 'Conversion Rate', value: conversionRate, format: 'percent' },
      ],
    },
    {
      group: 'Sales & Revenue',
      kpis: [
        { key: 'totalSales', label: 'Total Sales', value: totalSales, format: 'currency' },
        { key: 'salesCalls', label: 'Sales Calls', value: salesCalls, format: 'number' },
      ],
    },
    {
      group: 'Operations',
      kpis: [{ key: 'calendarBookings', label: 'Calendar Bookings', value: bookings, format: 'number' }],
    },
    {
      group: 'Messaging & Engagement',
      kpis: [{ key: 'waOfficialStatus', label: 'WA Official Status', value: waStatus, format: 'text' }],
    },
    {
      group: 'Contacts & CRM',
      kpis: [
        { key: 'newContacts', label: 'New Contacts', value: newContacts, format: 'number' },
        { key: 'totalContacts', label: 'Total Contacts', value: totalContacts, format: 'number' },
        { key: 'activeLeads', label: 'Active Leads', value: activeLeads, format: 'number' },
        { key: 'customers', label: 'Customers', value: customers, format: 'number' },
        { key: 'newCustomers', label: 'New Customers', value: newCustomers, format: 'number' },
      ],
    },
    {
      group: 'Finance',
      kpis: [
        { key: 'totalRevenue', label: 'Total Revenue', value: totalRevenue, format: 'currency' },
        { key: 'mrr', label: 'MRR', value: Math.round(mrr * 100) / 100, format: 'currency' },
      ],
    },
  ];
}

export function flattenKpis(groups: DashboardKpiGroup[]) {
  return groups.flatMap((g) => g.kpis.map((k) => ({ ...k, group: g.group })));
}

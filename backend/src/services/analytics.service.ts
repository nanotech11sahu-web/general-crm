import { WhatsAppLog } from '../models/WhatsAppLog';
import { EmailLog } from '../models/EmailLog';
import { FormSubmission } from '../models/FormSubmission';
import { Opportunity } from '../models/Opportunity';
import { computeDashboard as computeFinanceDashboard } from './finance.service';
import { computeCommunityDashboard } from './community.service';
import { computeAiDashboard } from './aiDashboard.service';

/**
 * Cross-module Analytics tiles. Each tile that has a real owning-module dashboard calls that
 * module's own dashboard function directly rather than re-deriving the number — the Phase 10
 * DoD requires these to match the source module's own dashboard for the same range, and the
 * only way to guarantee that (rather than risk two aggregations drifting apart, as happened
 * with a real staleness bug in Phase 7) is to have a single source of truth for each number.
 */
export async function computeAnalytics(workspaceId: string) {
  const [finance, community, aiDashboard, whatsappSent, emailSent, formSubmissions, openOpportunities] = await Promise.all([
    computeFinanceDashboard(workspaceId),
    computeCommunityDashboard(workspaceId),
    computeAiDashboard(workspaceId, 30),
    WhatsAppLog.countDocuments({ workspaceId, status: 'sent' }),
    EmailLog.countDocuments({ workspaceId, status: 'sent' }),
    FormSubmission.countDocuments({ workspaceId }),
    Opportunity.countDocuments({ workspaceId }),
  ]);

  return {
    tiles: [
      { key: 'revenue', label: 'Revenue', value: finance.revenueSummary.gross, module: 'finance' },
      { key: 'mrr', label: 'MRR', value: finance.kpis.mrr, module: 'finance' },
      { key: 'community', label: 'Community', value: community.kpis.enrollments, module: 'community' },
      { key: 'aiBrain', label: 'AI Brain', value: aiDashboard.kpis.totalRequests, module: 'aiSuite' },
      { key: 'whatsapp', label: 'WhatsApp', value: whatsappSent, module: 'leadAutomation' },
      { key: 'email', label: 'Email', value: emailSent, module: 'leadAutomation' },
      { key: 'forms', label: 'Forms', value: formSubmissions, module: 'leadGeneration' },
      { key: 'pipeline', label: 'Pipeline', value: openOpportunities, module: 'sales' },
      { key: 'siteTraffic', label: 'Site Traffic', value: null, module: 'leadGeneration' },
      { key: 'instagram', label: 'Instagram', value: null, module: 'leadGeneration' },
      { key: 'zoom', label: 'Zoom', value: null, module: 'calendar' },
      { key: 'shop', label: 'Shop', value: null, module: 'leadGeneration' },
      { key: 'surveys', label: 'Surveys', value: null, module: 'leadGeneration' },
      { key: 'social', label: 'Social', value: null, module: 'leadGeneration' },
      { key: 'digitalHuman', label: 'Digital Human', value: null, module: 'aiSuite' },
      { key: 'voiceAgent', label: 'Voice Agent', value: null, module: 'aiSuite' },
      { key: 'courses', label: 'Courses', value: community.kpis.totalCourses, module: 'community' },
      { key: 'expenses', label: 'Expenses', value: null, module: 'finance' },
      { key: 'clv', label: 'CLV', value: null, module: 'finance' },
      { key: 'taxSummary', label: 'Tax Summary', value: null, module: 'finance' },
      { key: 'funnels', label: 'Funnels', value: null, module: 'leadGeneration' },
      { key: 'calls', label: 'Calls', value: null, module: 'sales' },
    ],
  };
}

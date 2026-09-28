import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { DashboardPage } from './pages/DashboardPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { Toaster } from './components/ui/Toaster';
import { NAV_ITEMS } from './config/navigation';
import { LeadManagementLayout } from './pages/leadManagement/LeadManagementLayout';
import { LeadsPage } from './pages/leadManagement/LeadsPage';
import { StatsPage } from './pages/leadManagement/StatsPage';
import { PipelinePage } from './pages/leadManagement/PipelinePage';
import { ContactProfilePage } from './pages/leadManagement/ContactProfilePage';
import { LeadGenerationHome } from './pages/leadGeneration/LeadGenerationHome';
import { SitesListPage } from './pages/leadGeneration/SitesListPage';
import { FunnelDetailPage } from './pages/leadGeneration/FunnelDetailPage';
import { FormsListPage } from './pages/leadGeneration/FormsListPage';
import { FormBuilderPage } from './pages/leadGeneration/FormBuilderPage';
import { ChatWidgetsListPage } from './pages/leadGeneration/ChatWidgetsListPage';
import { EcomPage } from './pages/leadGeneration/EcomPage';
import { AdLauncherPage } from './pages/leadGeneration/AdLauncherPage';
import { AiSocialPage } from './pages/leadGeneration/AiSocialPage';
import { VibeProspectingPage } from './pages/leadGeneration/VibeProspectingPage';
import { UrlsPage } from './pages/leadGeneration/UrlsPage';
import { PublicFunnelPage } from './pages/public/PublicFunnelPage';
import { PublicFormPage } from './pages/public/PublicFormPage';
import { LeadAutomationHome } from './pages/leadAutomation/LeadAutomationHome';
import { EmailMarketingPage } from './pages/leadAutomation/EmailMarketingPage';
import { WabaPage } from './pages/leadAutomation/WabaPage';
import { WorkflowsListPage } from './pages/leadAutomation/WorkflowsListPage';
import { WorkflowBuilderPage } from './pages/leadAutomation/WorkflowBuilderPage';
import { BulkCampaignsPage } from './pages/leadAutomation/BulkCampaignsPage';
import { SalesHome } from './pages/sales/SalesHome';
import { CalendarHome } from './pages/calendar/CalendarHome';
import { EventTypeWizardPage } from './pages/calendar/EventTypeWizardPage';
import { PublicBookingPage } from './pages/public/PublicBookingPage';
import { FinanceHome } from './pages/finance/FinanceHome';
import { AiSuiteHome } from './pages/aiSuite/AiSuiteHome';
import { BrainPackDetailPage } from './pages/aiSuite/BrainPackDetailPage';
import { OperationsHome } from './pages/operations/OperationsHome';
import { InboxHome } from './pages/inbox/InboxHome';
import { CommunityHome } from './pages/community/CommunityHome';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import {
  VaultPage,
  StaffPage,
  RolesPage,
  TagsPage,
  ValuesPage,
  FieldsPage,
  TemplatesPage,
  AppStorePage,
  DomainsPage,
  BrandingPage,
  AnalyticsPage,
  DeletedItemsPage,
} from './pages/settings/SettingsPages';
import { AgencyHome } from './pages/agency/AgencyHome';
import { HubPage } from './pages/HubPage';
import { HrmsHome } from './pages/hrms/HrmsHome';

const EXCLUDED_NAV_KEYS = [
  'dashboard',
  'lead-management',
  'lead-generation',
  'lead-automation',
  'sales',
  'calendar',
  'finance',
  'ai-suite',
  'hrms',
  'operations',
  'inbox',
  'community',
  'agency',
  'settings-vault',
  'settings-staff',
  'settings-roles',
  'settings-tags',
  'settings-values',
  'settings-fields',
  'settings-templates',
  'settings-app-store',
  'settings-domains',
  'settings-branding',
  'settings-analytics',
  'settings-deleted-items',
];
const OTHER_NAV_ITEMS = NAV_ITEMS.filter((item) => !EXCLUDED_NAV_KEYS.includes(item.key));

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/s/:publicId/*" element={<PublicFunnelPage />} />
        <Route path="/f/:id" element={<PublicFormPage />} />
        <Route path="/book/:publicId" element={<PublicBookingPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<HubPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/hrms" element={<HrmsHome />} />

            <Route path="/lead-management" element={<LeadManagementLayout />}>
              <Route index element={<Navigate to="stats" replace />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="leads" element={<LeadsPage />} />
              <Route path="pipeline" element={<PipelinePage />} />
            </Route>
            <Route path="/lead-management/contacts/:id" element={<ContactProfilePage />} />

            <Route path="/lead-generation" element={<LeadGenerationHome />} />
            <Route path="/lead-generation/sites" element={<SitesListPage />} />
            <Route path="/lead-generation/sites/:id" element={<FunnelDetailPage />} />
            <Route path="/lead-generation/forms" element={<FormsListPage />} />
            <Route path="/lead-generation/forms/:id" element={<FormBuilderPage />} />
            <Route path="/lead-generation/chat-widget" element={<ChatWidgetsListPage />} />
            <Route path="/lead-generation/ecom" element={<EcomPage />} />
            <Route path="/lead-generation/ad-launcher" element={<AdLauncherPage />} />
            <Route path="/lead-generation/ai-social" element={<AiSocialPage />} />
            <Route path="/lead-generation/vibe-prospecting" element={<VibeProspectingPage />} />
            <Route path="/lead-generation/urls" element={<UrlsPage />} />

            <Route path="/lead-automation" element={<LeadAutomationHome />} />
            <Route path="/lead-automation/email" element={<EmailMarketingPage />} />
            <Route path="/lead-automation/waba" element={<WabaPage />} />
            <Route path="/lead-automation/workflows" element={<WorkflowsListPage />} />
            <Route path="/lead-automation/workflows/:id" element={<WorkflowBuilderPage />} />
            <Route path="/lead-automation/bulk-campaigns" element={<BulkCampaignsPage />} />

            <Route path="/sales" element={<SalesHome />} />

            <Route path="/calendar" element={<CalendarHome />} />
            <Route path="/calendar/event-types/:id" element={<EventTypeWizardPage />} />

            <Route path="/finance" element={<FinanceHome />} />

            <Route path="/ai-suite" element={<AiSuiteHome />} />
            <Route path="/ai-suite/brain/:key" element={<BrainPackDetailPage />} />

            <Route path="/operations" element={<OperationsHome />} />

            <Route path="/inbox" element={<InboxHome />} />
            <Route path="/community" element={<CommunityHome />} />

            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="vault" replace />} />
              <Route path="vault" element={<VaultPage />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="roles" element={<RolesPage />} />
              <Route path="tags" element={<TagsPage />} />
              <Route path="values" element={<ValuesPage />} />
              <Route path="fields" element={<FieldsPage />} />
              <Route path="templates" element={<TemplatesPage />} />
              <Route path="app-store" element={<AppStorePage />} />
              <Route path="domains" element={<DomainsPage />} />
              <Route path="branding" element={<BrandingPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="deleted-items" element={<DeletedItemsPage />} />
            </Route>

            <Route path="/agency" element={<AgencyHome />} />

            {OTHER_NAV_ITEMS.map((item) => (
              <Route key={item.key} path={item.to} element={<PlaceholderPage title={item.label} />} />
            ))}
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}

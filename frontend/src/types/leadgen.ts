export type BlockType = 'heading' | 'text' | 'image' | 'cta' | 'divider';

export interface FunnelBlock {
  id: string;
  type: BlockType;
  content: string;
  href?: string;
}

export interface FunnelPage {
  id: string;
  name: string;
  path: string;
  isHome: boolean;
  status: 'draft' | 'active';
  blocks: FunnelBlock[];
}

export interface Funnel {
  _id: string;
  name: string;
  type: string;
  publicId: string;
  isOnline: boolean;
  pages: FunnelPage[];
  settings: {
    domain?: string;
    trackingHeader?: string;
    trackingBody?: string;
    robotsTxtEnabled: boolean;
    sitemapEnabled: boolean;
  };
  publishedAt?: string;
  createdAt: string;
}

export type FormFieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'name'
  | 'single_choice'
  | 'multiple_choice'
  | 'dropdown'
  | 'submit';

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  options: string[];
}

export interface FormDoc {
  _id: string;
  name: string;
  slug: string;
  status: 'draft' | 'published';
  fields: FormField[];
  style: {
    pageBackground: string;
    cardBackground: string;
    buttonBackground: string;
    cornerRadius: number;
  };
  settings: {
    onSubmitAction: 'message' | 'redirect';
    onSubmitMessage: string;
    redirectUrl?: string;
    autoCreateContact: boolean;
    lifecycleStageOnSubmit: string;
    skipContactCreation: boolean;
    gdprConsent: boolean;
    requireCaptcha: boolean;
    rateLimitPerHour: number;
  };
  createdAt: string;
}

export interface ChatWidgetDoc {
  _id: string;
  name: string;
  status: 'draft' | 'active';
  branding: { companyName: string; logoUrl?: string };
  theme: { primaryColor: string; position: 'bottom-right' | 'bottom-left' };
  preChat: { greeting: string; collectName: boolean; collectEmail: boolean };
  hours: { alwaysOn: boolean; timezone: string };
  routing: { assignTo: string; fallbackMessage: string };
  createdAt: string;
}

export type AppStoreCategory = 'Ads' | 'AI' | 'Payments' | 'Messaging' | 'Telephony' | 'Other';

export interface AppStoreCatalogEntry {
  key: string;
  name: string;
  category: AppStoreCategory;
  /** How connection status for this entry is resolved. 'generic' reads/writes AppIntegration directly. */
  source: 'adAccount' | 'aiProvider' | 'zoom' | 'razorpay' | 'waba' | 'callProvider' | 'smtp' | 'generic';
  /** For sourced entries, the key used to look up the underlying connection (platform/provider/providerKey). */
  sourceKey?: string;
}

export const APP_STORE_CATALOG: AppStoreCatalogEntry[] = [
  { key: 'google', name: 'Google Ads', category: 'Ads', source: 'adAccount', sourceKey: 'google' },
  { key: 'meta', name: 'Meta Ads', category: 'Ads', source: 'adAccount', sourceKey: 'meta' },
  { key: 'linkedin', name: 'LinkedIn Ads', category: 'Ads', source: 'adAccount', sourceKey: 'linkedin' },
  { key: 'smtp', name: 'Generic SMTP', category: 'Messaging', source: 'smtp' },
  { key: 'gemini', name: 'Google Gemini', category: 'AI', source: 'aiProvider', sourceKey: 'gemini' },
  { key: 'openai', name: 'OpenAI', category: 'AI', source: 'aiProvider', sourceKey: 'openai' },
  { key: 'claude', name: 'Anthropic Claude', category: 'AI', source: 'aiProvider', sourceKey: 'claude' },
  { key: 'deepseek', name: 'DeepSeek', category: 'AI', source: 'aiProvider', sourceKey: 'deepseek' },
  { key: 'xai', name: 'xAI (Grok)', category: 'AI', source: 'aiProvider', sourceKey: 'xai' },
  { key: 'zoom', name: 'Zoom', category: 'Other', source: 'zoom' },
  { key: 'razorpay', name: 'Razorpay', category: 'Payments', source: 'razorpay' },
  { key: 'whatsapp', name: 'WhatsApp Business (WABA)', category: 'Messaging', source: 'waba' },
  { key: 'callyzer', name: 'Callyzer', category: 'Telephony', source: 'callProvider', sourceKey: 'callyzer' },
  { key: 'myoperator', name: 'MyOperator', category: 'Telephony', source: 'callProvider', sourceKey: 'myoperator' },
  { key: 'exotel', name: 'Exotel', category: 'Telephony', source: 'callProvider', sourceKey: 'exotel' },
  { key: 'knowlarity', name: 'Knowlarity', category: 'Telephony', source: 'callProvider', sourceKey: 'knowlarity' },
  { key: 'indiamart', name: 'IndiaMART', category: 'Other', source: 'generic' },
  { key: 'justdial', name: 'JustDial', category: 'Other', source: 'generic' },
  { key: 'google_sheets', name: 'Google Sheets', category: 'Other', source: 'generic' },
  { key: 'facebook_lead_ads', name: 'Facebook Lead Ads', category: 'Ads', source: 'generic' },
  { key: 'instagram_lead_ads', name: 'Instagram Lead Ads', category: 'Ads', source: 'generic' },
  { key: 'other_crm', name: 'Other CRM', category: 'Other', source: 'generic' },
];

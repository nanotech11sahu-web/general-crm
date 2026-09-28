export interface CourseDoc {
  _id: string;
  name: string;
  description: string;
  status: 'draft' | 'published';
  productId?: string;
  thumbnailUrl?: string;
  createdAt: string;
}

export interface EnrollmentDoc {
  _id: string;
  courseId: string | { _id: string; name: string };
  contactId: string;
  status: 'active' | 'completed';
  transactionId?: string;
  enrolledAt: string;
}

export interface CommunityDashboard {
  kpis: {
    totalCourses: number;
    enrollments: number;
    activeMembers: number;
    revenue: number;
  };
  engagement: {
    feedPosts: number;
    messages: number;
    channels: number;
    events: number;
  };
  enrollmentTrend: number;
  topCourses: { courseId: string; name: string; enrollments: number }[];
  topMembers: { contactId: string; xp: number }[];
}

export interface StoreProduct {
  _id: string;
  name: string;
  description?: string;
  salePrice: number;
}

export interface CouponDoc {
  _id: string;
  code: string;
  discountPercent: number;
  active: boolean;
  redemptions: number;
}

export interface CommunityOrderDoc {
  _id: string;
  contactId: string;
  productId: string;
  amount: number;
  couponCode?: string;
  createdAt: string;
}

export const PORTAL_MODULE_KEYS = ['courses', 'events', 'communityFeed', 'chatGroups', 'members', 'leaderboard', 'successHabits', 'billing'] as const;
export type PortalModuleKey = (typeof PORTAL_MODULE_KEYS)[number];

export interface CommunityProfile {
  identity: { name: string; tagline?: string };
  images: { logoUrl?: string; bannerUrl?: string; loginBannerUrl?: string; faviconUrl?: string };
  portalModules: { key: PortalModuleKey; enabled: boolean }[];
  defaultLandingModule: PortalModuleKey;
  advanced: { seoTitle?: string; seoDescription?: string; customScripts?: string };
}

import { api } from '../apiClient';
import type { CourseDoc, EnrollmentDoc, CommunityDashboard, StoreProduct, CouponDoc, CommunityOrderDoc, CommunityProfile } from '../../types/community';

export async function getCommunityDashboard() {
  const res = await api.get('/community/dashboard');
  return res.data as CommunityDashboard;
}

export async function listCourses() {
  const res = await api.get('/community/courses');
  return res.data.courses as CourseDoc[];
}

export async function createCourse(payload: { name: string; description: string; status?: 'draft' | 'published'; productId?: string }) {
  const res = await api.post('/community/courses', payload);
  return res.data.course as CourseDoc;
}

export async function updateCourse(id: string, payload: Partial<CourseDoc>) {
  const res = await api.patch(`/community/courses/${id}`, payload);
  return res.data.course as CourseDoc;
}

export async function purchaseCourse(courseId: string, contactId: string) {
  const res = await api.post(`/community/courses/${courseId}/purchase`, { contactId });
  return res.data.enrollment as EnrollmentDoc;
}

export async function listContactEnrollments(contactId: string) {
  const res = await api.get(`/community/contacts/${contactId}/enrollments`);
  return res.data.enrollments as EnrollmentDoc[];
}

export async function listStoreProducts() {
  const res = await api.get('/community/store/products');
  return res.data.products as StoreProduct[];
}

export async function createStoreProduct(payload: { name: string; salePrice: number; description?: string }) {
  const res = await api.post('/community/store/products', payload);
  return res.data.product as StoreProduct;
}

export async function listCoupons() {
  const res = await api.get('/community/store/coupons');
  return res.data.coupons as CouponDoc[];
}

export async function createCoupon(payload: { code: string; discountPercent: number }) {
  const res = await api.post('/community/store/coupons', payload);
  return res.data.coupon as CouponDoc;
}

export async function listOrders() {
  const res = await api.get('/community/store/orders');
  return res.data.orders as CommunityOrderDoc[];
}

export async function createOrder(payload: { contactId: string; productId: string; couponCode?: string }) {
  const res = await api.post('/community/store/orders', payload);
  return res.data.order as CommunityOrderDoc;
}

export async function getCommunityProfile() {
  const res = await api.get('/community/profile');
  return res.data.profile as CommunityProfile;
}

export async function updateCommunityProfile(payload: Partial<CommunityProfile>) {
  const res = await api.patch('/community/profile', payload);
  return res.data.profile as CommunityProfile;
}

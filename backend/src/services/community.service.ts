import { Course } from '../models/Course';
import { Enrollment } from '../models/Enrollment';
import { CommunityMember } from '../models/CommunityMember';
import { Product } from '../models/Product';
import { EmailCampaign } from '../models/EmailCampaign';
import { recordOneTimeTransaction } from './finance.service';
import { emitPlatformEvent } from '../lib/eventBus';
import { HttpError } from '../middleware/errorHandler';

const XP_PER_ENROLLMENT = 50;

async function awardXp(workspaceId: string, contactId: string, xp: number) {
  const member = await CommunityMember.findOneAndUpdate(
    { workspaceId, contactId },
    { $inc: { xp }, $setOnInsert: { joinedAt: new Date() } },
    { upsert: true, new: true },
  );
  return member;
}

/**
 * Course purchase → Finance DoD: creates the matching FinanceTransaction, grants Community
 * access via an Enrollment, awards gamification XP, and fires both Community Events
 * ("Enrollment" and "Course Access Granted") the Phase 4 trigger bus already knows about.
 */
export async function purchaseCourse(workspaceId: string, contactId: string, courseId: string) {
  const course = await Course.findOne({ _id: courseId, workspaceId, archived: false });
  if (!course) throw new HttpError(404, 'Course not found');
  if (course.status !== 'published') throw new HttpError(400, 'Course is not published');

  const existing = await Enrollment.findOne({ workspaceId, courseId, contactId });
  if (existing) return existing;

  const product = course.productId ? await Product.findOne({ _id: course.productId, workspaceId }) : null;
  const amount = product?.salePrice ?? 0;

  const transaction = await recordOneTimeTransaction({
    workspaceId,
    contactId,
    productId: course.productId ? String(course.productId) : undefined,
    amount,
    method: 'manual',
  });

  const enrollment = await Enrollment.create({
    workspaceId,
    courseId,
    contactId,
    transactionId: transaction._id,
  });

  await awardXp(workspaceId, contactId, XP_PER_ENROLLMENT);

  emitPlatformEvent('community.enrollment', { workspaceId, contactId, courseId });
  emitPlatformEvent('community.courseAccessGranted', { workspaceId, contactId, courseId });

  return enrollment;
}

export async function computeCommunityDashboard(workspaceId: string) {
  const [courses, enrollments, members, campaigns] = await Promise.all([
    Course.find({ workspaceId, archived: false }).lean(),
    Enrollment.find({ workspaceId }).lean(),
    CommunityMember.find({ workspaceId }).lean(),
    EmailCampaign.find({ workspaceId }).lean(),
  ]);

  const courseCounts = new Map<string, number>();
  for (const e of enrollments) {
    const key = String(e.courseId);
    courseCounts.set(key, (courseCounts.get(key) ?? 0) + 1);
  }

  const topCourses = courses
    .map((c) => ({ courseId: String(c._id), name: c.name, enrollments: courseCounts.get(String(c._id)) ?? 0 }))
    .sort((a, b) => b.enrollments - a.enrollments)
    .slice(0, 5);

  const topMembers = members
    .slice()
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 10)
    .map((m) => ({ contactId: String(m.contactId), xp: m.xp }));

  const emailSent = campaigns.reduce((s, c) => s + c.sentCount, 0);

  return {
    kpis: {
      totalCourses: courses.length,
      enrollments: enrollments.length,
      activeMembers: members.length,
      revenue: 0,
    },
    engagement: {
      feedPosts: 0,
      messages: emailSent,
      channels: 0,
      events: 0,
    },
    enrollmentTrend: enrollments.length,
    topCourses,
    topMembers,
  };
}

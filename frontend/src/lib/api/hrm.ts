import { api } from '../apiClient';
import type { StaffDoc, OrgChart, JobRoleDoc, CandidateDoc, InterviewDoc, LeaveRequestDoc, HrmDashboard } from '../../types/operations';

export async function getHrmDashboard() {
  const res = await api.get('/hrm/dashboard');
  return res.data as HrmDashboard;
}

export async function listStaff() {
  const res = await api.get('/hrm/people');
  return res.data.staff as StaffDoc[];
}

export async function createStaff(payload: Partial<StaffDoc> & { name: string; email: string }) {
  const res = await api.post('/hrm/staff', payload);
  return res.data.staff as StaffDoc;
}

export async function getOrgChart() {
  const res = await api.get('/hrm/org-chart');
  return res.data as OrgChart;
}

export async function listDepartments() {
  const res = await api.get('/hrm/departments');
  return res.data.departments as { _id: string; name: string }[];
}

export async function createDepartment(name: string) {
  const res = await api.post('/hrm/departments', { name });
  return res.data.department;
}

export async function listRoles(status?: string) {
  const res = await api.get('/hrm/roles', { params: status ? { status } : undefined });
  return res.data.roles as JobRoleDoc[];
}

export async function createRole(payload: Partial<JobRoleDoc> & { title: string }) {
  const res = await api.post('/hrm/roles', payload);
  return res.data.role as JobRoleDoc;
}

export async function listCandidates(roleId?: string) {
  const res = await api.get('/hrm/candidates', { params: roleId ? { roleId } : undefined });
  return res.data.candidates as CandidateDoc[];
}

export async function createCandidate(payload: { roleId: string; name: string; email: string; phone?: string }) {
  const res = await api.post('/hrm/candidates', payload);
  return res.data.candidate as CandidateDoc;
}

export async function listInterviews(candidateId?: string) {
  const res = await api.get('/hrm/interviews', { params: candidateId ? { candidateId } : undefined });
  return res.data.interviews as InterviewDoc[];
}

export async function createInterview(payload: { candidateId: string; roleId: string; scheduledAt: string; interviewerStaffId?: string }) {
  const res = await api.post('/hrm/interviews', payload);
  return res.data.interview as InterviewDoc;
}

export async function listLeave(status?: string) {
  const res = await api.get('/hrm/leave', { params: status ? { status } : undefined });
  return res.data.leave as LeaveRequestDoc[];
}

export async function createLeave(payload: { staffId: string; type?: string; startDate: string; endDate: string; reason?: string }) {
  const res = await api.post('/hrm/leave', payload);
  return res.data.leave as LeaveRequestDoc;
}

export async function decideLeave(id: string, status: 'approved' | 'rejected') {
  const res = await api.post(`/hrm/leave/${id}/decision`, { status });
  return res.data.leave as LeaveRequestDoc;
}

export async function listAnnouncements() {
  const res = await api.get('/hrm/announcements');
  return res.data.announcements as { _id: string; title: string; content: string; createdAt: string }[];
}

export async function createAnnouncement(payload: { title: string; content: string }) {
  const res = await api.post('/hrm/announcements', payload);
  return res.data.announcement;
}

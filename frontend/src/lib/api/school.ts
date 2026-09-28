import { api } from '../apiClient';
import type { SchoolDashboard, SchoolSetupProgress, AcademicYearDoc, SchoolClassDoc, SubjectDoc, StudentDoc } from '../../types/operations';

export async function getSchoolDashboard() {
  const res = await api.get('/school/dashboard');
  return res.data as SchoolDashboard;
}

export async function getSetupProgress() {
  const res = await api.get('/school/setup-progress');
  return res.data as SchoolSetupProgress;
}

export async function listAcademicYears() {
  const res = await api.get('/school/academic-years');
  return res.data.academicYears as AcademicYearDoc[];
}

export async function createAcademicYear(payload: { name: string; startDate: string; endDate: string }) {
  const res = await api.post('/school/academic-years', payload);
  return res.data.academicYear as AcademicYearDoc;
}

export async function listClasses() {
  const res = await api.get('/school/classes');
  return res.data.classes as SchoolClassDoc[];
}

export async function createClass(payload: { name: string; sections?: string[] }) {
  const res = await api.post('/school/classes', payload);
  return res.data.schoolClass as SchoolClassDoc;
}

export async function listSubjects() {
  const res = await api.get('/school/subjects');
  return res.data.subjects as SubjectDoc[];
}

export async function createSubject(payload: { name: string; classId?: string }) {
  const res = await api.post('/school/subjects', payload);
  return res.data.subject as SubjectDoc;
}

export async function listStudents() {
  const res = await api.get('/school/students');
  return res.data.students as StudentDoc[];
}

export async function createStudent(payload: { name: string; classId?: string; section?: string }) {
  const res = await api.post('/school/students', payload);
  return res.data.student as StudentDoc;
}

export async function getPortalAccess() {
  const res = await api.get('/school/portal-access');
  return res.data.portals as { role: string; accountsEnabled: number; total: number }[];
}

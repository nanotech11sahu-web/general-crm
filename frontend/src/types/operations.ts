export const PROJECT_STATUSES = ['Pending', 'In Progress', 'Review', 'Completed', 'Blocked'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

export interface ProjectDoc {
  _id: string;
  title: string;
  description?: string;
  contactId?: { _id: string; name: string; email?: string } | string;
  status: ProjectStatus;
  priority: ProjectPriority;
  category?: string;
  assigneeId?: string;
  deadline?: string;
  dueTime?: string;
  tagIds: string[];
  createdAt: string;
}

export interface StaffDoc {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  department?: string;
  jobTitle?: string;
  managerId?: string;
  managerName?: string;
  status: 'active' | 'inactive';
  isTeacher: boolean;
  joinedAt: string;
}

export interface OrgChartNode {
  id: string;
  name: string;
  jobTitle?: string;
  department?: string;
  kind: 'owner' | 'staff';
  children: OrgChartNode[];
}

export interface OrgChart {
  kpis: {
    totalStaff: number;
    humanCount: number;
    aiAgentCount: number;
    departmentCount: number;
    teamCount: number;
    depth: number;
  };
  tree: OrgChartNode;
}

export interface JobRoleDoc {
  _id: string;
  title: string;
  department?: string;
  location?: string;
  active: boolean;
  status: 'open' | 'on-hold' | 'closed';
  openings: number;
  salaryRangeMin?: number;
  salaryRangeMax?: number;
}

export interface CandidateDoc {
  _id: string;
  roleId: string;
  name: string;
  email: string;
  phone?: string;
  stage: 'Applied' | 'Screening' | 'Interview' | 'Offer' | 'Hired' | 'Rejected';
  appliedAt: string;
}

export interface InterviewDoc {
  _id: string;
  candidateId: string;
  roleId: string;
  interviewerStaffId?: string;
  scheduledAt: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  feedback?: string;
}

export interface LeaveRequestDoc {
  _id: string;
  staffId: string;
  type: 'Sick' | 'Casual' | 'Earned' | 'Unpaid';
  startDate: string;
  endDate: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface HrmDashboard {
  kpis: {
    headcount: number;
    presentToday: number;
    pendingLeave: number;
    payrollStatus: string;
    openApprovals: number;
    documentExpiries: number;
  };
}

export interface SchoolSetupItem {
  key: string;
  label: string;
  required: boolean;
  complete: boolean;
  count: number;
}

export interface SchoolSetupProgress {
  items: SchoolSetupItem[];
  fullFunctionality: boolean;
}

export interface SchoolDashboard {
  kpis: {
    students: number;
    teachers: number;
    classes: number;
    attendancePercent: number;
    eventsToday: number;
  };
}

export interface AcademicYearDoc {
  _id: string;
  name: string;
  startDate: string;
  endDate: string;
  active: boolean;
}

export interface SchoolClassDoc {
  _id: string;
  name: string;
  sections: string[];
}

export interface SubjectDoc {
  _id: string;
  name: string;
  classId?: string;
}

export interface StudentDoc {
  _id: string;
  name: string;
  classId?: string;
  section?: string;
  parentContactId?: string;
  status: 'active' | 'alumni' | 'transferred_certificate';
}

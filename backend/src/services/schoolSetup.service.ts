import { AcademicYear } from '../models/AcademicYear';
import { SchoolClass } from '../models/SchoolClass';
import { Subject } from '../models/Subject';
import { Staff } from '../models/Staff';
import { Student } from '../models/Student';

export interface SetupChecklistItem {
  key: string;
  label: string;
  required: boolean;
  complete: boolean;
  count: number;
}

export async function computeSetupProgress(workspaceId: string) {
  const [academicYears, classes, subjects, teachers, students] = await Promise.all([
    AcademicYear.countDocuments({ workspaceId, active: true }),
    SchoolClass.countDocuments({ workspaceId }),
    Subject.countDocuments({ workspaceId }),
    Staff.countDocuments({ workspaceId, isTeacher: true, status: 'active' }),
    Student.countDocuments({ workspaceId, status: 'active' }),
  ]);

  const items: SetupChecklistItem[] = [
    { key: 'academicYear', label: 'Academic Year', required: true, complete: academicYears > 0, count: academicYears },
    { key: 'classesAndSections', label: 'Classes & Sections', required: true, complete: classes > 0, count: classes },
    { key: 'subjects', label: 'Subjects', required: true, complete: subjects > 0, count: subjects },
    { key: 'teachers', label: 'Teachers', required: true, complete: teachers > 0, count: teachers },
    { key: 'students', label: 'Students', required: true, complete: students > 0, count: students },
    { key: 'timetables', label: 'Timetables', required: false, complete: false, count: 0 },
    { key: 'curriculum', label: 'Curriculum', required: false, complete: false, count: 0 },
  ];

  const requiredItems = items.filter((i) => i.required);
  const fullFunctionality = requiredItems.every((i) => i.complete);

  return { items, fullFunctionality };
}

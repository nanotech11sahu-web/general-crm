import { HrmTab } from '../operations/HrmTab';

export function HrmsHome() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">HRMS</h1>
      <HrmTab />
    </div>
  );
}

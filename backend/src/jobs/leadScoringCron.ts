import cron from 'node-cron';
import { recalculateAllContactScores } from '../services/leadScoring.service';

// 2:00 AM IST daily. node-cron runs in the server's local time zone; pass 'Asia/Kolkata' explicitly.
export function scheduleNightlyLeadScoring(): void {
  cron.schedule(
    '0 2 * * *',
    async () => {
      const count = await recalculateAllContactScores();
      console.log(`Nightly lead scoring recalculated ${count} contacts`);
    },
    { timezone: 'Asia/Kolkata' },
  );
}

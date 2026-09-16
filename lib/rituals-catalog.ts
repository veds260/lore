import type { RitualId } from './briefs';

// The user-facing ritual catalog. ids map to users.ritualSettings keys;
// jobName maps to cronRuns.jobName for last-run status.
export const RITUAL_CATALOG: Array<{
  id: RitualId;
  jobName: string;
  name: string;
  schedule: string;
  description: string;
}> = [
  {
    id: 'morning_brief',
    jobName: 'telegram-daily',
    name: 'Morning Brief',
    schedule: 'Daily · 8:30am IST',
    description: 'Starts your day with how your last post pulled against your average, what is sitting on the board, and fresh ideas you can draft by replying with a number.',
  },
  {
    id: 'evening_report',
    jobName: 'telegram-performance',
    name: 'Evening Report',
    schedule: 'Daily · 7:30pm IST',
    description: 'Closes the day with what shipped, how it pulled against your baseline, and what to do about it tonight. Skips quiet days instead of padding them.',
  },
];

export const SYSTEM_JOBS: Array<{ jobName: string; name: string; schedule: string; description: string }> = [
  { jobName: 'daily-sync',            name: 'Post sync',           schedule: 'Daily · 4:00 UTC',  description: 'Pulls your latest posts and matches them to drafts so performance lands on the right work.' },
  { jobName: 'score-drafts',          name: 'Draft scoring',       schedule: 'Every 6 hours',     description: 'Scores queued drafts on hook, substance, and authenticity.' },
  { jobName: 'consolidate-skills',    name: 'Voice consolidation', schedule: 'Sundays',           description: 'Folds the rules learned from your edits into your living voice document.' },
  { jobName: 'fetch-mainstream-news', name: 'News scan',           schedule: 'Every 3 hours',     description: 'Pulls fresh news and scores each item for your brand.' },
];

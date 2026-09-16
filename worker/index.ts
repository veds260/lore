// Entry point. The kill switch is checked BEFORE anything heavy loads, so
// `npm run worker` without env vars (or with AGENT_ENABLED unset) exits calmly
// instead of crashing in env validation. Nothing starts by accident.

if (process.env.AGENT_ENABLED !== 'true') {
  console.log('[agent] AGENT_ENABLED is not "true" — exiting. Set AGENT_ENABLED=true to run the worker.');
} else {
  import('./run')
    .then(m => m.main())
    .catch(err => {
      console.error('[agent] fatal:', err);
      process.exit(1);
    });
}

export {};

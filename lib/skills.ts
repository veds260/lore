/**
 * This file has been superseded by the voice document system.
 *
 * Previously, `selectSkillsForPrompt` selected individual skills from the
 * database and injected them into generate/revise prompts on every call.
 *
 * That logic is replaced by a weekly cron (app/api/cron/consolidate-skills)
 * that synthesizes all active skills into a single `voiceDocument` per brand.
 * The voice document is now injected directly in generate/route.ts and
 * revise/route.ts instead.
 *
 * Do not import from this file.
 */

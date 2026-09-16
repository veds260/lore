export type WorkspaceScope = 'global' | 'tenant';
export type PromptFlowTarget = 'tenant' | 'same-tenant' | 'other-tenant';
export type CanonicalWorkspaceFileType = 'profile' | 'rule' | 'story' | 'proof' | 'idea' | 'visual' | 'post' | 'belief';

export interface CanonicalWorkspaceFile {
  path: string;
  title: string;
  type: CanonicalWorkspaceFileType;
  scope: WorkspaceScope;
  tags: string[];
  summary: string;
  body: string;
}

export interface TenantWorkspaceToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

export function canFlowIntoPrompt(source: WorkspaceScope, target: PromptFlowTarget): boolean {
  if (source === 'global') return target === 'tenant' || target === 'same-tenant';
  return target === 'same-tenant';
}

export function canPromoteTenantLearningToGlobal(opts: {
  anonymized: boolean;
  adminApproved: boolean;
}): boolean {
  return opts.anonymized === true && opts.adminApproved === true;
}

export function getCanonicalWorkspaceFiles(opts: { brandName?: string | null } = {}): CanonicalWorkspaceFile[] {
  const brandName = opts.brandName?.trim() || 'this brand';
  return [
    file('AGENTS.md', 'Tenant agent operating rules', 'profile', ['agent', 'workspace'], 'Rules for this private tenant workspace.', `# ${brandName} private agent workspace\n\nThis workspace contains private tenant-local knowledge for ${brandName}.\n\nHard boundary:\n- Global Lore rules may flow into this workspace.\n- This workspace must never flow into another tenant.\n- Local notes, edits, interviews, images, and performance data stay scoped to this tenant/brand.\n- Promote anything to global only after anonymization and admin approval.\n`),
    file('00-profile/voice.md', `${brandName} voice`, 'profile', ['voice'], 'Living voice profile for this brand.', `# ${brandName} voice\n\nAdd voice traits, rhythm, vocabulary, and examples here.\n`),
    file('00-profile/positioning.md', `${brandName} positioning`, 'profile', ['positioning'], 'Audience, category, POV, and market position.', `# ${brandName} positioning\n\nWho this brand serves, what it believes, and what it should be known for.\n`),
    file('00-profile/offer.md', `${brandName} offer`, 'profile', ['offer'], 'Products, services, pricing, and calls to action.', `# ${brandName} offer\n\nProducts, services, proof-backed claims, CTAs, and off-limits promises.\n`),
    file('01-rules/writing-rules.md', `${brandName} writing rules`, 'rule', ['rules', 'writing'], 'Tenant-specific writing rules learned from feedback.', `# ${brandName} writing rules\n\nStable rules promoted from edits, interviews, and explicit feedback.\n`),
    file('01-rules/banned-phrases.md', `${brandName} banned phrases`, 'rule', ['rules', 'banned-phrases'], 'Words and patterns to avoid for this tenant.', `# ${brandName} banned phrases\n\nPhrases, hooks, claims, and writing patterns this tenant rejects.\n`),
    file('01-rules/formatting.md', `${brandName} formatting rules`, 'rule', ['rules', 'formatting'], 'Platform formatting preferences for this tenant.', `# ${brandName} formatting\n\nPreferred post length, spacing, bullets, links, emoji, and CTA patterns.\n`),
    file('02-stories/personal-stories.md', `${brandName} personal stories`, 'story', ['stories'], 'Personal or founder stories available for content.', `# ${brandName} personal stories\n\nReusable stories. Include dates, people, stakes, and what can/cannot be said.\n`),
    file('02-stories/client-stories.md', `${brandName} client stories`, 'story', ['stories', 'clients'], 'Client/customer stories and examples.', `# ${brandName} client stories\n\nClient stories, anonymization notes, permissions, and proof constraints.\n`),
    file('03-proof/proof-points.md', `${brandName} proof points`, 'proof', ['proof'], 'Metrics, case studies, testimonials, and receipts.', `# ${brandName} proof points\n\nUse only verified proof. Mark anything uncertain as needs_review.\n`),
    file('04-ideas/content-angles.md', `${brandName} content angles`, 'idea', ['ideas'], 'Open content angles and unused hooks.', `# ${brandName} content angles\n\nUnused angles, hook seeds, open loops, and topic backlogs.\n`),
    file('05-visuals/visual-style.md', `${brandName} visual style`, 'visual', ['visuals', 'style'], 'Visual style rules and image preferences.', `# ${brandName} visual style\n\nImage style, do/don't-use guidance, recurring motifs, and platform fit.\n`),
    file('05-visuals/asset-index.md', `${brandName} asset index`, 'visual', ['visuals', 'assets'], 'Index of usable visual assets and when to use them.', `# ${brandName} asset index\n\nVisual librarian notes. Do not reference assets from another tenant.\n`),
    file('06-performance/winning-patterns.md', `${brandName} winning patterns`, 'post', ['performance', 'wins'], 'Patterns observed in strong posts for this tenant.', `# ${brandName} winning patterns\n\nPatterns that worked for this tenant, with source post references.\n`),
    file('06-performance/failed-patterns.md', `${brandName} failed patterns`, 'post', ['performance', 'fails'], 'Patterns to avoid based on weak performance or rejection.', `# ${brandName} failed patterns\n\nPatterns that underperformed or were rejected for this tenant.\n`),
    file('07-interviews/knowledge-gaps.md', `${brandName} knowledge gaps`, 'idea', ['interviews', 'gaps'], 'Missing facts the interview agent should ask about.', `# ${brandName} knowledge gaps\n\nWhat Lore still needs to learn before it can write sharper content.\n`),
    file('07-interviews/question-backlog.md', `${brandName} question backlog`, 'idea', ['interviews', 'questions'], 'Question backlog for future interviews.', `# ${brandName} question backlog\n\nQuestions the interview strategist should ask later.\n`),
    file('08-memory/corrections.md', `${brandName} corrections`, 'rule', ['memory', 'corrections'], 'Raw edit/correction observations before consolidation.', `# ${brandName} corrections\n\nAppend-only learning from edits, regenerations, rejections, and explicit feedback.\n`),
    file('08-memory/learned-preferences.md', `${brandName} learned preferences`, 'rule', ['memory', 'preferences'], 'Consolidated preferences learned over time.', `# ${brandName} learned preferences\n\nPreferences promoted from repeated observations. Keep concise and current.\n`),
    file('08-memory/changelog.md', `${brandName} agent changelog`, 'profile', ['memory', 'changelog'], 'Audit log of agent-authored workspace updates.', `# ${brandName} agent changelog\n\nAgent-authored workspace changes, reasons, and source event IDs.\n`),
  ];
}

export function getTenantWorkspaceToolDefinitions(): TenantWorkspaceToolDefinition[] {
  return [
    tool('searchTenantVault', 'Search the authenticated tenant workspace only.', { query: textProp('Search query'), limit: intProp('Maximum results') }, ['query']),
    tool('readWorkspaceFile', 'Read one file from the authenticated tenant workspace.', { path: textProp('Workspace-relative path') }, ['path']),
    tool('patchWorkspaceFile', 'Patch one file in the authenticated tenant workspace.', { path: textProp('Workspace-relative path'), oldText: textProp('Exact text to replace'), newText: textProp('Replacement text') }, ['path', 'oldText', 'newText']),
    tool('appendLearningObservation', 'Append a raw learning observation to tenant memory.', { observation: textProp('Observation to append'), sourceEvent: textProp('Optional source event identifier') }, ['observation']),
    tool('recommendTenantAsset', 'Recommend tenant-owned visual assets for a topic.', { topic: textProp('Post or campaign topic'), max: intProp('Maximum assets') }, ['topic']),
    tool('createTenantNote', 'Create a tenant-local vault note.', { path: textProp('Workspace-relative path'), title: textProp('Note title'), body: textProp('Markdown body') }, ['path', 'title', 'body']),
  ];
}

function file(path: string, title: string, type: CanonicalWorkspaceFileType, tags: string[], summary: string, body: string): CanonicalWorkspaceFile {
  return { path, title, type, scope: 'tenant', tags, summary, body };
}

function textProp(description: string) {
  return { type: 'string', description };
}

function intProp(description: string) {
  return { type: 'integer', minimum: 1, maximum: 25, description };
}

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): TenantWorkspaceToolDefinition {
  return {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  };
}

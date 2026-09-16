export type AgentName =
  | 'vault_curator'
  | 'visual_librarian'
  | 'post_strategist'
  | 'editor_qa'
  | 'learning';

export interface AgentRunResult<TOut = unknown> {
  ok: boolean;
  output?: TOut;
  error?: string;
}

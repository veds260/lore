export type DraftStatus =
  | 'ideas'
  | 'drafts'
  | 'review'
  | 'posted';

export type Platform = 'twitter' | 'linkedin' | 'both';

export type PostLength = 'short' | 'medium' | 'long' | 'auto';

export interface DraftSourceInput {
  noteId?: string | null;
  assetId?: string | null;
  reason?: string | null;
  relevanceScore?: number | null;
}

export interface DraftSourceRecord {
  id: string;
  kind: 'note' | 'asset';
  title: string;
  subtitle: string | null;
  reason: string | null;
  relevanceScore: number | null;
  noteType?: string | null;
  assetUrl?: string | null;
  thumbnailUrl?: string | null;
}

// Explanation for a visual Lore recommended from the vault. Stored as
// non-secret metadata in drafts.notes so the board and drawer can show why a
// given image was attached, and which vault asset it came from.
export interface RecommendedImage {
  id?: string | null;        // vault asset id (when the visual came from the vault)
  url: string;               // resolved file url
  filename?: string | null;
  caption?: string | null;
  reason?: string | null;    // why Lore picked it (e.g. "tag-match, topic-match")
  source?: 'vault';          // marks the visual as a vault recommendation
}

export interface Draft {
  id: string;
  content: string;           // Twitter/X version (primary)
  linkedinContent?: string;  // LinkedIn version (when platform = 'both')
  imageUrl?: string;         // AI-generated visual for the post
  recommendedImage?: RecommendedImage; // vault visual Lore recommended, with explanation
  sourceInputs?: DraftSourceInput[];
  status: DraftStatus;
  platform: Platform;
  score?: number;
  scoreBreakdown?: ScoreBreakdown;
  createdAt: string;
  isDemo?: boolean;          // True for example cards shown to new users
}

export interface ScoreBreakdown {
  hook: number;
  clarity: number;
  originality: number;
  cta: number;
  format: number;
}

export interface Column {
  id: DraftStatus;
  label: string;
  dot: string;
}

export const COLUMNS: Column[] = [
  { id: 'ideas',  label: 'Ideas',       dot: '#9B8EA0' },
  { id: 'drafts', label: 'Drafts',      dot: '#6B7F9E' },
  { id: 'review', label: 'Final Draft', dot: '#D5A843' },
  { id: 'posted', label: 'Live',        dot: '#529E63' },
];

export const NEXT_STATUS: Partial<Record<DraftStatus, DraftStatus>> = {
  ideas:  'drafts',
  drafts: 'review',
  review: 'posted',
};

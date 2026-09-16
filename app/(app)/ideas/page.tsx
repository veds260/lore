'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, RefreshCw, TrendingUp, Users, Mic2, Zap, LayoutTemplate, Lightbulb } from 'lucide-react';
import { LimitReachedModal } from '@/components/ui/limit-reached-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { getCache, setCache, invalidateCache } from '@/lib/page-cache';

const IDEAS_CACHE_KEY = 'ideas:list';
const IDEAS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min, stale-while-revalidate window

interface IdeasCachePayload {
  ideas: Idea[];
  hasInterviewData: boolean;
}

type IdeaSource = 'interview' | 'trending' | 'competitor_gap' | 'pattern';
type FilterTab = 'all' | IdeaSource;

interface Idea {
  id: string;
  title: string;
  hook: string;
  angle: string;
  source: IdeaSource;
  potential: 'high' | 'medium' | 'low';
}

const SOURCE_ICONS: Record<IdeaSource, React.ReactNode> = {
  interview:      <Mic2 size={11} />,
  trending:       <TrendingUp size={11} />,
  competitor_gap: <Users size={11} />,
  pattern:        <Zap size={11} />,
};

const SOURCE_LABELS: Record<IdeaSource, string> = {
  interview:      'Interview',
  trending:       'Trending',
  competitor_gap: 'Competitor gap',
  pattern:        'Pattern',
};

function categoryToSource(category: string): IdeaSource {
  if (category === 'hot_take' || category === 'prediction') return 'trending';
  if (category === 'how_to' || category === 'lesson') return 'pattern';
  return 'interview';
}

const DEMO_IDEAS: Idea[] = [
  { id: 'd1', title: 'The gap between follower count and actual revenue', hook: 'Large accounts earn less than you think.', angle: 'You built an audience. Now what? Most large accounts earn less than smaller, trust-dense ones. Why.', source: 'trending', potential: 'high' },
  { id: 'd2', title: 'How you built the interview question framework', hook: 'The first version got almost everything wrong.', angle: 'Behind-the-scenes of how you developed the question list: what changed and why.', source: 'interview', potential: 'high' },
  { id: 'd3', title: 'Why ghostwriting is really an editing job', hook: "The real work isn't writing new content.", angle: 'Finding what the founder already says and removing everything else.', source: 'pattern', potential: 'high' },
  { id: 'd4', title: 'The 30-minute engagement window after posting', hook: 'What happens in the first 30 minutes determines everything.', angle: 'What happens algorithmically in the first 30 minutes after a post goes live.', source: 'competitor_gap', potential: 'medium' },
  { id: 'd5', title: 'How to run a content audit on yourself', hook: '3 months of posts. Two hours. One clear answer.', angle: 'The exact process of reviewing 3 months of posts and identifying what your audience actually responds to.', source: 'interview', potential: 'medium' },
  { id: 'd6', title: 'Content pillars are mostly fiction', hook: 'Every consultant recommends them. Successful creators ignore them.', angle: 'What successful creators have instead of content pillars.', source: 'competitor_gap', potential: 'medium' },
];

function IdeaCard({
  idea,
  onTurnIntoDraft,
  generatingId,
}: {
  idea: Idea;
  onTurnIntoDraft: (idea: Idea) => void;
  generatingId: string | null;
}) {
  const loading = generatingId === idea.id;

  return (
    <div className="relative bg-card border border-border rounded-md px-4 py-3.5 hover:border-muted-foreground/40 transition-colors">
      <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-l bg-[#529E63]" />

      <div className="ml-1">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {SOURCE_ICONS[idea.source]}
            {SOURCE_LABELS[idea.source]}
          </span>
        </div>

        <p className="text-sm font-medium text-foreground leading-snug">{idea.title}</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">{idea.angle}</p>

        <div className="mt-3 flex items-center justify-end">
          <button
            onClick={() => onTurnIntoDraft(idea)}
            disabled={loading || generatingId !== null}
            className="flex items-center gap-1.5 text-xs text-foreground font-medium hover:underline underline-offset-2 disabled:opacity-40 transition-opacity"
          >
            {loading
              ? <><Loader2 size={11} className="animate-spin" /> Generating...</>
              : <>Generate post <ArrowRight size={12} /></>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IdeasPage() {
  const router = useRouter();
  const cached = getCache<IdeasCachePayload>(IDEAS_CACHE_KEY, IDEAS_CACHE_TTL_MS);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [ideas, setIdeas] = useState<Idea[]>(cached?.ideas ?? []);
  const [hasInterviewData, setHasInterviewData] = useState(cached?.hasInterviewData ?? false);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [useTemplate, setUseTemplate] = useState(false);
  const [limitModal, setLimitModal] = useState<{ limit: number; retryFn: () => Promise<void> } | null>(null);

  useEffect(() => {
    Promise.resolve()
      .then(() => {
        setUseTemplate(localStorage.getItem('lore-use-template') === 'true');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem('lore-use-template', String(useTemplate));
  }, [useTemplate]);

  const loadIdeas = useCallback(async () => {
    try {
      const res = await fetch('/api/ideas');
      const data = await res.json() as { ideas: Array<{ id: string; angle: string; hook: string; category: string; source: string }>; hasInterviewData: boolean };

      let nextIdeas: Idea[];
      let nextHasInterview: boolean;
      if (data.hasInterviewData && data.ideas.length > 0) {
        nextIdeas = data.ideas.map(i => ({
          id: i.id,
          title: i.angle,
          hook: i.hook,
          angle: i.source,
          source: categoryToSource(i.category),
          potential: 'high' as const,
        }));
        nextHasInterview = true;
      } else {
        nextIdeas = DEMO_IDEAS;
        nextHasInterview = false;
      }
      setIdeas(nextIdeas);
      setHasInterviewData(nextHasInterview);
      setCache<IdeasCachePayload>(IDEAS_CACHE_KEY, { ideas: nextIdeas, hasInterviewData: nextHasInterview });
    } catch {
      setIdeas(DEMO_IDEAS);
      setHasInterviewData(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Skip the initial fetch entirely when we hydrated from a fresh cache.
    // Manual refresh and post-generate invalidation force a reload.
    if (cached) return;
    Promise.resolve().then(() => loadIdeas());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadIdeas]);

  async function handleRefresh() {
    setRefreshing(true);
    invalidateCache(IDEAS_CACHE_KEY);
    await loadIdeas();
  }

  async function doGenerate(idea: Idea, forceCredits = false) {
    setGeneratingId(idea.id);
    setGenerateError(null);
    const topic = `${idea.title}\n\nOpening hook: ${idea.hook}\n\nContext: ${idea.angle}`;

    try {
      const genRes = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, length: 'auto', useTemplate, chat: forceCredits || undefined }),
      });
      const genData = await genRes.json() as { twitter?: string; linkedin?: string; error?: string; type?: string; limit?: number };

      if (!genRes.ok || !genData.twitter) {
        if (genData.type === 'daily_limit_reached') {
          setLimitModal({ limit: genData.limit ?? 3, retryFn: async () => {
            setLimitModal(null);
            await doGenerate(idea, true);
          }});
        } else {
          setGenerateError(genData.error ?? 'Generation failed. Please try again.');
        }
        setGeneratingId(null);
        return;
      }

      await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: genData.twitter,
          linkedinContent: genData.linkedin,
          platform: genData.linkedin ? 'both' : 'twitter',
          status: 'drafts',
        }),
      });

      // The just-used idea should disappear from the cached list when the user
      // comes back to /ideas. Server already removed it, so just invalidate.
      invalidateCache(IDEAS_CACHE_KEY);
      window.location.href = '/board';
    } catch {
      setGenerateError('Something went wrong. Please try again.');
      setGeneratingId(null);
    }
  }

  function handleTurnIntoDraft(idea: Idea) {
    return doGenerate(idea);
  }

  const filtered = ideas.filter(i => filter === 'all' || i.source === filter);

  return (
    <div className="p-8 lg:p-10 w-full">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ideas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {hasInterviewData
              ? 'Generated from your latest interview. Click any card to write the full post.'
              : 'Example ideas. Run an interview to get ideas based on your own content.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setUseTemplate(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
              useTemplate
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
            }`}
          >
            <LayoutTemplate size={11} />
            Use a format
          </button>
          {hasInterviewData && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {limitModal && (
        <LimitReachedModal
          limit={limitModal.limit}
          onUseCredits={limitModal.retryFn}
          onClose={() => setLimitModal(null)}
        />
      )}

      {generateError && (
        <div className="mb-4 px-3 py-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
          {generateError}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {(['all', 'interview', 'trending', 'competitor_gap', 'pattern'] as FilterTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-2 text-xs font-medium capitalize transition-colors border-b-2 -mb-px whitespace-nowrap ${
              filter === tab
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'all' ? 'All' : SOURCE_LABELS[tab as IdeaSource]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading ideas...</span>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title={filter === 'all' ? 'No ideas yet' : `No ${SOURCE_LABELS[filter as IdeaSource].toLowerCase()} ideas`}
          description={filter === 'all'
            ? 'Run an interview or connect a content source. Lore will pull angles from your own words and surface them here.'
            : 'Switch filters, refresh, or run an interview to expand the pool.'}
          primary={filter === 'all' ? { label: 'Start an interview', href: '/interviews' } : undefined}
          secondary={filter !== 'all' ? { label: 'See all ideas', onClick: () => setFilter('all') } : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map(idea => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onTurnIntoDraft={handleTurnIntoDraft}
              generatingId={generatingId}
            />
          ))}
        </div>
      )}

      {!hasInterviewData && !loading && (
        <p className="text-[11px] text-muted-foreground/60 mt-6 text-center">
          These are example ideas. Go to Interview to generate ideas from your own content.
        </p>
      )}
    </div>
  );
}

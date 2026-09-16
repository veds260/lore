'use client';

import { useState, useEffect } from 'react';
import { Mic2, Clock, Sparkles, Lock, Loader2, ExternalLink, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

type SessionStatus = 'completed' | 'active' | 'paused' | 'pending';

interface InterviewSession {
  id: string;
  status: SessionStatus;
  startedAt: string | null;
  completedAt: string | null;
  answeredCount: number;
  ideasExtracted: number | null;
  transcript: string | null;
  shareUrl: string | null;
}

interface PlanStatus {
  used: number;
  quota: number;
  plan: string;
  isUnlimited: boolean;
}

function TranscriptBlock({ transcript }: { transcript: string }) {
  return (
    <div className="mt-3 pt-3 border-t border-border space-y-4 max-h-[400px] overflow-y-auto pr-1">
      {transcript.split(/\n\n---\n\n/).map((block, i) => {
        const qMatch = block.match(/\*\*Q\d+\*\*:\s*(.*?)(?:\n\n|$)([\s\S]*)/);
        if (qMatch) {
          return (
            <div key={i} className="space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground">{qMatch[1]}</p>
              <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{qMatch[2].trim()}</p>
            </div>
          );
        }
        return <p key={i} className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{block}</p>;
      })}
    </div>
  );
}

export default function InterviewsPage() {
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [newSession, setNewSession] = useState<{ shareUrl: string } | null>(null);
  const [planStatus, setPlanStatus] = useState<PlanStatus>({ used: 0, quota: 0, plan: 'free', isUnlimited: false });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/interviews/status')
      .then(r => r.json())
      .then((data: PlanStatus) => setPlanStatus(data))
      .catch(() => {});

    fetch('/api/interviews/sessions')
      .then(r => r.json())
      .then((data: { sessions: InterviewSession[] }) => setSessions(data.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, []);

  const { used, quota, isUnlimited } = planStatus;
  const remaining = isUnlimited ? Infinity : Math.max(0, quota - used);
  const exhausted = !isUnlimited && quota === 0;
  const limitReached = !isUnlimited && !exhausted && remaining === 0;

  async function handleStart() {
    setStarting(true);
    setStartError('');
    setNewSession(null);
    try {
      const res = await fetch('/api/interviews/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          setStartError(data.quota === 0
            ? 'Interviews are not available on the free plan. Upgrade to get access.'
            : `You've used all ${data.quota} interviews for this month. Upgrade your plan for more.`);
        } else if (res.status === 503) {
          setStartError('Interview service is not configured yet. Check back soon.');
        } else {
          setStartError(data.error ?? 'Something went wrong');
        }
        return;
      }
      setNewSession({ shareUrl: data.shareUrl });
      setSessions(prev => [{
        id: data.sessionId,
        status: 'active',
        startedAt: new Date().toISOString(),
        completedAt: null,
        answeredCount: 0,
        ideasExtracted: null,
        transcript: null,
        shareUrl: data.shareUrl,
      }, ...prev]);
      setPlanStatus(prev => ({ ...prev, used: prev.used + 1 }));
    } finally {
      setStarting(false);
    }
  }

  function toggleTranscript(id: string) {
    setExpandedId(prev => prev === id ? null : id);
  }

  return (
    <div className="p-8 lg:p-10 w-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Interviews</h1>
          <p className="text-sm text-muted-foreground mt-1">AI-led sessions that pull out your best ideas.</p>
        </div>
        <button
          onClick={handleStart}
          disabled={exhausted || limitReached || starting}
          className={`flex items-center gap-2 text-sm px-4 py-2 rounded-md font-medium transition-opacity ${
            exhausted || limitReached
              ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
              : 'bg-foreground text-background hover:opacity-90'
          }`}
        >
          {starting ? <Loader2 size={14} className="animate-spin" /> : (exhausted || limitReached) ? <Lock size={14} /> : <Mic2 size={14} />}
          {starting ? 'Starting...' : exhausted ? 'Not on free plan' : limitReached ? 'Limit reached' : 'Start interview'}
        </button>
      </div>

      {/* Quota meter */}
      <div className="flex items-center gap-3 bg-card border border-border rounded-md px-4 py-3 mb-6">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-foreground">
              {isUnlimited
                ? 'Unlimited interviews'
                : quota === 0
                ? 'Interviews not included in free plan'
                : `${used} of ${quota} interviews used this month`}
            </span>
            {!isUnlimited && quota > 0 && (
              <span className="tabular text-xs text-muted-foreground">{remaining} remaining</span>
            )}
          </div>
          {!isUnlimited && quota > 0 && (
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min((used / quota) * 100, 100)}%` }}
              />
            </div>
          )}
        </div>
        {(exhausted || limitReached) && (
          <a href="/settings" className="text-xs text-primary underline underline-offset-2 shrink-0">Upgrade</a>
        )}
      </div>

      {/* New session link banner */}
      {newSession && (
        <div className="flex items-center gap-3 bg-[#529E63]/10 border border-[#529E63]/30 rounded-md px-4 py-3 mb-4">
          <Mic2 size={16} className="text-[#529E63] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">Interview ready</p>
            <p className="text-xs text-muted-foreground truncate">{newSession.shareUrl}</p>
          </div>
          <a
            href={`${newSession.shareUrl}?owner=true`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 flex items-center gap-1 text-xs text-foreground font-medium hover:underline underline-offset-2"
          >
            Open <ExternalLink size={11} />
          </a>
        </div>
      )}

      {startError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-md px-4 py-3 mb-4">
          <p className="text-xs text-destructive">{startError}</p>
        </div>
      )}

      {/* Past sessions */}
      {loadingSessions ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 size={12} className="animate-spin" /> Loading sessions...
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={Mic2}
          title="No interviews yet"
          description={exhausted
            ? 'Interviews are not on the free plan. Upgrade and Lore will start surfacing the angles only you can write.'
            : 'Start your first interview. Lore will ask 8 to 12 questions, pull out the best stories, and turn them into ideas you can post.'}
          primary={exhausted
            ? { label: 'Upgrade plan', href: '/settings' }
            : { label: starting ? 'Starting...' : 'Start interview', onClick: handleStart, loading: starting || limitReached }}
        />
      ) : (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Sessions</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {sessions.map(session => {
              const isExpanded = expandedId === session.id;
              const hasTranscript = !!session.transcript;
              return (
                <div
                  key={session.id}
                  className="bg-card border border-border rounded-md px-4 py-3.5 transition-colors hover:border-muted-foreground/30"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <Mic2 size={14} className="text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {session.completedAt
                            ? new Date(session.completedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                            : session.startedAt
                            ? new Date(session.startedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                            : 'Interview session'}
                        </span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
                          session.status === 'completed'
                            ? 'bg-[#529E63]/10 text-[#529E63]'
                            : session.status === 'active'
                            ? 'bg-[#2383E2]/10 text-[#2383E2]'
                            : session.status === 'paused'
                            ? 'bg-amber-500/10 text-amber-500'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {session.status}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {session.answeredCount > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock size={10} /> {session.answeredCount} answers
                          </span>
                        )}
                        {session.ideasExtracted != null && session.ideasExtracted > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Sparkles size={10} /> {session.ideasExtracted} ideas extracted
                          </span>
                        )}
                        {session.shareUrl && session.status !== 'completed' && (
                          <a
                            href={`${session.shareUrl}?owner=true`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-primary hover:underline underline-offset-2 flex items-center gap-1"
                          >
                            Resume session <ExternalLink size={10} />
                          </a>
                        )}
                      </div>

                      {hasTranscript && (
                        <button
                          onClick={() => toggleTranscript(session.id)}
                          className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <FileText size={11} />
                          {isExpanded ? 'Hide transcript' : 'View transcript'}
                          {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </button>
                      )}

                      {isExpanded && session.transcript && (
                        <TranscriptBlock transcript={session.transcript} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="mt-8 pt-6 border-t border-border">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-4">How it works</p>
        <div className="space-y-3">
          {[
            { n: '01', title: 'You get a private link', body: 'Click "Start interview" and Lore generates a unique session link. Open it on your phone or desktop.' },
            { n: '02', title: 'AI leads the conversation', body: 'The interviewer asks questions based on what your audience wants to know: your wins, process, opinions, and lessons.' },
            { n: '03', title: 'Ideas surface automatically', body: 'When the session ends, Lore extracts content angles and adds them to your Ideas page. Turn any into a draft with one click.' },
          ].map(s => (
            <div key={s.n} className="flex gap-4">
              <span className="tabular text-xs text-muted-foreground/50 font-mono w-6 shrink-0 mt-0.5">{s.n}</span>
              <div>
                <p className="text-xs font-semibold text-foreground">{s.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

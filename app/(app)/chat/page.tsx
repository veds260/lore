'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Send, Loader2, BookmarkPlus, Check, Link2, PlayCircle,
  Plus, MessageSquare, Brain, Wand2, X,
} from 'lucide-react';
import {
  TwitterMockup, LinkedInMockup,
  type Profile, FALLBACK_PROFILE,
} from '@/components/ui/platform-mockups';
import { ModKey } from '@/components/ui/mod-key';

type Role = 'user' | 'assistant';

interface GeneratedPost {
  twitter: string;
  linkedin: string;
}

interface Message {
  id: string;
  role: Role;
  text?: string;
  posts?: GeneratedPost;
  saved?: boolean;
  loading?: boolean;
  isQuestion?: boolean;
}

interface PendingContext {
  originalTopic: string;
  question: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

function detectUrl(text: string): { type: 'youtube' | 'reddit' | 'twitter' | 'generic' | null; url: string | null } {
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return { type: null, url: null };
  const url = urlMatch[0];
  if (url.includes('youtube.com') || url.includes('youtu.be')) return { type: 'youtube', url };
  if (url.includes('reddit.com')) return { type: 'reddit', url };
  if (url.includes('twitter.com') || url.includes('x.com')) return { type: 'twitter', url };
  return { type: 'generic', url };
}

function UrlChip({ type, url }: { type: string; url: string }) {
  const label = { youtube: 'YouTube', reddit: 'Reddit', twitter: 'X / Twitter', generic: 'Link' }[type] ?? 'Link';
  const color = {
    youtube: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/40',
    reddit: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800/40',
    twitter: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-800/40',
    generic: 'bg-muted text-muted-foreground border-border',
  }[type] ?? 'bg-muted text-muted-foreground border-border';

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded border ${color} hover:opacity-80 transition-opacity`}
    >
      {type === 'youtube' ? <PlayCircle size={11} /> : <Link2 size={11} />}
      {label}
    </a>
  );
}

function PostCard({ posts: initialPosts, onSave, saved, profile }: {
  posts: GeneratedPost;
  onSave: () => void;
  saved: boolean;
  profile: Profile;
}) {
  const [tab, setTab] = useState<'twitter' | 'linkedin'>('twitter');
  const [posts, setPosts] = useState(initialPosts);
  const [revising, setRevising] = useState(false);
  const [reviseInstruction, setReviseInstruction] = useState('');
  const [reviseLoading, setReviseLoading] = useState(false);
  const [revisedContent, setRevisedContent] = useState<string | null>(null);
  const [learnedSkill, setLearnedSkill] = useState<{ name: string } | null>(null);
  const [revisionOriginal, setRevisionOriginal] = useState<string | null>(null);
  const [revisionInstructions, setRevisionInstructions] = useState<string[]>([]);
  const [reviseBase, setReviseBase] = useState<string | null>(null);

  const currentContent = reviseBase ?? posts[tab];

  async function handleRevise() {
    if (!reviseInstruction.trim() || reviseLoading) return;
    setReviseLoading(true);
    if (!revisionOriginal) setRevisionOriginal(posts[tab]);
    try {
      const res = await fetch('/api/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: currentContent, instruction: reviseInstruction, platform: tab }),
      });
      const data = await res.json();
      if (res.ok) setRevisedContent(data.revised ?? null);
    } finally {
      setReviseLoading(false);
    }
  }

  async function handleAccept() {
    if (!revisedContent) return;
    const allInstructions = [...revisionInstructions, reviseInstruction].filter(Boolean);
    const original = revisionOriginal ?? posts[tab];
    setPosts(prev => ({ ...prev, [tab]: revisedContent }));
    setRevisedContent(null);
    setRevising(false);
    setReviseInstruction('');
    setRevisionOriginal(null);
    setRevisionInstructions([]);
    setReviseBase(null);

    try {
      const res = await fetch('/api/skills/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original, revised: revisedContent, instructions: allInstructions, platform: tab }),
      });
      const data = await res.json();
      if (data.skill) {
        setLearnedSkill(data.skill);
        setTimeout(() => setLearnedSkill(null), 4000);
      }
    } catch { /* silent */ }
  }

  function handleReviseFromRevised() {
    if (!revisedContent) return;
    setRevisionInstructions(prev => [...prev, reviseInstruction]);
    setReviseBase(revisedContent);
    setRevisedContent(null);
    setReviseInstruction('');
  }

  function handleCancel() {
    setRevising(false);
    setReviseInstruction('');
    setRevisedContent(null);
    setRevisionOriginal(null);
    setRevisionInstructions([]);
    setReviseBase(null);
  }

  return (
    <div className="space-y-2.5 w-full">
      <div className="flex gap-2">
        <button
          onClick={() => setTab('twitter')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            tab === 'twitter' ? 'bg-black text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          X (Twitter)
        </button>
        <button
          onClick={() => setTab('linkedin')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            tab === 'linkedin' ? 'bg-[#0A66C2] text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          LinkedIn
        </button>
      </div>

      {tab === 'twitter' ? (
        <TwitterMockup text={posts.twitter} profile={profile} />
      ) : (
        <LinkedInMockup text={posts.linkedin} profile={profile} />
      )}

      {learnedSkill && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[#529E63]/10 border border-[#529E63]/20 rounded-md">
          <Brain size={12} className="text-[#529E63]" />
          <span className="text-[11px] text-[#529E63] font-medium">Skill learned: {learnedSkill.name}</span>
        </div>
      )}

      {revising ? (
        <div className="space-y-2 border border-border rounded-xl p-3 bg-card">
          <p className="text-[11px] text-muted-foreground font-medium">
            {reviseBase ? 'Working from revision' : `Revising ${tab === 'twitter' ? 'X' : 'LinkedIn'} post`}
          </p>
          {revisedContent ? (
            <div className="space-y-2">
              <div className="text-xs text-foreground leading-relaxed bg-muted/40 rounded-lg px-3 py-2.5 whitespace-pre-wrap">
                {revisedContent}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAccept}
                  className="flex-1 py-1.5 text-xs font-semibold bg-foreground text-background rounded-lg hover:opacity-90 transition-opacity"
                >
                  Use this
                </button>
                <button
                  onClick={handleReviseFromRevised}
                  className="flex-1 py-1.5 text-xs font-semibold bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
                >
                  Revise further
                </button>
                <button
                  onClick={() => setRevisedContent(null)}
                  className="py-1.5 px-2 text-xs text-muted-foreground rounded-lg hover:bg-muted transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                autoFocus
                value={reviseInstruction}
                onChange={e => setReviseInstruction(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRevise()}
                placeholder="e.g. make the hook punchier"
                className="flex-1 text-xs bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
              />
              <button
                onClick={handleRevise}
                disabled={!reviseInstruction.trim() || reviseLoading}
                className="px-3 py-2 text-xs bg-foreground text-background rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {reviseLoading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
              </button>
              <button onClick={handleCancel} className="px-2 py-2 text-xs text-muted-foreground rounded-lg hover:bg-muted transition-colors">
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2 pt-0.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground tabular">
                {tab === 'twitter'
                  ? `${posts.twitter.length} chars`
                  : `${posts.linkedin.split(/\s+/).filter(Boolean).length} words`}
              </span>
              <button
                onClick={() => setRevising(true)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Wand2 size={11} /> Revise
              </button>
            </div>
            <button
              onClick={onSave}
              disabled={saved}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-all ${
                saved
                  ? 'bg-[#529E63]/10 text-[#529E63] border border-[#529E63]/20'
                  : 'bg-foreground text-background hover:opacity-90'
              }`}
            >
              {saved ? <Check size={12} /> : <BookmarkPlus size={12} />}
              {saved ? 'Saved' : 'Save to board'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg, onSave, profile }: {
  msg: Message;
  onSave: (id: string) => void;
  profile: Profile;
}) {
  const { type: urlType, url } = detectUrl(msg.text ?? '');

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-foreground text-background rounded-2xl rounded-tr-sm px-4 py-2.5">
          {urlType && url && <div className="mb-2"><UrlChip type={urlType} url={url} /></div>}
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
        </div>
      </div>
    );
  }

  if (msg.loading) {
    return (
      <div className="flex justify-start">
        <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
          <Loader2 size={13} className="animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {msg.isQuestion ? 'Thinking...' : 'Writing your posts...'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start max-w-[92%]">
      <div className="space-y-3 w-full">
        {msg.text && (
          <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-2.5">
            <p className="text-sm text-foreground leading-relaxed">{msg.text}</p>
          </div>
        )}
        {msg.posts && (
          <div className="max-w-[500px]">
            <PostCard
              posts={msg.posts}
              saved={!!msg.saved}
              onSave={() => onSave(msg.id)}
              profile={profile}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const FALLBACK_STARTERS = [
  'Describe an idea you want to write about',
  'Paste a YouTube video, Reddit thread, or tweet to turn into a post',
  'Share a lesson you learned this week',
  'Paste a draft and ask for a sharper version',
];

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingContext, setPendingContext] = useState<PendingContext | null>(null);
  const [profile, setProfile] = useState<Profile>(FALLBACK_PROFILE);
  const [starters, setStarters] = useState<string[]>(FALLBACK_STARTERS);
  const [loadingConv, setLoadingConv] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const adjustInputHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, 40), 200);
    el.style.height = `${next}px`;
  }, []);

  useEffect(() => { adjustInputHeight(); }, [input, adjustInputHeight]);

  useEffect(() => {
    fetch('/api/profile').then(r => r.ok ? r.json() : null).then(d => { if (d) setProfile(d); }).catch(() => {});
    fetch('/api/chats').then(r => r.json()).then(setConversations).catch(() => {});
    fetch('/api/chats/starters')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.starters && Array.isArray(d.starters) && d.starters.length > 0) {
          setStarters(d.starters);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversation = useCallback(async (id: string) => {
    setLoadingConv(true);
    setConvId(id);
    setMessages([]);
    setPendingContext(null);
    try {
      const msgs = await fetch(`/api/chats/${id}/messages`).then(r => r.json());
      setMessages(msgs.map((m: { id: string; role: Role; text?: string; posts?: GeneratedPost; isQuestion?: boolean }) => ({
        id: m.id,
        role: m.role,
        text: m.text ?? undefined,
        posts: m.posts ?? undefined,
        isQuestion: m.isQuestion ?? false,
      })));
    } catch { /* silent */ }
    finally { setLoadingConv(false); }
  }, []);

  function startNewChat() {
    setConvId(null);
    setMessages([]);
    setInput('');
    setPendingContext(null);
    inputRef.current?.focus();
  }

  async function saveMessage(cId: string, msg: { role: string; text?: string; posts?: GeneratedPost; isQuestion?: boolean }) {
    await fetch(`/api/chats/${cId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).catch(() => {});
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text };
    const loadingId = crypto.randomUUID();
    const loadingMsg: Message = { id: loadingId, role: 'assistant', loading: true };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput('');
    setSending(true);

    try {
      let topic: string;
      let useChat: boolean;

      if (pendingContext) {
        topic = `${pendingContext.originalTopic}\n\nYou asked: ${pendingContext.question}\n\nMy answer: ${text}`;
        useChat = false;
        setPendingContext(null);
      } else {
        topic = text;
        useChat = true;
      }

      // Serialize conversation history (last 10 non-loading messages) for context
      const history = messages
        .filter(m => !m.loading)
        .slice(-10)
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.posts
            ? `Generated posts:\nTwitter: ${m.posts.twitter}\nLinkedIn: ${m.posts.linkedin}`
            : (m.text ?? ''),
        }))
        .filter(m => m.content.trim());

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, length: 'auto', chat: useChat, history: useChat && history.length ? history : undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errText = data.type === 'insufficient_credits'
          ? `You've used all your credits this month (${data.balance} left, ${data.required} needed). Upgrade your plan in Settings to keep going.`
          : (data.error ?? 'Something went wrong.');
        setMessages(prev => prev.map(m =>
          m.id === loadingId ? { ...m, loading: false, text: errText } : m
        ));
        return;
      }

      let activeConvId = convId;

      if (!activeConvId) {
        const created = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.slice(0, 80) }),
        }).then(r => r.json()).catch(() => null);

        if (created?.id) {
          activeConvId = created.id;
          setConvId(created.id);
          const newConvo: Conversation = { id: created.id, title: text.slice(0, 80), createdAt: new Date().toISOString() };
          setConversations(prev => [newConvo, ...prev]);
        }
      }

      if (activeConvId) {
        await saveMessage(activeConvId, { role: 'user', text });
      }

      if (data.type === 'info') {
        setMessages(prev => prev.map(m =>
          m.id === loadingId ? { id: loadingId, role: 'assistant', text: data.text } : m
        ));
        if (activeConvId) {
          await saveMessage(activeConvId, { role: 'assistant', text: data.text });
        }
      } else if (data.type === 'question') {
        setPendingContext({ originalTopic: text, question: data.text });
        setMessages(prev => prev.map(m =>
          m.id === loadingId ? { id: loadingId, role: 'assistant', text: data.text, isQuestion: true } : m
        ));
        if (activeConvId) {
          await saveMessage(activeConvId, { role: 'assistant', text: data.text, isQuestion: true });
        }
      } else {
        const twitter = data.twitter ?? '';
        const linkedin = data.linkedin ?? '';
        setMessages(prev => prev.map(m =>
          m.id === loadingId ? { id: loadingId, role: 'assistant', posts: { twitter, linkedin } } : m
        ));
        if (activeConvId) {
          await saveMessage(activeConvId, { role: 'assistant', posts: { twitter, linkedin } });
        }
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === loadingId ? { ...m, loading: false, text: 'Something went wrong. Try again.' } : m
      ));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function handleSaveToBoard(msgId: string) {
    const msg = messages.find(m => m.id === msgId);
    if (!msg?.posts) return;

    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, saved: true } : m));

    try {
      await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: msg.posts.twitter,
          linkedinContent: msg.posts.linkedin || undefined,
          platform: msg.posts.linkedin ? 'both' : 'twitter',
          status: 'drafts',
        }),
      });
    } catch {
      // Revert saved state if the request failed
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, saved: false } : m));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }

  const isEmpty = messages.length === 0 && !loadingConv;

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 border-r border-border flex flex-col bg-sidebar">
        <div className="px-3 py-3 border-b border-border">
          <button
            onClick={startNewChat}
            className="w-full flex items-center justify-center gap-2 text-xs font-medium px-3 py-2 rounded-md bg-foreground text-background hover:opacity-90 transition-opacity"
          >
            <Plus size={12} /> New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {conversations.length === 0 && (
            <p className="text-[11px] text-muted-foreground px-2 py-2">No chats yet</p>
          )}
          {conversations.map(c => (
            <button
              key={c.id}
              onClick={() => loadConversation(c.id)}
              className={`w-full text-left px-2 py-2 rounded-md transition-colors group ${
                convId === c.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              }`}
            >
              <div className="flex items-start gap-1.5">
                <MessageSquare size={11} className="shrink-0 mt-0.5 opacity-50" />
                <span className="text-[11px] leading-snug line-clamp-2">{c.title}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 pl-3.5">
                {new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            </button>
          ))}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-6 py-4 border-b border-border shrink-0">
          <h1 className="text-sm font-semibold">
            {convId
              ? (conversations.find(c => c.id === convId)?.title ?? 'Chat')
              : 'New chat'}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Describe an idea, paste a link, or share a draft. Get X and LinkedIn posts back.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {loadingConv && (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={18} className="animate-spin text-muted-foreground" />
            </div>
          )}

          {isEmpty && (
            <div className="flex flex-col items-center justify-center h-full text-center pb-16">
              <p className="text-sm font-medium text-foreground mb-2">Start with anything</p>
              <p className="text-xs text-muted-foreground mb-6 max-w-sm leading-relaxed">
                Paste a YouTube video, Reddit thread, tweet, article link, or just describe what you want to write about.
              </p>
              <div className="space-y-2 w-full max-w-sm">
                {starters.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => { setInput(ex); inputRef.current?.focus(); }}
                    className="w-full text-left text-xs text-muted-foreground border border-border rounded-lg px-3 py-2.5 hover:border-muted-foreground/40 hover:text-foreground transition-colors leading-relaxed"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!loadingConv && messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} onSave={handleSaveToBoard} profile={profile} />
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0">
          {pendingContext && (
            <p className="text-[11px] text-muted-foreground mb-2 px-1">
              Replying to a question about your original message
            </p>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={pendingContext ? 'Answer the question above...' : 'Describe an idea, paste a link, or share a draft...'}
              rows={1}
              className="flex-1 text-sm text-foreground bg-card border border-border rounded-xl px-4 py-2.5 leading-snug resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground overflow-y-auto"
              style={{ height: 40, minHeight: 40, maxHeight: 200 }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="w-10 h-10 rounded-xl bg-foreground text-background flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 text-center"><ModKey /> to send</p>
        </div>
      </div>
    </div>
  );
}

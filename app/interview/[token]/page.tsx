'use client';

import { Suspense, useState, useEffect, useRef, useCallback, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { ttsPrefetchCache } from '@/lib/tts-prefetch-cache';
import { Loader2, CheckCircle, Mic, MicOff, VolumeX, Volume2, PhoneOff, PhoneCall, ArrowRight, Sparkles, RotateCcw } from 'lucide-react';
import { LoreLogo } from '@/components/layout/logo';
import { ModKey } from '@/components/ui/mod-key';

interface SessionData {
  sessionId: string;
  status: string;
  guestName: string | null;
  isOwner: boolean;
  currentQuestion: { question: string; category: string } | null;
  currentIndex: number;
  totalQuestions: number;
  answeredCount: number;
  isComplete: boolean;
  isPaused: boolean;
  completedAt: string | null;
  synthesisStatus: string | null;
  questionsQueue: string[];
}

type RecordingState = 'idle' | 'recording' | 'transcribing';

function useTTS(enabled: boolean, sessionToken: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const prefetch = useCallback(async (text: string) => {
    if (!enabled || !sessionToken || !text || ttsPrefetchCache.has(text)) return;
    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sessionToken }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      ttsPrefetchCache.set(text, URL.createObjectURL(blob));
    } catch {}
  }, [enabled, sessionToken]);

  const speak = useCallback(async (text: string) => {
    if (!enabled || !sessionToken) return;
    // Cancel any in-flight TTS fetch so stale audio never plays after question advances
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeaking(true);
    try {
      let url = ttsPrefetchCache.get(text);
      if (url) {
        ttsPrefetchCache.delete(text);
      } else {
        const controller = new AbortController();
        abortRef.current = controller;
        const res = await fetch('/api/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, sessionToken }),
          signal: controller.signal,
        });
        abortRef.current = null;
        if (!res.ok) { setSpeaking(false); return; }
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url!); };
      audio.onerror = () => setSpeaking(false);
      await audio.play();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setSpeaking(false);
    }
  }, [enabled, sessionToken]);

  const stop = useCallback(() => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    if (audioRef.current) { audioRef.current.pause(); }
    setSpeaking(false);
  }, []);

  return { speak, stop, speaking, prefetch };
}

const MAX_RECORDING_MS = 20 * 60 * 1000;
const WARN_AT_SECS = [3 * 60, 5 * 60, 10 * 60, 15 * 60, 18 * 60];

function formatSecs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function useSTT(sessionToken: string) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingSecs, setRecordingSecs] = useState(0);
  const [recordingWarning, setRecordingWarning] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warnedAt = useRef<Set<number>>(new Set());

  const stopRecorder = useCallback(() => {
    if (autoStopTimerRef.current) { clearTimeout(autoStopTimerRef.current); autoStopTimerRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setRecordingSecs(0);
    setRecordingWarning(null);
    warnedAt.current.clear();
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorderRef.current = recorder;
      recorder.start(200);
      setRecordingState('recording');
      setRecordingSecs(0);
      warnedAt.current.clear();

      tickRef.current = setInterval(() => {
        setRecordingSecs(s => {
          const next = s + 1;
          for (const mark of WARN_AT_SECS) {
            if (next === mark && !warnedAt.current.has(mark)) {
              warnedAt.current.add(mark);
              if (mark >= 18 * 60) setRecordingWarning('2 minutes left before auto-stop.');
              else if (mark >= 15 * 60) setRecordingWarning('Still recording. 5 minutes left.');
              else if (mark >= 10 * 60) setRecordingWarning('10 minutes in. Take your time.');
              else if (mark >= 5 * 60) setRecordingWarning('5 minutes in. Still with you.');
              else setRecordingWarning('3 minutes in. Take all the time you need.');
              setTimeout(() => setRecordingWarning(null), 5000);
            }
          }
          return next;
        });
      }, 1000);

      autoStopTimerRef.current = setTimeout(() => {
        setRecordingWarning('20-minute limit reached. Stopping now.');
        recorder.stop();
      }, MAX_RECORDING_MS);
    } catch { /* mic denied */ }
  }, []);

  const stopAndTranscribe = useCallback(async (): Promise<string> => {
    return new Promise(resolve => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) { resolve(''); return; }
      stopRecorder();
      recorder.onstop = async () => {
        setRecordingState('transcribing');
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        recorder.stream.getTracks().forEach(t => t.stop());
        try {
          const form = new FormData();
          form.append('audio', blob, 'recording.webm');
          const res = await fetch('/api/voice/stt', {
            method: 'POST',
            headers: { 'x-session-token': sessionToken },
            body: form,
          });
          const data = await res.json() as { transcript?: string };
          resolve(data.transcript ?? '');
        } catch { resolve(''); }
        finally { setRecordingState('idle'); }
      };
      if (recorder.state !== 'inactive') recorder.stop();
      else resolve('');
    });
  }, [sessionToken, stopRecorder]);

  return { recordingState, recordingSecs, recordingWarning, startRecording, stopAndTranscribe };
}

function Waveform({ active }: { active: boolean }) {
  return (
    <div className={`flex items-end gap-[3px] h-5 transition-opacity duration-300 ${active ? 'opacity-100' : 'opacity-0'}`}>
      {[0.5, 0.9, 0.7, 1, 0.6, 0.9, 0.5, 0.8, 0.7, 0.4].map((h, i) => (
        <div
          key={i}
          className="w-[2.5px] rounded-full bg-white/60"
          style={{
            height: `${h * 100}%`,
            animation: active ? `waveBar 1s ease-in-out ${i * 0.07}s infinite alternate` : 'none',
          }}
        />
      ))}
    </div>
  );
}


function CategoryLabel({ category }: { category: string }) {
  const labels: Record<string, string> = {
    background: 'Background',
    behind_scenes: 'Behind the scenes',
    contrarian: 'Hot takes',
    philosophy: 'Philosophy',
    future: 'Vision',
    tactical: 'Tactical',
    foundation: 'Foundation',
  };
  const label = labels[category] ?? category.replace(/_/g, ' ');
  return (
    <span className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">
      {label}
    </span>
  );
}

function InterviewPageInner({ token }: { token: string }) {
  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get('onboarding') === 'true';
  const isOwner = isOnboarding || searchParams.get('owner') === 'true';

  const [session, setSession] = useState<SessionData | null>(null);
  const [answer, setAnswer] = useState('');
  const [guestName, setGuestName] = useState('');
  const [nameSubmitted, setNameSubmitted] = useState(isOwner);
  const [showGreeting, setShowGreeting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which question text has already been replayed, caps replays at 1/question
  const [replayedKey, setReplayedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [realAnsweredCount, setRealAnsweredCount] = useState(0);
  const [autoSubmitSecs, setAutoSubmitSecs] = useState<number | null>(null);
  const [skipsUsed, setSkipsUsed] = useState(0);
  const MAX_SKIPS = 3;
  const [questionsQueue, setQuestionsQueue] = useState<string[]>([]);
  const [synthesisStatus, setSynthesisStatus] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSubmitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { speak, stop: stopTTS, speaking, prefetch } = useTTS(voiceEnabled && ttsAvailable, token);
  const { recordingState, recordingSecs, recordingWarning, startRecording, stopAndTranscribe } = useSTT(token);

  useEffect(() => {
    fetch('/api/voice/tts/available')
      .then(r => { if (r.ok) setTtsAvailable(true); })
      .catch(() => {});
  }, []);

  async function loadSession() {
    try {
      const res = await fetch(`/api/interviews/${token}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setError(d.error ?? 'Interview not found.');
        return;
      }
      const data = await res.json() as SessionData;
      setSession(data);
      setQuestionsQueue(data.questionsQueue ?? []);
      setSynthesisStatus(data.synthesisStatus ?? null);
      if (data.isPaused) setPaused(true);
      if (data.isOwner) setNameSubmitted(true);
      else if (data.guestName) { setGuestName(data.guestName); setNameSubmitted(true); }
      // Show greeting only on fresh start (not resuming)
      if (!data.isPaused && !data.isComplete && data.currentIndex === 0) {
        setShowGreeting(true);
      }
    } catch { setError('Could not load interview.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { Promise.resolve().then(() => loadSession()); }, []);

  // Poll synthesisStatus every 3s while the interview is complete but synthesis is still pending.
  // Stops automatically once status reaches 'completed' or 'failed'.
  useEffect(() => {
    if (!session?.isComplete || synthesisStatus === 'completed' || synthesisStatus === 'failed') return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/interviews/${token}`);
        if (!res.ok) return;
        const data = await res.json() as SessionData;
        const s = data.synthesisStatus ?? null;
        setSynthesisStatus(s);
        if (s === 'completed' || s === 'failed') clearInterval(id);
      } catch { /* silent */ }
    }, 3000);
    return () => clearInterval(id);
  }, [session?.isComplete, synthesisStatus, token]);

  // Pre-fetch audio one question ahead at all times.
  // Current question: fetched immediately when TTS is ready (covers Q1 during greeting/name gate).
  // Next question: fetched whenever currentIndex advances, so it's cached before it's ever needed.
  useEffect(() => {
    if (!ttsAvailable || !voiceEnabled || session?.isComplete) return;
    const currentText = session?.currentQuestion?.question;
    const nextText = questionsQueue[(session?.currentIndex ?? 0) + 1];
    if (currentText) prefetch(currentText);
    if (nextText) prefetch(nextText);
  }, [ttsAvailable, voiceEnabled, session?.currentQuestion?.question, session?.currentIndex, questionsQueue]);

  // Speak question only after greeting is dismissed
  useEffect(() => {
    if (session?.currentQuestion?.question && nameSubmitted && !showGreeting && !session.isComplete && !paused) {
      speak(session.currentQuestion.question);
    }
    return () => stopTTS();
  }, [session?.currentQuestion?.question, nameSubmitted, showGreeting, paused, ttsAvailable]);

  function cancelAutoSubmit() {
    if (autoSubmitRef.current) clearTimeout(autoSubmitRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    autoSubmitRef.current = null;
    countdownRef.current = null;
    setAutoSubmitSecs(null);
  }

  async function handlePause() {
    if (pausing) return;
    setPausing(true);
    cancelAutoSubmit();
    stopTTS();
    try {
      await fetch(`/api/interviews/${token}/pause`, { method: 'POST' });
      setPaused(true);
    } finally { setPausing(false); }
  }

  function handleResume() {
    setPaused(false);
    // speak effect re-runs automatically when paused flips to false
  }

  async function handleRecord() {
    if (recordingState === 'recording') {
      stopTTS();
      const transcript = await stopAndTranscribe();
      if (transcript) {
        const fullAnswer = answer ? `${answer} ${transcript}` : transcript;
        setAnswer(fullAnswer);
        // Auto-submit after 2s, user can cancel
        setAutoSubmitSecs(2);
        countdownRef.current = setInterval(() => {
          setAutoSubmitSecs(s => {
            if (s === null || s <= 1) { clearInterval(countdownRef.current!); countdownRef.current = null; return null; }
            return s - 1;
          });
        }, 1000);
        autoSubmitRef.current = setTimeout(() => {
          setAutoSubmitSecs(null);
          submitWithText(fullAnswer);
        }, 2000);
      }
    } else if (recordingState === 'idle') {
      cancelAutoSubmit();
      stopTTS();
      await startRecording();
    }
  }

  async function submitWithText(text: string) {
    cancelAutoSubmit();
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setProcessing(true);
    setError(null);
    stopTTS();

    try {
      const res = await fetch(`/api/interviews/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: trimmed, guestName: guestName || undefined }),
      });
      const data = await res.json() as {
        nextQuestion?: { question: string; category: string; isFollowUp?: boolean };
        currentIndex?: number;
        totalQuestions?: number;
        isComplete?: boolean;
        pendingFollowUp?: string;
        error?: string;
      };
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return; }

      setAnswer('');
      setRealAnsweredCount(c => c + 1);

      // Pre-fetch the deferred follow-up audio immediately while the user answers the next main question
      if (data.pendingFollowUp) {
        prefetch(data.pendingFollowUp);
        setQuestionsQueue(prev => {
          const updated = [...prev];
          updated.splice((data.currentIndex ?? 0) + 1, 0, data.pendingFollowUp!);
          return updated;
        });
      }

      if (data.isComplete) {
        setFollowUp(null);
        setSynthesisStatus('pending');
        setSession(prev => prev ? { ...prev, isComplete: true, status: 'completed', synthesisStatus: 'pending' } : prev);
      } else if (data.nextQuestion) {
        prefetch(data.nextQuestion.question);
        setFollowUp(data.nextQuestion.isFollowUp ? data.nextQuestion.question : null);
        setSession(prev => prev ? {
          ...prev,
          currentQuestion: data.nextQuestion!,
          currentIndex: data.currentIndex ?? prev.currentIndex,
          totalQuestions: data.totalQuestions ?? prev.totalQuestions,
          answeredCount: (prev.answeredCount ?? 0) + 1,
        } : prev);
      }
    } catch { setError('Could not submit answer. Try again.'); }
    finally { setSubmitting(false); setProcessing(false); }
  }

  async function submitAnswer() {
    submitWithText(answer);
  }

  async function handleSkip() {
    if (skipping || submitting || skipsUsed >= MAX_SKIPS) return;
    setSkipping(true);
    cancelAutoSubmit();
    setAnswer('');
    setError(null);
    stopTTS();
    try {
      const res = await fetch(`/api/interviews/${token}/skip`, { method: 'POST' });
      const data = await res.json() as {
        nextQuestion?: { question: string; category: string };
        currentIndex?: number;
        totalQuestions?: number;
        isComplete?: boolean;
        skipsUsed?: number;
        maxSkips?: number;
        error?: string;
        type?: string;
      };
      if (!res.ok) {
        if (data.type === 'skip_limit') setSkipsUsed(MAX_SKIPS);
        else setError(data.error ?? 'Could not skip.');
        return;
      }
      if (typeof data.skipsUsed === 'number') setSkipsUsed(data.skipsUsed);
      if (data.isComplete) {
        setSession(prev => prev ? { ...prev, isComplete: true } : prev);
      } else if (data.nextQuestion) {
        setSession(prev => prev ? {
          ...prev,
          currentQuestion: data.nextQuestion!,
          currentIndex: data.currentIndex ?? prev.currentIndex,
          totalQuestions: data.totalQuestions ?? prev.totalQuestions,
        } : prev);
      }
    } catch { setError('Could not skip. Try again.'); }
    finally { setSkipping(false); }
  }

  async function handleFinishEarly() {
    if (completing) return;
    setCompleting(true);
    cancelAutoSubmit();
    stopTTS();
    try {
      await fetch(`/api/interviews/${token}/complete`, { method: 'POST' });
      setSynthesisStatus('pending');
      setSession(prev => prev ? { ...prev, isComplete: true, synthesisStatus: 'pending' } : prev);
    } catch { setError('Could not finish. Try again.'); }
    finally { setCompleting(false); }
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-white/20" />
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <p className="text-sm text-white/40 text-center max-w-sm">{error}</p>
      </div>
    );
  }

  if (!session) return null;

  // ── Greeting ─────────────────────────────────────────────────────────────────
  if (nameSubmitted && showGreeting && session && !session.isComplete && !paused) {
    const displayName = guestName || (session.guestName ?? '');
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <LoreLogo white />
          <h2 className="text-white text-xl font-semibold mt-10 mb-3">
            {displayName ? `Hey ${displayName}!` : 'Ready when you are.'}
          </h2>
          <p className="text-white/35 text-sm leading-relaxed mb-10">
            I&apos;ll ask you {session.totalQuestions} questions about your work. Answer by speaking or typing. You can skip up to 3 questions. I&apos;ll add a replacement for each one.
          </p>
          <button
            onClick={() => setShowGreeting(false)}
            className="w-full py-3 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 transition-opacity flex items-center justify-center gap-2"
          >
            Let&apos;s start <ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  // ── Name gate ────────────────────────────────────────────────────────────────
  if (!nameSubmitted) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="w-full max-w-xs text-center">
          <LoreLogo white />
          <p className="text-white/30 text-sm mt-6 mb-2">What&apos;s your name?</p>
          <input
            autoFocus
            type="text"
            value={guestName}
            onChange={e => setGuestName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && guestName.trim()) setNameSubmitted(true); }}
            placeholder="Your name"
            className="w-full px-4 py-2.5 rounded-xl bg-white/6 border border-white/8 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/20 mb-3 text-center"
          />
          <button
            onClick={() => { if (guestName.trim()) setNameSubmitted(true); }}
            disabled={!guestName.trim()}
            className="w-full py-2.5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 disabled:opacity-20 transition-opacity flex items-center justify-center gap-2"
          >
            <PhoneCall size={14} />
            Start
          </button>
        </div>
      </div>
    );
  }

  // ── Complete ─────────────────────────────────────────────────────────────────
  if (session.isComplete) {
    const synthDone = synthesisStatus === 'completed';
    const synthFailed = synthesisStatus === 'failed';
    const synthPending = !synthDone && !synthFailed;

    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 ${
            synthFailed
              ? 'bg-red-500/10 border border-red-500/20'
              : 'bg-emerald-500/10 border border-emerald-500/20'
          }`}>
            {synthPending
              ? <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
              : synthFailed
              ? <CheckCircle className="w-6 h-6 text-white/30" />
              : <CheckCircle className="w-6 h-6 text-emerald-400" />
            }
          </div>
          <h1 className="text-white text-base font-semibold mb-2">
            {isOnboarding
              ? synthDone
                ? 'Your voice profile is built'
                : synthFailed
                ? 'Interview saved'
                : 'Building your voice profile...'
              : 'Interview complete'
            }
          </h1>
          <p className="text-white/30 text-sm leading-relaxed mb-6">
            {isOnboarding
              ? synthDone
                ? 'Lore extracted your stories and patterns from this conversation. Every post it writes will sound like you.'
                : synthFailed
                ? 'Something went wrong extracting ideas. We\'ll retry automatically. Your answers are saved.'
                : 'Extracting ideas... this may take a moment.'
              : `Thanks${guestName ? `, ${guestName}` : ''}. Your answers have been saved.`
            }
          </p>
          {isOnboarding && synthDone && (
            <a
              href="/board"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black text-sm font-semibold rounded-xl hover:bg-white/90 transition-opacity"
            >
              Go to your board <ArrowRight size={14} />
            </a>
          )}
          {isOnboarding && synthPending && (
            <p className="text-white/15 text-xs">You can close this tab. Ideas will appear on your board when ready.</p>
          )}
        </div>
      </div>
    );
  }

  // ── Paused ───────────────────────────────────────────────────────────────────
  if (paused) {
    const answeredSoFar = session.answeredCount ?? 0;
    const remaining = session.totalQuestions - session.currentIndex;
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <LoreLogo white />
          <p className="text-white/30 text-sm mt-6 mb-1">
            {answeredSoFar > 0
              ? `${answeredSoFar} answer${answeredSoFar !== 1 ? 's' : ''} saved.`
              : 'Nothing recorded yet.'
            }
          </p>
          {remaining > 0 && (
            <p className="text-white/20 text-xs mb-6">
              {remaining} question{remaining !== 1 ? 's' : ''} left when you come back.
            </p>
          )}
          <button
            onClick={handleResume}
            className="w-full py-2.5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 transition-opacity flex items-center justify-center gap-2"
          >
            <PhoneCall size={14} /> Resume
          </button>
        </div>
      </div>
    );
  }

  const progress = session.totalQuestions > 0
    ? ((session.currentIndex) / session.totalQuestions) * 100
    : 0;

  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length;
  const isRecording = recordingState === 'recording';
  const isTranscribing = recordingState === 'transcribing';

  // Live status line
  const statusLabel = processing
    ? 'Processing...'
    : isTranscribing
    ? 'Transcribing...'
    : isRecording
    ? 'Listening...'
    : speaking
    ? 'Speaking...'
    : 'Waiting for your answer';

  return (
    <>
      <style>{`
        @keyframes waveBar {
          from { transform: scaleY(0.25); }
          to   { transform: scaleY(1); }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .question-enter { animation: fadeSlideIn 0.35s ease forwards; }
      `}</style>

      <div className="min-h-screen bg-black flex flex-col">

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {Array.from({ length: session.totalQuestions }).map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-500 ${
                  i < session.currentIndex
                    ? 'w-2 h-2 bg-white/30'
                    : i === session.currentIndex
                    ? 'w-2.5 h-2.5 bg-white'
                    : 'w-2 h-2 bg-white/10'
                }`}
              />
            ))}
          </div>
          <span className="text-white/25 text-xs tabular-nums font-mono">
            {session.currentIndex + 1} / {session.totalQuestions}
          </span>
        </div>

        {/* ── AI section ──────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-2 gap-5">

          {/* Logo + waveform */}
          <div className="flex flex-col items-center gap-3">
            <div className={`transition-all duration-300 ${speaking ? 'opacity-100' : 'opacity-70'}`}>
              <LoreLogo white />
            </div>
            <div className="h-5 flex items-center">
              <Waveform active={speaking} />
            </div>
          </div>

          {/* Status */}
          <p className={`text-xs font-medium tracking-wide transition-all duration-300 ${
            isRecording ? 'text-red-400' :
            processing || isTranscribing ? 'text-white/40' :
            speaking ? 'text-white/50' :
            'text-white/20'
          }`}>
            {statusLabel}
          </p>

          {/* Question */}
          <div className="max-w-md w-full">
            {session.currentQuestion?.category && (
              <div className="flex items-center justify-center mb-3">
                {followUp ? (
                  <span className="text-[10px] font-semibold text-amber-400/60 bg-amber-400/8 px-2.5 py-1 rounded-full tracking-wider uppercase">
                    Follow-up
                  </span>
                ) : (
                  <CategoryLabel category={session.currentQuestion.category} />
                )}
              </div>
            )}
            <div className="question-enter text-center" key={session.currentQuestion?.question}>
              <p className="text-white text-xl font-semibold leading-snug">
                {session.currentQuestion?.question}
              </p>
            </div>
          </div>

          {/* Processing flash */}
          {processing && (
            <div className="flex items-center gap-2 text-white/20">
              <Sparkles size={12} className="animate-pulse" />
              <span className="text-xs">Extracting insights...</span>
            </div>
          )}
        </div>

        {/* ── Answer area ──────────────────────────────────────────────────── */}
        <div className="max-w-lg w-full mx-auto px-5 pb-3">
          <div className={`rounded-2xl transition-all ${
            answer ? 'bg-white/5 border border-white/8' : 'border border-transparent'
          } ${isRecording ? 'ring-1 ring-red-500/30' : ''}`}>
            <textarea
              ref={textareaRef}
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitAnswer(); }}
              placeholder={isRecording ? '' : 'Tap the mic to speak, or type your answer...'}
              rows={3}
              disabled={isTranscribing || submitting}
              className="w-full px-4 py-3 bg-transparent text-white text-sm placeholder:text-white/15 focus:outline-none resize-none leading-relaxed rounded-2xl"
            />
            {answer && (
              <div className="px-4 pb-3 flex justify-between items-center">
                <span className="text-white/20 text-[11px]">{wordCount} words</span>
                <span className="text-white/15 text-[11px]"><ModKey /> to send</span>
              </div>
            )}
          </div>

          {isRecording && (
            <div className="flex items-center justify-between mt-2 px-1">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-400/70 text-xs tabular-nums font-mono">
                  {formatSecs(recordingSecs)} / 20:00
                </span>
              </div>
              {recordingWarning && (
                <span className="text-white/30 text-[11px]">{recordingWarning}</span>
              )}
            </div>
          )}

          {isTranscribing && (
            <div className="flex items-center gap-2 mt-2 px-1">
              <Loader2 size={10} className="animate-spin text-white/25" />
              <span className="text-white/25 text-xs">Transcribing...</span>
            </div>
          )}

          {error && <p className="mt-2 px-1 text-xs text-red-400/80">{error}</p>}
        </div>

        {/* ── Auto-submit countdown ──────────────────────────────────────────── */}
        {autoSubmitSecs !== null && (
          <div className="flex items-center justify-center gap-3 pb-2">
            <span className="text-white/30 text-xs">Sending in {autoSubmitSecs}s</span>
            <button
              onClick={cancelAutoSubmit}
              className="text-white/40 text-xs hover:text-white/70 transition-colors underline underline-offset-2"
            >
              cancel
            </button>
          </div>
        )}

        {/* ── Bottom toolbar ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-4 px-5 py-5 shrink-0">

          {/* Speaker toggle */}
          {ttsAvailable && (
            <button
              onClick={() => { setVoiceEnabled(v => !v); stopTTS(); }}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                voiceEnabled ? 'bg-white/8 text-white/70 hover:bg-white/12' : 'bg-white/4 text-white/20 hover:bg-white/8'
              }`}
              title={voiceEnabled ? 'Mute AI voice' : 'Unmute AI voice'}
            >
              {voiceEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
          )}

          {/* Replay question, once per question to avoid burning TTS tokens */}
          {ttsAvailable && voiceEnabled && session.currentQuestion && (() => {
            const qKey = session.currentQuestion.question;
            const alreadyReplayed = replayedKey === qKey;
            return (
              <button
                onClick={() => {
                  if (alreadyReplayed) return;
                  setReplayedKey(qKey);
                  stopTTS();
                  speak(qKey);
                }}
                disabled={speaking || alreadyReplayed}
                className="w-11 h-11 rounded-full flex items-center justify-center transition-all bg-white/8 text-white/70 hover:bg-white/12 disabled:opacity-30 disabled:cursor-not-allowed"
                title={alreadyReplayed ? 'Already replayed this question' : 'Repeat the question (one-time)'}
              >
                <RotateCcw size={16} />
              </button>
            );
          })()}

          {/* Mic button, Google Meet style: red+MicOff when muted, green+Mic when live */}
          <button
            onClick={handleRecord}
            disabled={isTranscribing || submitting || skipping}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
              isRecording
                ? 'bg-green-500 text-white shadow-green-500/30 scale-105'
                : 'bg-red-500 text-white shadow-red-500/30 hover:bg-red-400'
            } disabled:opacity-30`}
            title={isRecording ? "You're live. Click to stop" : "Tap to speak"}
          >
            {isTranscribing ? <Loader2 size={18} className="animate-spin" /> : isRecording ? <Mic size={20} /> : <MicOff size={20} />}
          </button>

          {/* Submit / Next */}
          <button
            onClick={submitAnswer}
            disabled={!answer.trim() || submitting || isRecording || isTranscribing || skipping}
            className="w-14 h-14 rounded-full flex items-center justify-center bg-white text-black shadow-lg shadow-white/10 hover:bg-white/90 disabled:opacity-15 disabled:shadow-none transition-all"
            title="Send answer"
          >
            {submitting
              ? <Loader2 size={20} className="animate-spin text-black/50" />
              : <ArrowRight size={20} />
            }
          </button>

          {/* Skip */}
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={handleSkip}
              disabled={skipping || submitting || isRecording || isTranscribing || skipsUsed >= MAX_SKIPS}
              className="w-11 h-11 rounded-full flex items-center justify-center bg-white/6 text-white/30 hover:bg-white/10 hover:text-white/60 transition-all disabled:opacity-20"
              title={skipsUsed >= MAX_SKIPS ? 'Skip limit reached' : 'Skip this question'}
            >
              {skipping ? <Loader2 size={15} className="animate-spin" /> : <span className="text-xs font-medium">Skip</span>}
            </button>
            <span className={`text-[10px] tabular-nums font-mono transition-colors ${
              skipsUsed >= MAX_SKIPS ? 'text-red-400/60' : skipsUsed > 0 ? 'text-white/30' : 'text-white/15'
            }`}>
              {skipsUsed}/{MAX_SKIPS}
            </span>
          </div>

          {/* Finish early (after 5+ real answers) or end/pause */}
          {realAnsweredCount >= 5 ? (
            <button
              onClick={handleFinishEarly}
              disabled={completing}
              className="w-11 h-11 rounded-full flex items-center justify-center bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-all disabled:opacity-30"
              title="Finish interview"
            >
              {completing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={17} />}
            </button>
          ) : (
            <button
              onClick={handlePause}
              disabled={pausing}
              className="w-11 h-11 rounded-full flex items-center justify-center bg-white/8 text-white/40 hover:bg-red-500/20 hover:text-red-400 transition-all disabled:opacity-30"
              title="Pause interview"
            >
              {pausing ? <Loader2 size={17} className="animate-spin" /> : <PhoneOff size={17} />}
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/4">
          <div
            className="h-full bg-white/30 transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </>
  );
}

export default function InterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-white/20" />
      </div>
    }>
      <InterviewPageInner token={token} />
    </Suspense>
  );
}

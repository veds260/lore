'use client';

import { Suspense, useState, useEffect, useRef, useCallback, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { ttsPrefetchCache } from '@/lib/tts-prefetch-cache';
import { Loader2, CheckCircle, Mic, VolumeX, Volume2, PhoneOff, PhoneCall, ArrowRight, RotateCcw } from 'lucide-react';
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
  // Live microphone loudness, 0 to 1, so the page can move with the speaker's voice.
  const [level, setLevel] = useState(0);
  const meterRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);

  const stopMeter = useCallback(() => {
    if (meterRef.current) {
      cancelAnimationFrame(meterRef.current.raf);
      meterRef.current.ctx.close().catch(() => {});
      meterRef.current = null;
    }
    setLevel(0);
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        const next = Math.min(1, Math.sqrt(sum / buf.length) * 5);
        if (Math.abs(next - last) > 0.03) { last = next; setLevel(next); }
        if (meterRef.current) meterRef.current.raf = requestAnimationFrame(tick);
      };
      meterRef.current = { ctx, raf: requestAnimationFrame(tick) };
    } catch { /* metering is decoration, recording still works without it */ }
  }, []);

  const stopRecorder = useCallback(() => {
    stopMeter();
    if (autoStopTimerRef.current) { clearTimeout(autoStopTimerRef.current); autoStopTimerRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setRecordingSecs(0);
    setRecordingWarning(null);
    warnedAt.current.clear();
  }, [stopMeter]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorderRef.current = recorder;
      recorder.start(200);
      startMeter(stream);
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
  }, [startMeter]);

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

  return { recordingState, recordingSecs, recordingWarning, level, startRecording, stopAndTranscribe };
}

type OrbMode = 'idle' | 'speaking' | 'listening' | 'thinking' | 'done';

const ORB: Record<OrbMode, { core: string; ring: string; label: string }> = {
  idle:      { core: '#FF5A1F', ring: '#FFB38F', label: 'your turn, tap the mic' },
  speaking:  { core: '#FF5A1F', ring: '#FFB38F', label: 'lore is asking' },
  listening: { core: '#16A34A', ring: '#86EFAC', label: 'listening to you' },
  thinking:  { core: '#7C3AED', ring: '#C4B5FD', label: 'turning that into ideas' },
  done:      { core: '#16A34A', ring: '#86EFAC', label: 'all done' },
};

// The interviewer, drawn as a warm orb. Ripples while it talks, swells with the
// user's own voice while they answer, spins while it thinks.
function Orb({ mode, level = 0, size = 132 }: { mode: OrbMode; level?: number; size?: number }) {
  const o = ORB[mode];
  const swell = mode === 'listening' ? 1 + level * 0.35 : 1;
  return (
    <div className="relative grid place-items-center" style={{ width: size * 1.9, height: size * 1.9 }} aria-hidden>
      {(mode === 'speaking' || mode === 'idle' || mode === 'listening') && [0, 1, 2].map(i => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            width: size, height: size, backgroundColor: o.ring,
            animation: `orbRipple ${mode === 'idle' ? 3.2 : 1.8}s ease-out ${i * (mode === 'idle' ? 1.05 : 0.6)}s infinite`,
          }}
        />
      ))}
      {mode === 'listening' && (
        <>
          <span className="absolute rounded-full transition-transform duration-100" style={{ width: size, height: size, backgroundColor: o.ring, opacity: 0.45, transform: `scale(${1 + level * 0.8})` }} />
          <span className="absolute rounded-full transition-transform duration-100" style={{ width: size, height: size, backgroundColor: o.ring, opacity: 0.7, transform: `scale(${1 + level * 0.45})` }} />
        </>
      )}
      {mode === 'thinking' && (
        <span className="absolute rounded-full border-[6px] border-dashed" style={{ width: size * 1.28, height: size * 1.28, borderColor: o.ring, animation: 'orbSpin 3s linear infinite' }} />
      )}
      <span
        className="relative grid place-items-center rounded-full text-white shadow-[0_18px_40px_-12px_rgba(0,0,0,0.35)] transition-[transform,background-color] duration-150"
        style={{ width: size, height: size, backgroundColor: o.core, transform: `scale(${swell})`, animation: mode === 'idle' ? 'orbBreathe 3.2s ease-in-out infinite' : undefined }}
      >
        {mode === 'listening' ? (
          <span className="flex h-12 items-center gap-[6px]">
            {[0.55, 0.9, 1, 0.8, 0.5].map((h, i) => (
              <span
                key={i}
                className="w-[7px] rounded-full bg-white transition-[height] duration-100"
                style={{ height: `${Math.min(100, (0.45 + level * 0.9) * h * 100)}%`, animation: `orbBar 0.9s ease-in-out ${i * 0.12}s infinite alternate` }}
              />
            ))}
          </span>
        ) : mode === 'done' ? (
          <CheckCircle size={size * 0.38} strokeWidth={2.4} />
        ) : (
          <span className="font-bold tracking-tight" style={{ fontSize: size * 0.3 }}>lore<span className="opacity-60">.</span></span>
        )}
      </span>
    </div>
  );
}

const CATEGORY: Record<string, { label: string; emoji: string; bg: string; ink: string }> = {
  background:    { label: 'Your story',        emoji: '🧭', bg: '#FFF1DE', ink: '#B45309' },
  behind_scenes: { label: 'Behind the scenes', emoji: '🎬', bg: '#E3F2FF', ink: '#0369A1' },
  contrarian:    { label: 'Hot take',          emoji: '🌶️', bg: '#FFE8EC', ink: '#BE123C' },
  philosophy:    { label: 'How you think',     emoji: '🧠', bg: '#EFE9FF', ink: '#6D28D9' },
  future:        { label: 'What is next',      emoji: '🔭', bg: '#E3F8EC', ink: '#047857' },
  tactical:      { label: 'How you do it',     emoji: '🛠️', bg: '#E8EEFF', ink: '#1D4ED8' },
  foundation:    { label: 'The basics',        emoji: '🏗️', bg: '#FFF6CC', ink: '#A16207' },
};

function CategoryLabel({ category, followUp }: { category: string; followUp?: boolean }) {
  const c = followUp
    ? { label: 'Follow-up', emoji: '👀', bg: '#FFF6CC', ink: '#A16207' }
    : CATEGORY[category] ?? { label: category.replace(/_/g, ' '), emoji: '✨', bg: '#FFF1DE', ink: '#B45309' };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold capitalize" style={{ backgroundColor: c.bg, color: c.ink }}>
      <span aria-hidden>{c.emoji}</span>
      {c.label}
    </span>
  );
}

const PAGE = 'min-h-screen bg-[#FFF8F1] text-[#1F1A17]';
const PRIMARY_BTN = 'inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF5A1F] py-3.5 text-[15px] font-semibold text-white shadow-[0_12px_28px_-12px_rgba(255,90,31,0.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0';

const KEYFRAMES = `
  @keyframes orbRipple { from { transform: scale(1); opacity: 0.55; } to { transform: scale(1.9); opacity: 0; } }
  @keyframes orbBreathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
  @keyframes orbSpin { to { transform: rotate(360deg); } }
  @keyframes orbBar { from { transform: scaleY(0.45); } to { transform: scaleY(1); } }
  @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes confettiFall { from { transform: translateY(-20px) rotate(0deg); opacity: 0; } 15% { opacity: 1; } to { transform: translateY(120px) rotate(200deg); opacity: 0; } }
  .question-enter { animation: fadeSlideIn 0.4s ease forwards; }
`;

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
  const { recordingState, recordingSecs, recordingWarning, level, startRecording, stopAndTranscribe } = useSTT(token);

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
      <div className={`${PAGE} grid place-items-center`}>
        <style>{KEYFRAMES}</style>
        <Orb mode="thinking" size={72} />
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className={`${PAGE} grid place-items-center px-6`}>
        <p className="max-w-sm text-center text-[15px] text-[#6B5E57]">{error}</p>
      </div>
    );
  }

  if (!session) return null;

  // ── Greeting ─────────────────────────────────────────────────────────────────
  if (nameSubmitted && showGreeting && session && !session.isComplete && !paused) {
    const displayName = guestName || (session.guestName ?? '');
    return (
      <div className={`${PAGE} grid place-items-center px-6 py-10`}>
        <style>{KEYFRAMES}</style>
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center"><Orb mode="idle" size={110} /></div>
          <h1 className="-mt-4 text-[34px] font-semibold leading-tight tracking-tight">
            {displayName ? `hey ${displayName.split(' ')[0].toLowerCase()} 👋` : 'ready when you are 👋'}
          </h1>
          <p className="mt-3 text-[16px] leading-relaxed text-[#6B5E57]">
            a quick chat about your work. lore listens for the stories and opinions only you have, and turns them into posts
          </p>
          <div className="mt-7 grid grid-cols-3 gap-2.5">
            {[
              { emoji: '🎙️', text: `${session.totalQuestions} questions`, bg: '#FFE9DC', ink: '#C2410C' },
              { emoji: '💬', text: 'talk or type', bg: '#E3F8EC', ink: '#047857' },
              { emoji: '⏭️', text: 'skip up to 3', bg: '#EFE9FF', ink: '#6D28D9' },
            ].map(t => (
              <div key={t.text} className="rounded-2xl px-2 py-3.5" style={{ backgroundColor: t.bg }}>
                <div className="text-[22px] leading-none" aria-hidden>{t.emoji}</div>
                <div className="mt-2 text-[13px] font-semibold" style={{ color: t.ink }}>{t.text}</div>
              </div>
            ))}
          </div>
          <button onClick={() => setShowGreeting(false)} className={`mt-7 ${PRIMARY_BTN}`}>
            Let&apos;s start <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ── Name gate ────────────────────────────────────────────────────────────────
  if (!nameSubmitted) {
    return (
      <div className={`${PAGE} grid place-items-center px-6`}>
        <style>{KEYFRAMES}</style>
        <div className="w-full max-w-sm text-center">
          <div className="flex justify-center"><Orb mode="idle" size={96} /></div>
          <h1 className="-mt-2 text-[28px] font-semibold tracking-tight">what should lore call you?</h1>
          <input
            autoFocus
            type="text"
            value={guestName}
            onChange={e => setGuestName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && guestName.trim()) setNameSubmitted(true); }}
            placeholder="Your name"
            className="mt-6 w-full rounded-2xl border-0 bg-white px-4 py-3.5 text-center text-[16px] shadow-sm ring-1 ring-black/10 placeholder:text-[#B5A89F] focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]"
          />
          <button onClick={() => { if (guestName.trim()) setNameSubmitted(true); }} disabled={!guestName.trim()} className={`mt-3 ${PRIMARY_BTN}`}>
            <PhoneCall size={16} /> Start
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
    const confetti = ['#FF5A1F', '#22C55E', '#8B5CF6', '#3B82F6', '#F59E0B', '#EC4899'];

    return (
      <div className={`${PAGE} relative grid place-items-center overflow-hidden px-6`}>
        <style>{KEYFRAMES}</style>
        {!synthFailed && (
          <div className="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center gap-8" aria-hidden>
            {Array.from({ length: 14 }).map((_, i) => (
              <span
                key={i}
                className="block size-2.5 rounded-[3px]"
                style={{ backgroundColor: confetti[i % confetti.length], animation: `confettiFall ${2.2 + (i % 4) * 0.4}s ease-in ${i * 0.18}s infinite` }}
              />
            ))}
          </div>
        )}
        <div className="relative max-w-md text-center">
          <div className="flex justify-center"><Orb mode={synthPending ? 'thinking' : 'done'} size={104} /></div>
          <h1 className="-mt-3 text-[34px] font-semibold leading-tight tracking-tight">
            {synthPending ? 'that’s a wrap 🎉' : synthFailed ? 'your answers are saved' : isOnboarding ? 'your voice profile is ready' : 'interview done 🎉'}
          </h1>
          <p className="mt-3 text-[16px] leading-relaxed text-[#6B5E57]">
            {synthPending
              ? 'lore is pulling the best stories and takes out of that and turning them into post ideas'
              : synthFailed
                ? 'something went wrong pulling ideas out, it will retry on its own and nothing you said is lost'
                : isOnboarding
                  ? 'every post lore writes from here on is built on what you just said'
                  : `thanks${guestName ? `, ${guestName.split(' ')[0].toLowerCase()}` : ''}, your new ideas are waiting on the board`}
          </p>
          {(synthDone || !isOnboarding) && !synthFailed && isOwner && (
            <a href="/board" className={`mt-7 ${PRIMARY_BTN}`}>
              See your ideas <ArrowRight size={16} />
            </a>
          )}
          {isOnboarding && synthPending && (
            <p className="mt-6 text-[13px] text-[#9C8F87]">you can close this tab, the ideas land on your board when they are ready</p>
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
      <div className={`${PAGE} grid place-items-center px-6`}>
        <style>{KEYFRAMES}</style>
        <div className="w-full max-w-sm text-center">
          <div className="flex justify-center"><Orb mode="idle" size={96} /></div>
          <h1 className="-mt-2 text-[30px] font-semibold tracking-tight">taking a break ☕</h1>
          <p className="mt-2 text-[15px] text-[#6B5E57]">
            {answeredSoFar > 0 ? `${answeredSoFar} answer${answeredSoFar !== 1 ? 's' : ''} saved` : 'nothing recorded yet'}
            {remaining > 0 ? `, ${remaining} question${remaining !== 1 ? 's' : ''} left for when you are back` : ''}
          </p>
          <button onClick={handleResume} className={`mt-7 ${PRIMARY_BTN}`}>
            <PhoneCall size={16} /> Pick it back up
          </button>
        </div>
      </div>
    );
  }

  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length;
  const isRecording = recordingState === 'recording';
  const isTranscribing = recordingState === 'transcribing';

  const mode: OrbMode = processing || isTranscribing ? 'thinking' : isRecording ? 'listening' : speaking ? 'speaking' : 'idle';
  const statusLabel = isTranscribing ? 'writing down what you said' : ORB[mode].label;
  const statusColor = ORB[mode].core;

  const iconBtn = 'grid size-12 place-items-center rounded-full bg-white text-[#4A3F39] shadow-[0_4px_14px_-6px_rgba(0,0,0,0.25)] ring-1 ring-black/5 transition-transform hover:-translate-y-0.5 disabled:opacity-35 disabled:hover:translate-y-0';

  return (
    <>
      <style>{KEYFRAMES}</style>

      <div className={`${PAGE} flex flex-col`}>

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 px-6 pt-6 shrink-0">
          <LoreLogo />
          <div className="flex flex-1 items-center gap-1.5">
            {Array.from({ length: session.totalQuestions }).map((_, i) => (
              <span
                key={i}
                className="h-2 flex-1 rounded-full transition-colors duration-500"
                style={{ backgroundColor: i < session.currentIndex ? '#FF5A1F' : i === session.currentIndex ? '#FFB38F' : '#F0E4DA' }}
              />
            ))}
          </div>
          <span className="text-[13px] font-semibold tabular-nums text-[#6B5E57]">
            {Math.min(session.currentIndex + 1, session.totalQuestions)} of {session.totalQuestions}
          </span>
        </div>

        {/* ── Interviewer ─────────────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-2">
          <Orb mode={mode} level={level} />

          <p className="-mt-6 text-[14px] font-semibold transition-colors" style={{ color: statusColor }}>
            {statusLabel}
          </p>

          <div className="mt-6 w-full max-w-2xl text-center">
            {session.currentQuestion?.category && (
              <div className="mb-4 flex justify-center">
                <CategoryLabel category={session.currentQuestion.category} followUp={Boolean(followUp)} />
              </div>
            )}
            <div className="question-enter" key={session.currentQuestion?.question}>
              <p className="text-[30px] font-semibold leading-[1.2] tracking-tight sm:text-[34px]">
                {session.currentQuestion?.question}
              </p>
            </div>
          </div>
        </div>

        {/* ── Answer area ──────────────────────────────────────────────────── */}
        <div className="mx-auto w-full max-w-2xl px-6 pb-3">
          <div
            className={`rounded-3xl bg-white transition-shadow ${isRecording ? 'ring-2 ring-[#22C55E]' : 'ring-1 ring-black/[0.07]'} shadow-[0_10px_30px_-18px_rgba(0,0,0,0.3)]`}
          >
            <textarea
              ref={textareaRef}
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitAnswer(); }}
              placeholder={isRecording ? 'go on, lore is listening…' : 'tap the mic and just talk, or type here'}
              rows={3}
              disabled={isTranscribing || submitting}
              className="w-full resize-none rounded-3xl bg-transparent px-5 py-4 text-[16px] leading-relaxed placeholder:text-[#B5A89F] focus:outline-none"
            />
            {(answer || isRecording) && (
              <div className="flex items-center justify-between px-5 pb-3 text-[12px]">
                {isRecording ? (
                  <span className="flex items-center gap-2 font-semibold tabular-nums text-[#16A34A]">
                    <span className="size-2 rounded-full bg-[#22C55E] animate-pulse" />
                    {formatSecs(recordingSecs)}
                    {recordingWarning && <span className="font-normal text-[#6B5E57]">· {recordingWarning}</span>}
                  </span>
                ) : (
                  <span className="text-[#9C8F87]">{wordCount} words</span>
                )}
                {!isRecording && <span className="text-[#B5A89F]"><ModKey /> to send</span>}
              </div>
            )}
          </div>

          {autoSubmitSecs !== null && (
            <p className="mt-2.5 text-center text-[13px] text-[#6B5E57]">
              sending in {autoSubmitSecs}s ·{' '}
              <button onClick={cancelAutoSubmit} className="font-semibold text-[#FF5A1F] hover:underline">wait, let me edit</button>
            </p>
          )}
          {error && <p className="mt-2.5 text-center text-[13px] text-[#DC2626]">{error}</p>}
        </div>

        {/* ── Controls ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-3.5 px-6 pb-8 pt-3 shrink-0">
          {ttsAvailable && (
            <button onClick={() => { setVoiceEnabled(v => !v); stopTTS(); }} className={iconBtn} title={voiceEnabled ? 'Mute AI voice' : 'Unmute AI voice'}>
              {voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          )}

          {ttsAvailable && voiceEnabled && session.currentQuestion && (() => {
            const qKey = session.currentQuestion.question;
            const alreadyReplayed = replayedKey === qKey;
            return (
              <button
                onClick={() => { if (alreadyReplayed) return; setReplayedKey(qKey); stopTTS(); speak(qKey); }}
                disabled={speaking || alreadyReplayed}
                className={iconBtn}
                title={alreadyReplayed ? 'Already replayed this question' : 'Hear the question again'}
              >
                <RotateCcw size={17} />
              </button>
            );
          })()}

          <button
            onClick={handleRecord}
            disabled={isTranscribing || submitting || skipping}
            className={`grid size-[76px] place-items-center rounded-full text-white transition-transform hover:scale-105 disabled:opacity-40 ${
              isRecording ? 'bg-[#16A34A] shadow-[0_14px_30px_-10px_rgba(22,163,74,0.8)]' : 'bg-[#FF5A1F] shadow-[0_14px_30px_-10px_rgba(255,90,31,0.8)]'
            }`}
            title={isRecording ? 'Stop and send' : 'Tap to talk'}
          >
            {isTranscribing ? <Loader2 size={24} className="animate-spin" /> : isRecording ? <span className="size-6 rounded-[6px] bg-white" /> : <Mic size={28} strokeWidth={2.2} />}
          </button>

          <button
            onClick={submitAnswer}
            disabled={!answer.trim() || submitting || isRecording || isTranscribing || skipping}
            className="grid size-14 place-items-center rounded-full bg-[#1F1A17] text-white shadow-[0_10px_24px_-10px_rgba(0,0,0,0.6)] transition-transform hover:-translate-y-0.5 disabled:opacity-20 disabled:hover:translate-y-0"
            title="Send answer"
          >
            {submitting ? <Loader2 size={20} className="animate-spin" /> : <ArrowRight size={22} />}
          </button>

          <button
            onClick={handleSkip}
            disabled={skipping || submitting || isRecording || isTranscribing || skipsUsed >= MAX_SKIPS}
            className={`${iconBtn} w-auto px-4 text-[13px] font-semibold`}
            title={skipsUsed >= MAX_SKIPS ? 'Skip limit reached' : 'Skip this question'}
          >
            {skipping ? <Loader2 size={15} className="animate-spin" /> : <>skip <span className="ml-1 font-normal text-[#9C8F87]">{MAX_SKIPS - skipsUsed} left</span></>}
          </button>

          {realAnsweredCount >= 5 ? (
            <button onClick={handleFinishEarly} disabled={completing} className={`${iconBtn} text-[#16A34A]`} title="Finish interview">
              {completing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={19} />}
            </button>
          ) : (
            <button onClick={handlePause} disabled={pausing} className={iconBtn} title="Take a break">
              {pausing ? <Loader2 size={16} className="animate-spin" /> : <PhoneOff size={18} />}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default function InterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#FFF8F1] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[#FF5A1F]" />
      </div>
    }>
      <InterviewPageInner token={token} />
    </Suspense>
  );
}

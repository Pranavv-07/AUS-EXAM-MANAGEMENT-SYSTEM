import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { User } from '../types/exam.ts';

interface PostLoginSplashProps {
  user: User;
  onComplete: () => void;
}

const VIDEO_SRC = '/assets/aistudio/gemini_generated_video_e85b4aee_5d3ac3d8.mp4';
const PLAYBACK_SPEED = 2.6;
const FALLBACK_TIMEOUT_MS = 4300;

export function getTimeBasedGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'GOOD MORNING';
  if (hour < 17) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

export function PostLoginSplash({ user, onComplete }: PostLoginSplashProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const completedRef = useRef(false);
  const [fadingOut, setFadingOut] = useState(false);

  const greeting = getTimeBasedGreeting();
  const displayName = (user.full_name || user.username).trim();

  function finishSplash() {
    if (completedRef.current) return;
    completedRef.current = true;
    setFadingOut(true);
    window.setTimeout(() => {
      onComplete();
    }, 240);
  }

  useEffect(() => {
    const el = videoRef.current;
    if (el) {
      el.defaultPlaybackRate = PLAYBACK_SPEED;
      el.playbackRate = PLAYBACK_SPEED;
      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // Fallback timer handles environments where autoplay is blocked
        });
      }
    }

    const fallbackTimer = window.setTimeout(() => {
      finishSplash();
    }, FALLBACK_TIMEOUT_MS);

    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  function applyPlaybackSpeed() {
    if (videoRef.current) {
      videoRef.current.playbackRate = PLAYBACK_SPEED;
    }
  }

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label={`${greeting}, ${displayName}. Opening Examination Portal.`}
      initial={{ opacity: 0 }}
      animate={{ opacity: fadingOut ? 0 : 1 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-50 overflow-hidden bg-gradient-to-r from-[#d9d9d9] via-[#eaeaea] to-[#d9d9d9] select-none"
    >
      {/* Full-bleed video blended seamlessly across the viewport */}
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        autoPlay
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={applyPlaybackSpeed}
        onPlay={applyPlaybackSpeed}
        onEnded={finishSplash}
        onError={finishSplash}
        className="absolute inset-0 w-full h-full object-contain [@media(min-aspect-ratio:6/5)]:object-cover object-center pointer-events-none [mask-image:linear-gradient(to_bottom,transparent_4%,black_18%,black_82%,transparent_96%)] [@media(min-aspect-ratio:6/5)]:[mask-image:none]"
      />

      {/* Subtle bottom gradient for clean typography contrast without boxing the video */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-[#dcdcdc]/90 via-[#e4e4e4]/40 to-transparent" />

      {/* Personalized Time-Based Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="pointer-events-none absolute inset-x-0 bottom-10 sm:bottom-14 z-10 px-6 text-center space-y-1.5"
      >
        <p className="text-xs sm:text-sm font-semibold tracking-[0.26em] text-[#cf6c38] uppercase">
          {greeting}
        </p>
        <h2 className="font-display text-2xl sm:text-4xl font-semibold text-[#0b5299] tracking-tight">
          {displayName}
        </h2>
        <p className="text-xs sm:text-sm text-slate-600 font-medium">
          {user.department} · {user.role === 'ADMIN' ? 'Admin Command Center' : 'Examiner Workspace'}
        </p>
      </motion.div>
    </motion.div>
  );
}

import React, { useEffect, useState } from 'react';
import { ArrowUp, MessageSquare } from 'lucide-react';

export function ScrollProgressBar() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) {
        setProgress(0);
      } else {
        setProgress(Math.min(100, Math.round((scrollTop / docHeight) * 100)));
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="no-print fixed top-0 left-0 right-0 h-[2px] z-50 bg-transparent pointer-events-none"
    >
      <div
        className="h-full bg-[#0b5299] dark:bg-sky-400 transition-transform duration-100 origin-left"
        style={{ transform: `scaleX(${progress / 100})` }}
      />
    </div>
  );
}

export function CookieBanner() {
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem('au_cookie_notice') === 'accepted';
  });

  if (dismissed) return null;

  function acceptNotice() {
    localStorage.setItem('au_cookie_notice', 'accepted');
    setDismissed(true);
  }

  return (
    <div className="no-print fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-6 py-3">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300">
        <span>
          This portal uses essential local storage strictly for authentication sessions and display
          preferences.
        </span>
        <button
          type="button"
          onClick={acceptNotice}
          className="px-5 py-1.5 text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer whitespace-nowrap"
        >
          Acknowledge
        </button>
      </div>
    </div>
  );
}

interface FloatingControlsProps {
  onNavigateContact: () => void;
  currentPath: string;
}

export function FloatingControls({ onNavigateContact, currentPath }: FloatingControlsProps) {
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 280);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="no-print fixed bottom-16 right-5 z-30 flex flex-col items-end gap-2">
      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:border-[#0b5299] shadow-sm rounded-none cursor-pointer"
        >
          <ArrowUp className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Top</span>
        </button>
      )}
      {currentPath !== '/contact' && (
        <button
          type="button"
          onClick={onNavigateContact}
          aria-label="Contact Examination Cell Support"
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white shadow-sm rounded-none cursor-pointer"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Support</span>
        </button>
      )}
    </div>
  );
}

interface SiteFooterProps {
  onNavigate: (path: string) => void;
}

export function SiteFooter({ onNavigate }: SiteFooterProps) {
  return (
    <footer className="no-print bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4 text-xs text-slate-600 dark:text-slate-400">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="font-display font-semibold text-[#0b5299] dark:text-sky-400 hover:underline cursor-pointer text-left"
            >
              Aditya University · Examination Cell
            </button>
            <p>
              © 2026 Aditya University, Surampalem. Last updated: November 18, 2026.
            </p>
          </div>

          <nav aria-label="Footer Navigation" className="flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="hover:text-[#0b5299] dark:hover:text-sky-400 cursor-pointer whitespace-nowrap"
            >
              Portal Home
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/about')}
              className="hover:text-[#0b5299] dark:hover:text-sky-400 cursor-pointer whitespace-nowrap"
            >
              About &amp; FAQ
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/privacy')}
              className="hover:text-[#0b5299] dark:hover:text-sky-400 cursor-pointer whitespace-nowrap"
            >
              Privacy Policy
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/contact')}
              className="hover:text-[#0b5299] dark:hover:text-sky-400 cursor-pointer whitespace-nowrap"
            >
              Contact Support
            </button>
            <a
              href="tel:+918842391111"
              className="text-[#0b5299] dark:text-sky-400 underline whitespace-nowrap"
            >
              +91 884 239 1111
            </a>
            <a
              href="mailto:examcell@adityauniversity.in"
              className="text-[#0b5299] dark:text-sky-400 underline whitespace-nowrap"
            >
              examcell@adityauniversity.in
            </a>
          </nav>
        </div>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>
            Developed by <strong className="font-medium text-slate-700 dark:text-slate-200">Pranav Vedula</strong>
          </span>
          <span>
            Developer &amp; Error Support:{' '}
            <a
              href="mailto:vedulapranav@gmail.com"
              className="text-[#0b5299] dark:text-sky-400 underline"
            >
              vedulapranav@gmail.com
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}

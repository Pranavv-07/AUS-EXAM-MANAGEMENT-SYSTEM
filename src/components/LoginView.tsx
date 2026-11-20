import React, { useState } from 'react';
import { Lock, User as UserIcon, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { UniversityCrest } from './UniversityCrest.tsx';
import { apiFetch, setAuthToken } from '../lib/api.ts';
import type { User } from '../types/exam.ts';

interface LoginViewProps {
  onLoginSuccess: (user: User) => void;
}

export function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [website, setWebsite] = useState(''); // Honeypot bot field
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const utmSource = sessionStorage.getItem('au_utm_source') || '';
      const data = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, website, utm_source: utmSource }),
      });
      setAuthToken(data.token);
      onLoginSuccess(data.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 bg-[#f8f8f8] dark:bg-slate-950 flex flex-col lg:flex-row">
      {/* Left: Institutional Campus Photography Panel */}
      <div className="relative lg:w-[46%] min-h-[240px] lg:min-h-[620px] bg-[#0b233b] overflow-hidden flex flex-col justify-between">
        <img
          src="/assets/aistudio/image_6b434e63.png"
          alt="Aditya University Aerial Campus"
          loading="eager"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b233b]/90 via-[#0b233b]/35 to-[#0b233b]/50" />

        <div className="relative z-10 p-6 lg:p-10 flex items-center gap-3">
          <UniversityCrest height={44} className="shrink-0" />
        </div>

        <div className="relative z-10 p-6 lg:p-10 space-y-1.5">
          <h1 className="font-display text-2xl lg:text-3xl font-medium text-white leading-snug max-w-md [text-wrap:balance]">
            Examination Seating &amp; Scheduling
          </h1>
          <p className="text-xs text-slate-200 tracking-wide">
            Surampalem · Andhra Pradesh · Examination Cell
          </p>
        </div>
      </div>

      {/* Right: Unified Role-Based Login Gateway */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-16">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md bg-white dark:bg-slate-900 border border-[#e5e7eb] dark:border-slate-800 rounded-[8px] p-8"
        >
          <div className="mb-6 pb-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-display text-2xl font-medium text-[#0b5299] dark:text-sky-400">
              Portal Sign In
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div
                role="alert"
                className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs font-medium text-[#ff0000]"
              >
                {error}
              </div>
            )}

            {/* Honeypot bot protection */}
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="hidden"
              aria-hidden="true"
            />

            <div>
              <label
                htmlFor="username"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Username
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="username"
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[39px] flex items-center justify-center gap-2 bg-[#0b5299] hover:bg-[#003a77] text-white text-sm font-normal py-2 px-6 rounded-none transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}

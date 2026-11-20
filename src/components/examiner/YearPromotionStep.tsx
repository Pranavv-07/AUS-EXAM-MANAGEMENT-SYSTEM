import React, { useState } from 'react';
import { ArrowUpCircle } from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import type { Student } from '../../types/exam.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface YearPromotionStepProps {
  students: Student[];
  onRefresh: () => Promise<void>;
}

export function YearPromotionStep({ students, onRefresh }: YearPromotionStepProps) {
  const [fromYear, setFromYear] = useState<number>(2);
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [promoting, setPromoting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');

  const branches = [...new Set(students.map((s) => s.branch))].sort();

  const matchingCount = students.filter(
    (s) =>
      !s.is_detained &&
      s.current_year === fromYear &&
      (branchFilter === 'ALL' || s.branch === branchFilter)
  ).length;

  async function handlePromote() {
    setConfirmOpen(false);
    setPromoting(true);
    setError('');
    setStatusMsg('');
    try {
      const res = await apiFetch<{ promoted_count: number; from_year: number; to_year: number }>(
        '/api/students/promote-year',
        {
          method: 'POST',
          body: JSON.stringify({
            from_year: fromYear,
            branch: branchFilter,
          }),
        }
      );
      setStatusMsg(
        `Promoted ${res.promoted_count} eligible students from Year ${res.from_year} to Year ${res.to_year}.`
      );
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm Academic Year Promotion"
        description={`Promote ${matchingCount} active ${
          branchFilter === 'ALL' ? '' : `${branchFilter} `
        }students from Year ${fromYear} to Year ${fromYear + 1}? Detained records remain unchanged.`}
        confirmLabel="Promote Cohort"
        danger={false}
        onConfirm={() => void handlePromote()}
        onCancel={() => setConfirmOpen(false)}
      />

      <div>
        <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white">
          07. Academic Year Promotion
        </h1>
      </div>

      {statusMsg && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-200">
          {statusMsg}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs font-medium text-[#ff0000]">
          {error}
        </div>
      )}

      {/* Year Distribution Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((yr) => {
          const activeCount = students.filter((s) => s.current_year === yr && !s.is_detained).length;
          const detainedCount = students.filter((s) => s.current_year === yr && s.is_detained).length;
          return (
            <div
              key={yr}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-5"
            >
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                B.Tech Year {yr}
              </p>
              <p className="font-mono-tabular text-2xl font-semibold text-[#0b5299] dark:text-sky-400 mt-1.5">
                {activeCount}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                {detainedCount} detained
              </p>
            </div>
          );
        })}
      </div>

      {/* Promotion Control Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-5 max-w-2xl">
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-800">
          Batch Cohort Progression
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="promote-from-year"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Promotion Transition
            </label>
            <select
              id="promote-from-year"
              value={fromYear}
              onChange={(e) => setFromYear(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
            >
              <option value={1}>Year 1 → Year 2</option>
              <option value={2}>Year 2 → Year 3</option>
              <option value={3}>Year 3 → Year 4</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="promote-branch"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Branch Scope
            </label>
            <select
              id="promote-branch"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
            >
              <option value="ALL">All Branches</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-4 bg-[#f8f8f8] dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-slate-700 dark:text-slate-300">
            Eligible active records queued:{' '}
            <span className="font-mono-tabular font-semibold text-[#0b5299] dark:text-sky-400">
              {matchingCount}
            </span>
          </div>
          <button
            type="button"
            disabled={promoting || matchingCount === 0}
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <ArrowUpCircle className="w-4 h-4" />
            <span>{promoting ? 'Promoting...' : `Promote to Year ${fromYear + 1}`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Play, ArrowUpRight, Grid, Eye, ShieldAlert, UserPlus } from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import type {
  ExamLayoutConfig,
  ExamSession,
  ExcludedStudentInfo,
  HallAllocation,
  InterleaveStyle,
  MasterSummaryRow,
  MinorStreamOption,
  SeatingMode,
} from '../../types/exam.ts';
import { BenchGridVisualizer } from './BenchGridVisualizer.tsx';

interface SeatingEngineStepProps {
  activeSession: ExamSession | null;
  allocations: HallAllocation[];
  onAllocationsUpdated: (
    session: ExamSession,
    allocations: HallAllocation[],
    summaryRows: MasterSummaryRow[]
  ) => void;
  onNext: () => void;
}

const ROOM_PATTERN_PRESETS: Array<{ label: string; pattern: number[] }> = [
  { label: '3-2-3', pattern: [3, 2, 3] },
  { label: '2-3-2', pattern: [2, 3, 2] },
  { label: '3-3-3', pattern: [3, 3, 3] },
  { label: '2-3-2-3-2', pattern: [2, 3, 2, 3, 2] },
  { label: '2-3-2-3', pattern: [2, 3, 2, 3] },
  { label: '2-3', pattern: [2, 3] },
  { label: '2-2-2-2', pattern: [2, 2, 2, 2] },
];

export function SeatingEngineStep({
  activeSession,
  allocations,
  onAllocationsUpdated,
  onNext,
}: SeatingEngineStepProps) {
  const [seatingMode, setSeatingMode] = useState<SeatingMode>(
    activeSession?.seating_mode || 'INTERLEAVED'
  );
  const [interleaveStyle, setInterleaveStyle] = useState<InterleaveStyle>(
    activeSession?.layout_config?.interleave_style || 'ALTERNATE_SEATS'
  );
  const [roomPatterns, setRoomPatterns] = useState<Record<string, number[]>>(
    activeSession?.layout_config?.room_patterns || {}
  );
  const [bufferSeatsPerHall, setBufferSeatsPerHall] = useState<number>(
    activeSession?.layout_config?.buffer_seats_per_hall ?? 0
  );
  const [minorFilter, setMinorFilter] = useState<string>(
    activeSession?.minor_stream_filter || 'ALL'
  );
  const [minorOptions, setMinorOptions] = useState<MinorStreamOption[]>([]);
  const [excludedStudents, setExcludedStudents] = useState<ExcludedStudentInfo[]>([]);
  const [inspectIdx, setInspectIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  // Post-allocation late-registrant buffer slotting state
  const [lateRollNo, setLateRollNo] = useState('');
  const [lateFullName, setLateFullName] = useState('');
  const [lateBranch, setLateBranch] = useState(activeSession?.target_branches?.[0] || 'CSE');
  const [lateYear, setLateYear] = useState<number>(activeSession?.target_years?.[0] || 2);
  const [lateHallId, setLateHallId] = useState<number>(0);
  const [slotting, setSlotting] = useState(false);

  useEffect(() => {
    apiFetch<MinorStreamOption[]>('/api/minor-streams')
      .then((rows) => setMinorOptions(rows))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeSession) {
      setSeatingMode(activeSession.seating_mode);
      setInterleaveStyle(activeSession.layout_config?.interleave_style || 'ALTERNATE_SEATS');
      setRoomPatterns(activeSession.layout_config?.room_patterns || {});
      setBufferSeatsPerHall(activeSession.layout_config?.buffer_seats_per_hall ?? 0);
      setMinorFilter(activeSession.minor_stream_filter || 'ALL');
      setLateBranch(activeSession.target_branches?.[0] || 'CSE');
      setLateYear(activeSession.target_years?.[0] || 2);
      setExcludedStudents([]);
    }
  }, [activeSession?.id]);

  useEffect(() => {
    if (allocations.length > 0 && !allocations.some((a) => a.hall_id === lateHallId)) {
      setLateHallId(allocations[0].hall_id);
    }
  }, [allocations]);

  if (!activeSession) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-8 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Please create or select an Exam Schedule in Step 03 before running the seating engine.
        </p>
      </div>
    );
  }

  async function handleRunEngine() {
    if (!activeSession) return;
    setRunning(true);
    setError('');
    setStatusMsg('');
    try {
      const layoutConfig: ExamLayoutConfig = {
        ...(activeSession.layout_config || {}),
        interleave_style: interleaveStyle,
        room_patterns: roomPatterns,
        buffer_seats_per_hall: bufferSeatsPerHall,
      };
      const res = await apiFetch<{
        session: ExamSession;
        allocations: HallAllocation[];
        summary_rows: MasterSummaryRow[];
        excluded_students?: ExcludedStudentInfo[];
        excluded_count?: number;
        hold_count?: number;
      }>(`/api/exams/${activeSession.id}/allocate`, {
        method: 'POST',
        body: JSON.stringify({
          seating_mode: seatingMode,
          minor_stream_filter: seatingMode === 'MINOR_STREAM' ? minorFilter : null,
          layout_config: layoutConfig,
        }),
      });
      onAllocationsUpdated(res.session, res.allocations, res.summary_rows);
      setExcludedStudents(res.excluded_students || []);
      setInspectIdx(0);
      const total = res.allocations.reduce((s, a) => s + a.allocated_count, 0);
      setStatusMsg(
        `Seating matrix computed: ${total} students assigned across ${res.allocations.length} halls.${
          res.excluded_count
            ? ` (${res.excluded_count} detained / on verification hold excluded automatically)`
            : ''
        }`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function handleSlotLateStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSession || !lateRollNo.trim() || !lateHallId) return;
    setSlotting(true);
    setError('');
    setStatusMsg('');
    try {
      const res = await apiFetch<{
        session: ExamSession;
        allocations: HallAllocation[];
        summary_rows: MasterSummaryRow[];
        slotted_room: string;
        slotted_seat: string;
        used_buffer: boolean;
      }>(`/api/exams/${activeSession.id}/pin-seat`, {
        method: 'POST',
        body: JSON.stringify({
          roll_no: lateRollNo.trim().toUpperCase(),
          full_name: lateFullName.trim() || undefined,
          branch: lateBranch.trim().toUpperCase(),
          current_year: lateYear,
          hall_id: lateHallId,
        }),
      });
      onAllocationsUpdated(res.session, res.allocations, res.summary_rows);
      const slottedIdx = res.allocations.findIndex((a) => a.hall_id === lateHallId);
      if (slottedIdx >= 0) setInspectIdx(slottedIdx);
      setStatusMsg(
        `Slotted ${lateRollNo.trim().toUpperCase()} into ${res.slotted_room} (${res.slotted_seat}${
          res.used_buffer ? ' · Reserved Buffer Seat' : ''
        }) without modifying any other room.`
      );
      setLateRollNo('');
      setLateFullName('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSlotting(false);
    }
  }

  const totalAllocated = allocations.reduce((sum, a) => sum + a.allocated_count, 0);
  const inspectedAlloc =
    allocations.length > 0 ? allocations[Math.min(inspectIdx, allocations.length - 1)] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white">
            04. Seating Algorithm Engine
          </h1>
          <p className="text-xs font-medium text-[#0b5299] dark:text-sky-400 mt-0.5">
            {activeSession.exam_title} · {activeSession.exam_date} ({activeSession.session_slot})
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={running}
            onClick={() => void handleRunEngine()}
            className="flex items-center gap-2 px-5 py-2 min-h-[39px] text-xs font-medium bg-[#cf6c38] hover:bg-[#b85a29] text-white rounded-none cursor-pointer whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{running ? 'Computing Matrices...' : 'Run Seating Allocation Engine'}</span>
          </button>

          {allocations.length > 0 && (
            <button
              type="button"
              onClick={onNext}
              className="flex items-center gap-1.5 px-5 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer whitespace-nowrap"
            >
              <span>Next: Invigilation Form</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
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

      {/* Strategy Selection */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-4">
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Seating Allocation Rule (Per Exam Selection)
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => setSeatingMode('SINGLE_YEAR_CORNERS')}
            className={`p-4 border text-left cursor-pointer ${
              seatingMode === 'SINGLE_YEAR_CORNERS'
                ? 'border-[#0b5299] bg-[#eef3f9] dark:bg-sky-950'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
            }`}
          >
            <div className="text-sm font-semibold text-[#0b5299] dark:text-sky-400">
              Single-Year Corner Seating
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
              When only 1 year has an exam: 2 students per bench on the outer corners, middle seat kept empty.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setSeatingMode('INTERLEAVED')}
            className={`p-4 border text-left cursor-pointer ${
              seatingMode === 'INTERLEAVED'
                ? 'border-[#0b5299] bg-[#eef3f9] dark:bg-sky-950'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
            }`}
          >
            <div className="text-sm font-semibold text-[#0b5299] dark:text-sky-400">
              Interleaved Multi-Cohort
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
              Mixes multiple years/branches vertically using each room&apos;s bench pattern (e.g. 3-2-3 or 2-3-2).
            </p>
          </button>

          <button
            type="button"
            onClick={() => setSeatingMode('SEQUENTIAL')}
            className={`p-4 border text-left cursor-pointer ${
              seatingMode === 'SEQUENTIAL'
                ? 'border-[#0b5299] bg-[#eef3f9] dark:bg-sky-950'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
            }`}
          >
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              Sequential Vertical Fill
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
              Fills every seat top-to-bottom column by column in strict alphanumeric roll order.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setSeatingMode('MINOR_STREAM')}
            className={`p-4 border text-left cursor-pointer ${
              seatingMode === 'MINOR_STREAM'
                ? 'border-[#0b5299] bg-[#eef3f9] dark:bg-sky-950'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
            }`}
          >
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              Minor Stream Vertical
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
              Filters selected Minor Stream students (Machine Intelligence, SAP, etc.) down designated columns.
            </p>
          </button>
        </div>

        {seatingMode === 'INTERLEAVED' && (
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Interleaving Layout Style:
            </span>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'ALTERNATE_SEATS', label: 'Alternate Seats (A-B-A / B-A-B)' },
                  { id: 'BENCH_BLOCKS', label: 'Alternating Benches (3-2-3 / 2-3-2)' },
                  { id: 'PAIRED_COLUMNS', label: 'Paired Columns (A-B | A-B)' },
                ] as Array<{ id: InterleaveStyle; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setInterleaveStyle(opt.id)}
                  className={`px-3 py-1.5 text-xs font-medium border cursor-pointer ${
                    interleaveStyle === opt.id
                      ? 'bg-[#0b5299] text-white border-[#0b5299]'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {seatingMode === 'MINOR_STREAM' && (
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-3">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Minor Stream Filter:
            </label>
            <select
              value={minorFilter}
              onChange={(e) => setMinorFilter(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">All Minor Streams</option>
              {minorOptions.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name} ({m.code})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Buffer Seats per Hall (Emergency / Late Reg):
            </span>
            <span className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">
              PwD students are prioritized onto Ground Floor rooms automatically.
            </span>
          </div>
          <div className="inline-flex border border-slate-300 dark:border-slate-700">
            {[0, 1, 2].map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setBufferSeatsPerHall(count)}
                className={`px-3 py-1 text-xs font-mono-tabular font-semibold cursor-pointer ${
                  count > 0 ? 'border-l border-slate-300 dark:border-slate-700' : ''
                } ${
                  bufferSeatsPerHall === count
                    ? 'bg-[#0b5299] text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
                }`}
              >
                {count} {count === 1 ? 'Seat' : 'Seats'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Excluded / Verification Hold Alert */}
      {excludedStudents.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-[8px] p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              <span>
                Verification Hold &amp; Excluded Students ({excludedStudents.length} filtered out)
              </span>
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Global detained, course-detained, and condonation pending holds are excluded automatically
            </span>
          </div>
          <div className="max-h-[160px] overflow-y-auto border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {excludedStudents.map((ex) => (
              <div
                key={`${ex.roll_no}-${ex.reason}-${ex.course_code || ''}`}
                className="px-3 py-2 flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
                    {ex.roll_no}
                  </span>{' '}
                  <span className="text-slate-600 dark:text-slate-400">
                    — {ex.full_name} ({ex.branch} Year {ex.current_year})
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 font-mono-tabular text-[11px] font-semibold ${
                    ex.reason === 'CONDONATION_PENDING'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                      : 'bg-red-100 text-[#ff0000] dark:bg-red-950 dark:text-red-300'
                  }`}
                >
                  {ex.reason}
                  {ex.course_code ? ` · ${ex.course_code}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Yield Table + Live Matrix Inspector */}
      {allocations.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-10 text-center space-y-3">
          <Grid className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            No Seating Matrices Computed Yet
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Select your preferred strategy above and click &ldquo;Run Seating Allocation Engine&rdquo; to
            compute the bench-spaced seat matrices across your selected Bhavan rooms.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Room-Wise Allocation Yield
              </h2>
              <span className="font-mono-tabular text-xs font-semibold text-[#0b5299] dark:text-sky-400">
                Total Seated: {totalAllocated} students across {allocations.length} halls
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#0b5299] text-white text-xs font-medium">
                    <th className="py-2.5 px-4">Order</th>
                    <th className="py-2.5 px-4">Room / Bhavan</th>
                    <th className="py-2.5 px-4">Bench Pattern</th>
                    <th className="py-2.5 px-4">Cohort Yield Breakdown</th>
                    <th className="py-2.5 px-4 text-right">Occupied / Grid</th>
                    <th className="py-2.5 px-4 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {allocations.map((alloc, idx) => {
                    const effectivePattern =
                      roomPatterns[String(alloc.hall.id)] || alloc.hall.bench_pattern;
                    const patternStr = effectivePattern.join('-');
                    return (
                      <tr
                        key={alloc.id}
                        className={`${
                          idx === inspectIdx
                            ? 'bg-[#eef3f9]/60 dark:bg-sky-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="py-2.5 px-4 font-mono-tabular text-slate-500 dark:text-slate-400">
                          #{alloc.sort_order}
                        </td>
                        <td className="py-2.5 px-4 font-mono-tabular font-semibold text-slate-900 dark:text-white">
                          {alloc.hall.room_no}{' '}
                          <span className="text-[11px] font-normal text-slate-500">
                            ({alloc.hall.building_code})
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <select
                            value={patternStr}
                            onChange={(e) =>
                              setRoomPatterns((prev) => ({
                                ...prev,
                                [String(alloc.hall.id)]: e.target.value.split('-').map(Number),
                              }))
                            }
                            className="px-2 py-1 text-[11px] font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                            title="Re-run engine after changing bench pattern"
                          >
                            {!ROOM_PATTERN_PRESETS.some((p) => p.label === patternStr) && (
                              <option value={patternStr}>{patternStr}</option>
                            )}
                            {ROOM_PATTERN_PRESETS.map((p) => (
                              <option key={p.label} value={p.label}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-4 font-mono-tabular text-slate-800 dark:text-slate-200">
                          {Object.entries(alloc.cohort_counts)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join('  ·  ')}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono-tabular font-semibold text-[#0b5299] dark:text-sky-400">
                          {alloc.allocated_count} / {alloc.hall.grid_rows * alloc.hall.grid_cols}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setInspectIdx(idx)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border cursor-pointer ${
                              idx === inspectIdx
                                ? 'bg-[#0b5299] text-white border-[#0b5299]'
                                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                            }`}
                          >
                            <Eye className="w-3 h-3" />
                            <span>View Grid</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Post-Allocation Single-Room Buffer Slotting */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-[#cf6c38]" />
                  <span>Slot Late / Re-Registered Student into Buffer Seat (Single Room Only)</span>
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Adds a student (e.g. AUS-26-10392) into a reserved BUFFER or open seat in one hall without regenerating or disturbing any other room sheet.
                </p>
              </div>
            </div>
            <form onSubmit={handleSlotLateStudent} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-3">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Roll No
                </label>
                <input
                  type="text"
                  required
                  value={lateRollNo}
                  onChange={(e) => setLateRollNo(e.target.value)}
                  placeholder="AUS-26-10392"
                  className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Student Name (Optional if in DB)
                </label>
                <input
                  type="text"
                  value={lateFullName}
                  onChange={(e) => setLateFullName(e.target.value)}
                  placeholder="Full Name"
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Branch
                </label>
                <input
                  type="text"
                  value={lateBranch}
                  onChange={(e) => setLateBranch(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs font-mono-tabular uppercase border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Year
                </label>
                <select
                  value={lateYear}
                  onChange={(e) => setLateYear(Number(e.target.value))}
                  className="w-full px-2 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {[1, 2, 3, 4].map((y) => (
                    <option key={y} value={y}>
                      Y{y}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Target Hall (Open Buffer/Empty)
                </label>
                <select
                  value={lateHallId || allocations[0]?.hall_id || 0}
                  onChange={(e) => setLateHallId(Number(e.target.value))}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {allocations.map((a) => {
                    const bufLeft = a.cells.filter(
                      (c) => !c.roll_no_snapshot && c.cohort_label === 'BUFFER'
                    ).length;
                    const empLeft = a.cells.filter(
                      (c) => !c.roll_no_snapshot && c.cohort_label !== 'EMPTY' && c.cohort_label !== 'BUFFER'
                    ).length;
                    return (
                      <option key={a.hall_id} value={a.hall_id}>
                        {a.hall.room_no} ({bufLeft} buf · {empLeft} free)
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={slotting}
                  className="w-full py-2 px-3 text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer"
                >
                  {slotting ? 'Slotting...' : 'Slot into Room'}
                </button>
              </div>
            </form>
          </div>

          {/* Bench-Spaced Visual Grid Preview for Inspected Room */}
          {inspectedAlloc && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    Bench-Spaced Room Visualizer — {inspectedAlloc.hall.room_no} (
                    {inspectedAlloc.hall.building_name} · {inspectedAlloc.hall.floor})
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Pattern [{inspectedAlloc.hall.bench_pattern.join(' · ')}] × {inspectedAlloc.hall.grid_rows}{' '}
                    rows · {inspectedAlloc.allocated_count} seated
                    {activeSession.seating_mode === 'SINGLE_YEAR_CORNERS'
                      ? ' · Single-Year Corner Mode (middle seats intentionally blank)'
                      : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {allocations.map((a, idx) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setInspectIdx(idx)}
                      className={`px-2.5 py-1 font-mono-tabular text-[11px] border cursor-pointer ${
                        idx === inspectIdx
                          ? 'bg-[#0b5299] text-white border-[#0b5299]'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {a.hall.room_no}
                    </button>
                  ))}
                </div>
              </div>

              <BenchGridVisualizer
                rows={inspectedAlloc.hall.grid_rows}
                benchPattern={inspectedAlloc.hall.bench_pattern}
                roomType={inspectedAlloc.hall.room_type}
                cells={inspectedAlloc.cells}
                columnHeaders={inspectedAlloc.column_headers}
                highlightCornersOnly={activeSession.seating_mode === 'SINGLE_YEAR_CORNERS'}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

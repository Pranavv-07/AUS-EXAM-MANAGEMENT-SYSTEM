import React, { useEffect, useState } from 'react';
import {
  Download,
  Printer,
  FileText,
  Grid,
  ClipboardList,
  FileCheck,
  Copy,
  Check,
  PackageCheck,
} from 'lucide-react';
import { UniversityCrest } from '../UniversityCrest.tsx';
import { apiFetch, downloadAuthorizedFile } from '../../lib/api.ts';
import type {
  DispatchFloorSummary,
  DispatchRoomRow,
  ExamSession,
  HallAllocation,
  MasterSummaryRow,
} from '../../types/exam.ts';
import { BenchGridVisualizer } from './BenchGridVisualizer.tsx';

interface PreviewExportStepProps {
  activeSession: ExamSession | null;
  allocations: HallAllocation[];
  summaryRows: MasterSummaryRow[];
}

export function PreviewExportStep({
  activeSession,
  allocations,
  summaryRows,
}: PreviewExportStepProps) {
  const [docMode, setDocMode] = useState<'master' | 'room' | 'proforma' | 'dispatch'>('master');
  const [selectedRoomIdx, setSelectedRoomIdx] = useState(0);
  const [includeSubject, setIncludeSubject] = useState(true);
  const [dispatchBufferPct, setDispatchBufferPct] = useState<number>(
    activeSession?.layout_config?.dispatch_buffer_pct ?? 5
  );
  const [dispatchData, setDispatchData] = useState<{
    bufferPct: number;
    roomRows: DispatchRoomRow[];
    floorSummaries: DispatchFloorSummary[];
    totals: {
      rooms: number;
      students: number;
      qp_with_buffer: number;
      booklets_with_buffer: number;
    };
  } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeSession || allocations.length === 0) {
      setDispatchData(null);
      return;
    }
    apiFetch<{
      bufferPct: number;
      roomRows: DispatchRoomRow[];
      floorSummaries: DispatchFloorSummary[];
      totals: {
        rooms: number;
        students: number;
        qp_with_buffer: number;
        booklets_with_buffer: number;
      };
    }>(`/api/exams/${activeSession.id}/dispatch?bufferPct=${dispatchBufferPct}`)
      .then((res) => setDispatchData(res))
      .catch(() => {});
  }, [activeSession?.id, allocations, dispatchBufferPct]);

  if (!activeSession || allocations.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-8 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Run the Seating Allocation Engine in Step 04 first to preview and export official PDF documents.
        </p>
      </div>
    );
  }

  const activeAlloc = allocations[Math.min(selectedRoomIdx, allocations.length - 1)];

  async function handleDownload(
    type: 'master' | 'rooms' | 'bundle' | 'attendance' | 'proforma' | 'dispatch'
  ) {
    if (!activeSession) return;
    setDownloading(type);
    setError('');
    try {
      const qs = `?includeSubject=${includeSubject}`;
      if (type === 'master') {
        await downloadAuthorizedFile(
          `/api/exams/${activeSession.id}/pdf/master${qs}`,
          `AU_Master_Seating_${activeSession.exam_date}_${activeSession.session_slot}.pdf`
        );
      } else if (type === 'rooms') {
        await downloadAuthorizedFile(
          `/api/exams/${activeSession.id}/pdf/rooms`,
          `AU_Room_Seating_Absentees_${activeSession.exam_date}_${activeSession.session_slot}.pdf`
        );
      } else if (type === 'attendance') {
        await downloadAuthorizedFile(
          `/api/exams/${activeSession.id}/pdf/attendance`,
          `AU_Attendance_Sheets_${activeSession.exam_date}_${activeSession.session_slot}.pdf`
        );
      } else if (type === 'proforma') {
        await downloadAuthorizedFile(
          `/api/exams/${activeSession.id}/pdf/proforma`,
          `AU_Examination_Proforma_${activeSession.exam_date}_${activeSession.session_slot}.pdf`
        );
      } else if (type === 'dispatch') {
        await downloadAuthorizedFile(
          `/api/exams/${activeSession.id}/pdf/dispatch?bufferPct=${dispatchBufferPct}`,
          `AU_QP_Booklet_Dispatch_${activeSession.exam_date}_${activeSession.session_slot}.pdf`
        );
      } else {
        await downloadAuthorizedFile(
          `/api/exams/${activeSession.id}/pdf/bundle${qs}`,
          `AU_Complete_Exam_Bundle_${activeSession.exam_date}_${activeSession.session_slot}.pdf`
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  function handleCopySummary() {
    if (!activeSession) return;
    const text = summaryRows
      .map((r) => `${r.room_no}: ${r.branch_label} (${r.roll_from} - ${r.roll_to}) [${r.total}]`)
      .join('\n');
    void navigator.clipboard.writeText(
      `${activeSession.exam_title} (${activeSession.exam_date} ${activeSession.session_slot})\n${text}`
    );
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  }

  const grandTotal = summaryRows.reduce((s, r) => s + r.total, 0);
  const buildingsMap = new Map<string, string>();
  for (const a of allocations) {
    buildingsMap.set(a.hall.building_code, a.hall.building_name);
  }

  const activeBenchPattern =
    activeAlloc &&
    (activeSession.layout_config?.room_patterns?.[String(activeAlloc.hall.id)]?.length
      ? activeSession.layout_config.room_patterns[String(activeAlloc.hall.id)]
      : activeAlloc.hall.bench_pattern);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white">
            06. Live Grid Preview &amp; Official PDF Export
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopySummary}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:border-[#0b5299] rounded-none cursor-pointer whitespace-nowrap"
          >
            {copiedSummary ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>{copiedSummary ? 'Copied Ranges' : 'Copy Ranges'}</span>
          </button>

          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => void handleDownload('master')}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#0b5299] text-[#0b5299] dark:text-sky-400 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-none cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{downloading === 'master' ? 'Generating...' : 'Master Summary PDF'}</span>
          </button>

          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => void handleDownload('rooms')}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#0b5299] text-[#0b5299] dark:text-sky-400 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-none cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{downloading === 'rooms' ? 'Generating...' : 'Seating & Absentees PDF'}</span>
          </button>

          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => void handleDownload('attendance')}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#0b5299] text-[#0b5299] dark:text-sky-400 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-none cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{downloading === 'attendance' ? 'Generating...' : 'Attendance Reports PDF'}</span>
          </button>

          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => void handleDownload('proforma')}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#0b5299] text-[#0b5299] dark:text-sky-400 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-none cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{downloading === 'proforma' ? 'Generating...' : 'Exam Proforma PDF'}</span>
          </button>

          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => void handleDownload('dispatch')}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#cf6c38] text-[#cf6c38] dark:text-orange-400 bg-white dark:bg-slate-900 hover:bg-orange-50 dark:hover:bg-slate-800 rounded-none cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {downloading === 'dispatch'
                ? 'Generating...'
                : `QP Dispatch PDF (+${dispatchBufferPct}%)`}
            </span>
          </button>

          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => void handleDownload('bundle')}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {downloading === 'bundle' ? 'Generating Bundle...' : 'Complete Seating Bundle'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-none cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print View</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="no-print p-3 bg-red-50 border border-red-200 text-xs font-medium text-[#ff0000]">
          {error}
        </div>
      )}

      {/* Document Mode Switcher */}
      <div className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDocMode('master')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border cursor-pointer ${
              docMode === 'master'
                ? 'bg-[#0b5299] text-white border-[#0b5299]'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Master Seating Summary</span>
          </button>
          <button
            type="button"
            onClick={() => setDocMode('room')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border cursor-pointer ${
              docMode === 'room'
                ? 'bg-[#0b5299] text-white border-[#0b5299]'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Room Seating Grid ({allocations.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setDocMode('proforma')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border cursor-pointer ${
              docMode === 'proforma'
                ? 'bg-[#0b5299] text-white border-[#0b5299]'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span>Handover Proforma</span>
          </button>
          <button
            type="button"
            onClick={() => setDocMode('dispatch')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border cursor-pointer ${
              docMode === 'dispatch'
                ? 'bg-[#0b5299] text-white border-[#0b5299]'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
            }`}
          >
            <PackageCheck className="w-3.5 h-3.5" />
            <span>QP &amp; Booklet Dispatch Sheet</span>
          </button>
        </div>

        {docMode === 'master' ? (
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeSubject}
              onChange={(e) => setIncludeSubject(e.target.checked)}
              className="accent-[#0b5299]"
            />
            <span>Include Subject / Time Table Column</span>
          </label>
        ) : docMode === 'room' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {allocations.map((alloc, idx) => (
              <button
                key={alloc.id}
                type="button"
                onClick={() => setSelectedRoomIdx(idx)}
                className={`px-3 py-1.5 font-mono-tabular text-xs border cursor-pointer ${
                  selectedRoomIdx === idx
                    ? 'bg-[#0b5299] text-white border-[#0b5299]'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:border-[#0b5299]'
                }`}
              >
                {alloc.hall.room_no}
              </button>
            ))}
          </div>
        ) : docMode === 'dispatch' ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-300">Stationery Buffer:</span>
            <div className="inline-flex border border-slate-300 dark:border-slate-700">
              {[0, 5, 10, 15].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setDispatchBufferPct(pct)}
                  className={`px-2.5 py-1 font-mono-tabular text-xs font-semibold cursor-pointer ${
                    pct > 0 ? 'border-l border-slate-300 dark:border-slate-700' : ''
                  } ${
                    dispatchBufferPct === pct
                      ? 'bg-[#cf6c38] text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  +{pct}%
                </button>
              ))}
            </div>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <FileCheck className="w-4 h-4 text-[#0b5299] dark:text-sky-400" />
            <span>Consolidated Answer Script Handover Proforma</span>
          </span>
        )}
      </div>

      {/* DOCUMENT 1 LIVE PREVIEW */}
      {docMode === 'master' && (
        <div className="print-only-full bg-white border border-slate-300 p-6 lg:p-10 text-black max-w-5xl mx-auto overflow-x-auto">
          <div className="flex items-center justify-between border-b-2 border-[#0b5299] pb-4 mb-5">
            <UniversityCrest height={44} className="shrink-0" />
            <div className="text-center flex-1 px-4">
              <h2 className="font-display text-xl font-bold tracking-wide text-[#0b5299]">
                ADITYA UNIVERSITY
              </h2>
              <p className="text-[11px] text-slate-700">
                SURAMPALEM - 533437, ANDHRA PRADESH, INDIA
              </p>
              <p className="text-xs font-bold text-slate-900 mt-1 uppercase">
                DEPARTMENT OF {activeSession.department}
              </p>
              <p className="text-xs font-bold text-black mt-0.5">
                SEATING ARRANGEMENT — NOTICE BOARD COPY
              </p>
            </div>
            <div className="w-14 shrink-0" />
          </div>

          <div className="text-center mb-4">
            <p className="text-xs font-bold uppercase">{activeSession.exam_title}</p>
            <div className="flex justify-between text-xs font-semibold mt-2">
              <span>DATE: {activeSession.exam_date}</span>
              <span>
                TIME: {activeSession.session_slot} ({activeSession.session_timing})
              </span>
            </div>
          </div>

          <table className="w-full border-collapse border border-black text-xs">
            <thead>
              <tr className="bg-[#eef3f9] text-black font-bold text-center">
                <th rowSpan={2} className="border border-black py-2 px-2 w-12">
                  S.No
                </th>
                <th rowSpan={2} className="border border-black py-2 px-3">
                  Branch / Floor
                </th>
                <th colSpan={2} className="border border-black py-1.5 px-2">
                  ROLL NUMBERS
                </th>
                {includeSubject && (
                  <th rowSpan={2} className="border border-black py-2 px-3">
                    Subject / Time Table
                  </th>
                )}
                <th rowSpan={2} className="border border-black py-2 px-3">
                  ROOM NO
                </th>
                <th rowSpan={2} className="border border-black py-2 px-3 w-16">
                  Total
                </th>
              </tr>
              <tr className="bg-[#eef3f9] text-black font-bold text-center">
                <th className="border border-black py-1 px-2">From</th>
                <th className="border border-black py-1 px-2">To</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row.sno} className="text-center">
                  <td className="border border-black py-2 px-2 font-mono-tabular">{row.sno}</td>
                  {row.row_span && row.row_span > 0 ? (
                    <td
                      rowSpan={row.row_span}
                      className="border border-black py-2 px-3 font-semibold align-middle"
                    >
                      <div>{row.branch_label}</div>
                      <div className="text-[11px] font-normal">({row.floor_label})</div>
                    </td>
                  ) : row.row_span === undefined ? (
                    <td className="border border-black py-2 px-3 font-semibold">
                      {row.branch_label} ({row.floor_label})
                    </td>
                  ) : null}
                  <td className="border border-black py-2 px-2 font-mono-tabular">{row.roll_from}</td>
                  <td className="border border-black py-2 px-2 font-mono-tabular">{row.roll_to}</td>
                  {includeSubject && (
                    <td className="border border-black py-2 px-2 text-[11px]">{row.subject}</td>
                  )}
                  <td className="border border-black py-2 px-2 font-mono-tabular font-semibold">
                    {row.room_no}
                  </td>
                  <td className="border border-black py-2 px-2 font-mono-tabular font-semibold">
                    {row.total}
                  </td>
                </tr>
              ))}
              <tr className="bg-[#eef3f9] font-bold">
                <td
                  colSpan={includeSubject ? 6 : 5}
                  className="border border-black py-2 px-4 text-right"
                >
                  GRAND TOTAL
                </td>
                <td className="border border-black py-2 px-2 text-center font-mono-tabular">
                  {grandTotal}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-5 text-[11px] font-semibold text-slate-800">
            BUILDING LEGEND:{' '}
            {Array.from(buildingsMap.entries())
              .map(([code, name]) => `${code}: ${name}`)
              .join('   |   ')}
          </div>

          <div className="mt-14 flex items-center justify-between text-xs font-bold">
            <span>Dept. Examcell In-Charge</span>
            <span>HEAD OF THE DEPARTMENT</span>
          </div>
        </div>
      )}

      {/* DOCUMENT 2 LIVE PREVIEW (Bench-Spaced Layout) */}
      {docMode === 'room' && activeAlloc && (
        <div className="print-only-full bg-white border border-slate-300 p-6 lg:p-8 text-black max-w-6xl mx-auto">
          <div className="flex items-center justify-between border-b-2 border-[#0b5299] pb-3 mb-4">
            <UniversityCrest height={40} className="shrink-0" />
            <div className="text-center flex-1 px-4">
              <h2 className="font-display text-lg font-bold tracking-wide text-[#0b5299]">
                ADITYA UNIVERSITY
              </h2>
              <p className="text-[11px] text-slate-700">
                SURAMPALEM - 533437, ANDHRA PRADESH, INDIA
              </p>
              <p className="text-xs font-bold text-slate-900 mt-0.5 uppercase">
                DEPARTMENT OF {activeSession.department}
              </p>
              <p className="text-xs font-bold text-black">
                SEATING PLAN &amp; ABSENTEES STATEMENT — INVIGILATOR COPY
              </p>
            </div>
            <div className="w-12 shrink-0" />
          </div>

          <table className="w-full border-collapse border border-black text-xs mb-4">
            <tbody>
              <tr>
                <td className="border border-black py-1.5 px-3 font-bold w-1/2">
                  Room No: {activeAlloc.hall.room_no} ({activeAlloc.hall.building_code} ·{' '}
                  {activeAlloc.hall.floor})
                </td>
                <td className="border border-black py-1.5 px-3 font-bold w-1/2">
                  Date &amp; Session: {activeSession.exam_date} | {activeSession.session_slot} (
                  {activeSession.session_timing})
                </td>
              </tr>
              <tr>
                <td className="border border-black py-1.5 px-3">
                  Name of the Invigilator - I:{' '}
                  <span className="font-semibold">
                    {activeAlloc.invigilator_1_name || '________________________'}
                  </span>{' '}
                  (Emp. ID: {activeAlloc.invigilator_1_emp_id || '________'})
                </td>
                <td className="border border-black py-1.5 px-3">
                  Name of the Invigilator - II:{' '}
                  <span className="font-semibold">
                    {activeAlloc.invigilator_2_name || '________________________'}
                  </span>{' '}
                  (Emp. ID: {activeAlloc.invigilator_2_emp_id || '________'})
                </td>
              </tr>
            </tbody>
          </table>

          <div className="border border-slate-300 p-3 bg-white">
            <BenchGridVisualizer
              rows={activeAlloc.hall.grid_rows}
              benchPattern={activeBenchPattern || [3, 3, 3]}
              roomType={activeAlloc.hall.room_type}
              cells={activeAlloc.cells}
              columnHeaders={activeAlloc.column_headers}
              highlightCornersOnly={activeSession.seating_mode === 'SINGLE_YEAR_CORNERS'}
            />
          </div>

          <p className="text-center text-xs font-bold mt-3 mb-4">Roll Numbers Allotted</p>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            <div className="md:col-span-6 space-y-12">
              <p className="text-xs font-bold">Note: Please round off the Roll No&apos;s absent.</p>
              <div className="flex items-center justify-between text-xs font-bold pt-4">
                <span>Signature of the Invigilator - I</span>
                <span>Signature of the Invigilator - II</span>
              </div>
            </div>

            <div className="md:col-span-6">
              <table className="w-full border-collapse border border-black text-xs text-center">
                <thead>
                  <tr className="bg-[#eef3f9] font-bold">
                    <th className="border border-black py-1.5 px-2">Branch</th>
                    <th className="border border-black py-1.5 px-2">No. of Presentees</th>
                    <th className="border border-black py-1.5 px-2">No. of Absentees</th>
                    <th className="border border-black py-1.5 px-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(activeAlloc.cohort_counts).map(([cohort, count]) => (
                    <tr key={cohort}>
                      <td className="border border-black py-1.5 px-2 font-semibold">{cohort}</td>
                      <td className="border border-black py-1.5 px-2 h-7" />
                      <td className="border border-black py-1.5 px-2 h-7" />
                      <td className="border border-black py-1.5 px-2 font-mono-tabular font-semibold">
                        {count}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold">
                    <td className="border border-black py-1.5 px-2">Total</td>
                    <td className="border border-black py-1.5 px-2 h-7" />
                    <td className="border border-black py-1.5 px-2 h-7" />
                    <td className="border border-black py-1.5 px-2 font-mono-tabular">
                      {activeAlloc.allocated_count}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENT 3 LIVE PREVIEW: PROFORMA */}
      {docMode === 'proforma' && (
        <div className="print-only-full bg-white border border-slate-300 p-6 lg:p-10 text-black max-w-5xl mx-auto overflow-x-auto">
          <div className="flex items-center justify-between border-b-2 border-[#0b5299] pb-4 mb-5">
            <UniversityCrest height={44} className="shrink-0" />
            <div className="text-center flex-1 px-4">
              <h2 className="font-display text-xl font-bold tracking-wide text-[#0b5299]">
                ADITYA UNIVERSITY
              </h2>
              <p className="text-[11px] text-slate-700">
                SURAMPALEM - 533437, ANDHRA PRADESH, INDIA
              </p>
              <p className="text-xs font-bold text-slate-900 mt-1 uppercase">
                DEPARTMENT OF {activeSession.department}
              </p>
              <p className="text-xs font-bold text-black mt-0.5">
                INVIGILATION DUTY &amp; ANSWER SCRIPT HANDOVER PROFORMA
              </p>
            </div>
            <div className="w-14 shrink-0" />
          </div>

          <div className="text-center mb-4">
            <p className="text-xs font-bold uppercase">{activeSession.exam_title}</p>
            <p className="text-xs font-semibold mt-1">
              Date: {activeSession.exam_date} · Session: {activeSession.session_slot} (
              {activeSession.session_timing})
            </p>
          </div>

          <table className="w-full border-collapse border border-black text-xs text-center">
            <thead>
              <tr className="bg-[#eef3f9] font-bold">
                <th className="border border-black py-2 px-2">S.No</th>
                <th className="border border-black py-2 px-3">Room No</th>
                <th className="border border-black py-2 px-3">Invigilator I (Emp ID)</th>
                <th className="border border-black py-2 px-3">Invigilator II (Emp ID)</th>
                <th className="border border-black py-2 px-2">Allotted</th>
                <th className="border border-black py-2 px-2">Present</th>
                <th className="border border-black py-2 px-2">Absent</th>
                <th className="border border-black py-2 px-3">Handover Sign</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a, idx) => (
                <tr key={a.id}>
                  <td className="border border-black py-2.5 px-2 font-mono-tabular">{idx + 1}</td>
                  <td className="border border-black py-2.5 px-3 font-mono-tabular font-semibold">
                    {a.hall.room_no}
                  </td>
                  <td className="border border-black py-2.5 px-3 text-left">
                    {a.invigilator_1_name || '__________________'}{' '}
                    {a.invigilator_1_emp_id ? `(${a.invigilator_1_emp_id})` : ''}
                  </td>
                  <td className="border border-black py-2.5 px-3 text-left">
                    {a.invigilator_2_name || '__________________'}{' '}
                    {a.invigilator_2_emp_id ? `(${a.invigilator_2_emp_id})` : ''}
                  </td>
                  <td className="border border-black py-2.5 px-2 font-mono-tabular font-semibold">
                    {a.allocated_count}
                  </td>
                  <td className="border border-black py-2.5 px-2" />
                  <td className="border border-black py-2.5 px-2" />
                  <td className="border border-black py-2.5 px-3" />
                </tr>
              ))}
              <tr className="bg-[#eef3f9] font-bold">
                <td colSpan={4} className="border border-black py-2 px-4 text-right">
                  TOTAL
                </td>
                <td className="border border-black py-2 px-2 font-mono-tabular">
                  {allocations.reduce((s, a) => s + a.allocated_count, 0)}
                </td>
                <td className="border border-black py-2 px-2" />
                <td className="border border-black py-2 px-2" />
                <td className="border border-black py-2 px-3" />
              </tr>
            </tbody>
          </table>

          <div className="mt-14 flex items-center justify-between text-xs font-bold">
            <span>Dept. Examcell In-Charge</span>
            <span>Chief Superintendent / HOD</span>
          </div>
        </div>
      )}

      {/* DOCUMENT 4 LIVE PREVIEW: QP & ANSWER BOOKLET DISPATCH */}
      {docMode === 'dispatch' && dispatchData && (
        <div className="print-only-full bg-white border border-slate-300 p-6 lg:p-10 text-black max-w-5xl mx-auto space-y-6 overflow-x-auto">
          <div className="flex items-center justify-between border-b-2 border-[#0b5299] pb-4">
            <UniversityCrest height={44} className="shrink-0" />
            <div className="text-center flex-1 px-4">
              <h2 className="font-display text-xl font-bold tracking-wide text-[#0b5299]">
                ADITYA UNIVERSITY
              </h2>
              <p className="text-[11px] text-slate-700">
                SURAMPALEM - 533437, ANDHRA PRADESH, INDIA
              </p>
              <p className="text-xs font-bold text-slate-900 mt-1 uppercase">
                DEPARTMENT OF {activeSession.department}
              </p>
              <p className="text-xs font-bold text-black mt-0.5">
                QUESTION PAPER &amp; ANSWER BOOKLET DISPATCH SHEET (+{dispatchData.bufferPct}% BUFFER)
              </p>
            </div>
            <div className="w-14 shrink-0" />
          </div>

          <div className="text-center">
            <p className="text-xs font-bold uppercase">{activeSession.exam_title}</p>
            <p className="text-xs font-semibold mt-1">
              Date: {activeSession.exam_date} · Session: {activeSession.session_slot} (
              {activeSession.session_timing})
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase text-[#0b5299]">
              1. Floor-Wise Consolidated Stationery Summary
            </h3>
            <table className="w-full border-collapse border border-black text-xs text-center">
              <thead>
                <tr className="bg-[#eef3f9] font-bold">
                  <th className="border border-black py-2 px-3">Bhavan</th>
                  <th className="border border-black py-2 px-3">Floor</th>
                  <th className="border border-black py-2 px-3">Rooms</th>
                  <th className="border border-black py-2 px-3">Seated Candidates</th>
                  <th className="border border-black py-2 px-3">
                    QP Packets (+{dispatchData.bufferPct}%)
                  </th>
                  <th className="border border-black py-2 px-3">
                    Answer Booklets (+{dispatchData.bufferPct}%)
                  </th>
                </tr>
              </thead>
              <tbody>
                {dispatchData.floorSummaries.map((f) => (
                  <tr key={`${f.building_code}-${f.floor}`}>
                    <td className="border border-black py-2 px-3 font-semibold">{f.building_code}</td>
                    <td className="border border-black py-2 px-3">{f.floor}</td>
                    <td className="border border-black py-2 px-3 font-mono-tabular">{f.rooms_count}</td>
                    <td className="border border-black py-2 px-3 font-mono-tabular">{f.student_count}</td>
                    <td className="border border-black py-2 px-3 font-mono-tabular font-bold">
                      {f.qp_with_buffer}
                    </td>
                    <td className="border border-black py-2 px-3 font-mono-tabular font-bold">
                      {f.booklets_with_buffer}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#eef3f9] font-bold">
                  <td colSpan={2} className="border border-black py-2 px-3 text-right">
                    CONSOLIDATED TOTAL
                  </td>
                  <td className="border border-black py-2 px-3 font-mono-tabular">
                    {dispatchData.totals.rooms}
                  </td>
                  <td className="border border-black py-2 px-3 font-mono-tabular">
                    {dispatchData.totals.students}
                  </td>
                  <td className="border border-black py-2 px-3 font-mono-tabular">
                    {dispatchData.totals.qp_with_buffer}
                  </td>
                  <td className="border border-black py-2 px-3 font-mono-tabular">
                    {dispatchData.totals.booklets_with_buffer}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase text-[#0b5299]">
              2. Room-Wise &amp; Subject-Wise Packet Dispatch Count
            </h3>
            <table className="w-full border-collapse border border-black text-xs text-center">
              <thead>
                <tr className="bg-[#eef3f9] font-bold">
                  <th className="border border-black py-2 px-2">S.No</th>
                  <th className="border border-black py-2 px-2">Room No</th>
                  <th className="border border-black py-2 px-2">Floor</th>
                  <th className="border border-black py-2 px-2">Cohort</th>
                  <th className="border border-black py-2 px-3">Subject / Paper</th>
                  <th className="border border-black py-2 px-2">Seated</th>
                  <th className="border border-black py-2 px-2">
                    QP Count (+{dispatchData.bufferPct}%)
                  </th>
                  <th className="border border-black py-2 px-2">
                    Booklets (+{dispatchData.bufferPct}%)
                  </th>
                  <th className="border border-black py-2 px-3">Packet Seal Sign</th>
                </tr>
              </thead>
              <tbody>
                {dispatchData.roomRows.map((r, idx) => (
                  <tr key={`${r.room_no}-${r.cohort_label}`}>
                    <td className="border border-black py-2 px-2 font-mono-tabular">{idx + 1}</td>
                    <td className="border border-black py-2 px-2 font-mono-tabular font-semibold">
                      {r.room_no} ({r.building_code})
                    </td>
                    <td className="border border-black py-2 px-2 text-[11px]">{r.floor}</td>
                    <td className="border border-black py-2 px-2 font-semibold">{r.cohort_label}</td>
                    <td className="border border-black py-2 px-3 text-left text-[11px]">{r.subject}</td>
                    <td className="border border-black py-2 px-2 font-mono-tabular">{r.student_count}</td>
                    <td className="border border-black py-2 px-2 font-mono-tabular font-bold">
                      {r.qp_with_buffer}
                    </td>
                    <td className="border border-black py-2 px-2 font-mono-tabular font-bold">
                      {r.booklets_with_buffer}
                    </td>
                    <td className="border border-black py-2 px-3" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-14 flex items-center justify-between text-xs font-bold">
            <span>Stationery &amp; QP Dispatch In-Charge</span>
            <span>Controller / HOD</span>
          </div>
        </div>
      )}
    </div>
  );
}

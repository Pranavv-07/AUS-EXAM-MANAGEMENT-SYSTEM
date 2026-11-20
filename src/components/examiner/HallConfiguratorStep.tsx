import React, { useState } from 'react';
import { Plus, Pencil, Trash2, ArrowUpRight, X, Eye } from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import type { Hall, RoomType } from '../../types/exam.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { BenchGridVisualizer } from './BenchGridVisualizer.tsx';

interface HallConfiguratorStepProps {
  halls: Hall[];
  onRefresh: () => Promise<void>;
  onNext: () => void;
}

const BENCH_LAYOUT_OPTIONS: Array<{ label: string; pattern: number[]; type: RoomType }> = [
  { label: '3 - 2 - 3', pattern: [3, 2, 3], type: 'CLASSROOM' },
  { label: '2 - 3 - 2', pattern: [2, 3, 2], type: 'CLASSROOM' },
  { label: '3 - 3 - 3', pattern: [3, 3, 3], type: 'CLASSROOM' },
  { label: '2 - 3 - 2 - 3 - 2', pattern: [2, 3, 2, 3, 2], type: 'CLASSROOM' },
  { label: '2 - 3 - 2 - 3', pattern: [2, 3, 2, 3], type: 'CLASSROOM' },
  { label: '2 - 3', pattern: [2, 3], type: 'CLASSROOM' },
  { label: '2 - 2 - 2 - 2 (Lab)', pattern: [2, 2, 2, 2], type: 'LAB' },
];

function parsePatternInput(raw: string): number[] {
  const nums = raw
    .split(/[^0-9]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 4);
  return nums;
}

export function HallConfiguratorStep({ halls, onRefresh, onNext }: HallConfiguratorStepProps) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Hall | null>(null);
  const [buildingCode, setBuildingCode] = useState('RTB');
  const [buildingName, setBuildingName] = useState('RATAN TATA BHAVAN');
  const [floor, setFloor] = useState('II FLOOR');
  const [roomNo, setRoomNo] = useState('');
  const [roomType, setRoomType] = useState<RoomType>('CLASSROOM');
  const [gridRows, setGridRows] = useState(6);
  const [patternText, setPatternText] = useState('');
  const [previewCornersOnly, setPreviewCornersOnly] = useState(false);

  const [previewingHall, setPreviewingHall] = useState<Hall | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Hall | null>(null);

  const parsedPattern = parsePatternInput(patternText);
  const computedCols = parsedPattern.reduce((s, n) => s + n, 0);
  const computedCapacity = gridRows * computedCols;

  function openAdd() {
    setEditing(null);
    setRoomNo('');
    setBuildingCode('RTB');
    setBuildingName('RATAN TATA BHAVAN');
    setFloor('II FLOOR');
    setRoomType('CLASSROOM');
    setGridRows(6);
    setPatternText(''); // User picks their bench layout explicitly (no forced default)
    setPreviewCornersOnly(false);
    setError('');
    setShowForm(true);
  }

  function openEdit(h: Hall) {
    setEditing(h);
    setBuildingCode(h.building_code);
    setBuildingName(h.building_name);
    setFloor(h.floor);
    setRoomNo(h.room_no);
    setRoomType(h.room_type);
    setGridRows(h.grid_rows);
    setPatternText((h.bench_pattern || [3, 3, 3]).join('-'));
    setPreviewCornersOnly(false);
    setError('');
    setShowForm(true);
  }

  function selectPreset(opt: { pattern: number[]; type: RoomType }) {
    setRoomType(opt.type);
    setPatternText(opt.pattern.join('-'));
    if (opt.type === 'LAB') {
      setBuildingCode('RB');
      setBuildingName('RAMANUJAN BHAVAN');
      setGridRows(9);
    } else {
      setBuildingCode('RTB');
      setBuildingName('RATAN TATA BHAVAN');
      setGridRows(6);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (parsedPattern.length === 0) {
      setError('Please select a bench layout option or enter valid bench sizes (e.g. 3-2-3 or 2-3-2).');
      return;
    }
    setSaving(true);
    setError('');
    setStatusMsg('');
    try {
      const payload = {
        building_code: buildingCode,
        building_name: buildingName,
        floor,
        room_no: roomNo,
        room_type: roomType,
        grid_rows: gridRows,
        grid_cols: computedCols,
        bench_capacity: Math.max(...parsedPattern),
        bench_pattern: parsedPattern,
      };
      if (editing) {
        await apiFetch(`/api/halls/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setStatusMsg(`Updated room ${roomNo.toUpperCase()} (${parsedPattern.join('-')}).`);
      } else {
        await apiFetch('/api/halls', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setStatusMsg(`Saved room ${roomNo.toUpperCase()} (${parsedPattern.join('-')}).`);
      }
      setShowForm(false);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(h: Hall) {
    setError('');
    try {
      await apiFetch(`/api/halls/${h.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !h.is_active }),
      });
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function confirmDeleteHall() {
    if (!pendingDelete) return;
    setError('');
    try {
      await apiFetch(`/api/halls/${pendingDelete.id}`, { method: 'DELETE' });
      setStatusMsg(`Removed hall ${pendingDelete.room_no}.`);
      setPendingDelete(null);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
      setPendingDelete(null);
    }
  }

  const activeCapacity = halls.filter((h) => h.is_active).reduce((sum, h) => sum + h.total_capacity, 0);

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete Examination Hall"
        description={`Remove hall ${pendingDelete?.room_no} (${pendingDelete?.building_name}) from configured rooms?`}
        confirmLabel="Delete Hall"
        onConfirm={() => void confirmDeleteHall()}
        onCancel={() => setPendingDelete(null)}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white">
            02. Hall &amp; Lab Matrix Configurator
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Room / Lab</span>
          </button>
          <button
            type="button"
            onClick={onNext}
            className="flex items-center gap-1.5 px-5 py-2 min-h-[39px] text-xs font-medium bg-[#cf6c38] hover:bg-[#b85a29] text-white rounded-none cursor-pointer whitespace-nowrap"
          >
            <span>Next: Exam Schedule</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
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

      {/* Add / Edit Hall Form with Mandatory Pre-Save Layout Visualizer */}
      {showForm && (
        <form
          onSubmit={handleSave}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-5"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {editing ? `Edit Room: ${editing.room_no}` : 'Configure New Hall / Laboratory'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-slate-500 hover:text-slate-800 dark:text-slate-400 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Room Type
              </label>
              <select
                value={roomType}
                onChange={(e) => setRoomType(e.target.value as RoomType)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              >
                <option value="CLASSROOM">CLASSROOM</option>
                <option value="LAB">LAB</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Room No
              </label>
              <input
                type="text"
                required
                value={roomNo}
                onChange={(e) => setRoomNo(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Bhavan Code
              </label>
              <input
                type="text"
                required
                value={buildingCode}
                onChange={(e) => setBuildingCode(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Bhavan Name
              </label>
              <input
                type="text"
                required
                value={buildingName}
                onChange={(e) => setBuildingName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Floor
              </label>
              <input
                type="text"
                required
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              />
            </div>
          </div>

          {/* Bench Layout Selection + Rows */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Select Bench Layout Pattern (Seats per Bench Column)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-300">Rows:</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  required
                  value={gridRows}
                  onChange={(e) => setGridRows(Math.max(1, Number(e.target.value) || 1))}
                  className="w-20 px-2.5 py-1.5 text-sm font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {BENCH_LAYOUT_OPTIONS.map((opt) => {
                const key = opt.pattern.join('-');
                const active = parsedPattern.join('-') === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectPreset(opt)}
                    className={`px-3 py-1.5 text-xs font-mono-tabular border cursor-pointer ${
                      active
                        ? 'bg-[#0b5299] text-white border-[#0b5299]'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:border-[#0b5299]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Custom Bench Pattern:
              </label>
              <input
                type="text"
                value={patternText}
                onChange={(e) => setPatternText(e.target.value)}
                aria-label="Custom bench pattern e.g. 3-2-3"
                className="w-44 px-3 py-1.5 text-xs font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              />
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Separate bench seat counts with hyphens (e.g. 3-2-3 or 2-3-2-3-2)
              </span>
            </div>
          </div>

          {/* Pre-Save Live Room Layout Visualizer */}
          <div className="border border-slate-200 dark:border-slate-700 bg-[#f8f8f8] dark:bg-slate-950 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-[#0b5299] dark:text-sky-400">
                  Live Layout Preview
                </span>
                {parsedPattern.length > 0 && (
                  <span className="font-mono-tabular text-xs text-slate-700 dark:text-slate-300">
                    {gridRows} Rows × [{parsedPattern.join(' | ')}] ={' '}
                    <strong>{computedCapacity} Total Seats</strong>
                  </span>
                )}
              </div>

              {parsedPattern.some((n) => n >= 3) && (
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={previewCornersOnly}
                    onChange={(e) => setPreviewCornersOnly(e.target.checked)}
                    className="accent-[#0b5299]"
                  />
                  <span>Preview Single-Year Corner Mode (2/bench, middle empty)</span>
                </label>
              )}
            </div>

            {parsedPattern.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                Select one of the bench patterns above or enter custom bench sizes to visualize the room grid before saving.
              </p>
            ) : (
              <BenchGridVisualizer
                rows={gridRows}
                benchPattern={parsedPattern}
                roomType={roomType}
                highlightCornersOnly={previewCornersOnly}
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-5 py-2 min-h-[39px] text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 rounded-none cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || parsedPattern.length === 0}
              className="px-5 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Room Configuration'}
            </button>
          </div>
        </form>
      )}

      {/* Inline Visualizer Modal/Panel for Existing Saved Room */}
      {previewingHall && (
        <div className="bg-white dark:bg-slate-900 border border-[#0b5299] rounded-[8px] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              Room Layout Visualization —{' '}
              <span className="font-mono-tabular text-[#0b5299] dark:text-sky-400">
                {previewingHall.room_no}
              </span>{' '}
              ({previewingHall.building_name} · {previewingHall.grid_rows}×[
              {(previewingHall.bench_pattern || [3, 3, 3]).join('-')}] = {previewingHall.total_capacity}{' '}
              seats)
            </div>
            <button
              type="button"
              onClick={() => setPreviewingHall(null)}
              className="text-slate-500 hover:text-slate-800 dark:text-slate-400 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <BenchGridVisualizer
            rows={previewingHall.grid_rows}
            benchPattern={previewingHall.bench_pattern || [3, 3, 3]}
            roomType={previewingHall.room_type}
          />
        </div>
      )}

      {/* Hall Inventory Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            Configured Examination Rooms
          </span>
          <span className="font-mono-tabular text-slate-600 dark:text-slate-400">
            Active Total Capacity:{' '}
            <strong className="text-[#0b5299] dark:text-sky-400">{activeCapacity} seats</strong>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#0b5299] text-white text-xs font-medium">
                <th className="py-2.5 px-4">Room No</th>
                <th className="py-2.5 px-4">Bhavan / Floor</th>
                <th className="py-2.5 px-4">Type</th>
                <th className="py-2.5 px-4">Rows × Bench Layout</th>
                <th className="py-2.5 px-4">Total Capacity</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {halls.map((h) => (
                <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-2.5 px-4 font-mono-tabular font-semibold text-slate-900 dark:text-white">
                    {h.room_no}
                  </td>
                  <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                    {h.building_name} ({h.building_code}) · {h.floor}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-[#0b5299] dark:text-sky-400">
                    {h.room_type}
                  </td>
                  <td className="py-2.5 px-4 font-mono-tabular text-slate-700 dark:text-slate-300">
                    {h.grid_rows} rows × [{(h.bench_pattern || [3, 3, 3]).join('-')}]
                  </td>
                  <td className="py-2.5 px-4 font-mono-tabular font-semibold text-slate-900 dark:text-white">
                    {h.total_capacity}
                  </td>
                  <td className="py-2.5 px-4">
                    <span
                      className={
                        h.is_active
                          ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                          : 'text-slate-400'
                      }
                    >
                      {h.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPreviewingHall(h)}
                        title="Visualize Layout"
                        className="p-1.5 border border-slate-200 dark:border-slate-700 hover:border-[#0b5299] text-[#0b5299] dark:text-sky-400 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(h)}
                        title="Edit"
                        className="p-1.5 border border-slate-200 dark:border-slate-700 hover:border-[#0b5299] text-slate-700 dark:text-slate-300 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(h)}
                        className="px-2.5 py-1 border border-slate-200 dark:border-slate-700 hover:border-[#0b5299] text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                      >
                        {h.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(h)}
                        title="Delete"
                        className="p-1.5 border border-slate-200 dark:border-slate-700 hover:border-red-400 text-[#ff0000] cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

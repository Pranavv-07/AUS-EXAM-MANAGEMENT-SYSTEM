import type { SeatCell } from '../../types/exam.ts';

interface BenchGridVisualizerProps {
  rows: number;
  benchPattern: number[];
  roomType?: 'CLASSROOM' | 'LAB';
  cells?: SeatCell[];
  columnHeaders?: string[];
  highlightCornersOnly?: boolean;
  compact?: boolean;
}

export function BenchGridVisualizer({
  rows,
  benchPattern,
  roomType = 'CLASSROOM',
  cells,
  columnHeaders,
  highlightCornersOnly = false,
  compact = false,
}: BenchGridVisualizerProps) {
  const safePattern = benchPattern.length > 0 ? benchPattern : [3, 3, 3];
  const cellLookup = new Map<string, SeatCell>();
  if (cells) {
    for (const c of cells) {
      cellLookup.set(`${c.row_index}-${c.col_index}`, c);
    }
  }

  let runningCol = 0;

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-flex items-start gap-4 min-w-max">
        {safePattern.map((benchSize, bIdx) => {
          const benchStartCol = runningCol;
          runningCol += benchSize;

          return (
            <div
              key={bIdx}
              className="border border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-2"
            >
              <div className="text-center font-mono-tabular text-[10px] font-bold text-[#0b5299] dark:text-sky-400 pb-1.5 mb-1.5 border-b border-slate-200 dark:border-slate-700">
                {roomType === 'LAB' ? `LAB ${bIdx + 1}` : `BENCH ${bIdx + 1}`} ({benchSize})
              </div>

              {columnHeaders && columnHeaders.length > 0 && (
                <div
                  className="grid gap-1 mb-1.5"
                  style={{ gridTemplateColumns: `repeat(${benchSize}, minmax(68px, 1fr))` }}
                >
                  {Array.from({ length: benchSize }).map((_, sIdx) => {
                    const colIdx = benchStartCol + sIdx;
                    const hdr = columnHeaders[colIdx] || '-';
                    const isEmptyCol = hdr === 'EMPTY';
                    return (
                      <div
                        key={sIdx}
                        className={`text-center text-[10px] font-semibold py-1 px-1 border ${
                          isEmptyCol
                            ? 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400'
                            : 'bg-[#eef3f9] dark:bg-sky-950 border-[#0b5299]/30 dark:border-sky-800 text-[#0b5299] dark:text-sky-300'
                        }`}
                      >
                        {isEmptyCol ? 'EMPTY' : hdr}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1">
                {Array.from({ length: rows }).map((_, rIdx) => (
                  <div
                    key={rIdx}
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${benchSize}, minmax(${compact ? '46px' : '68px'}, 1fr))` }}
                  >
                    {Array.from({ length: benchSize }).map((__, sIdx) => {
                      const colNumber = benchStartCol + sIdx + 1;
                      const isMiddleDisabled =
                        highlightCornersOnly && benchSize >= 3 && sIdx > 0 && sIdx < benchSize - 1;
                      const cell = cellLookup.get(`${rIdx + 1}-${colNumber}`);
                      const isCellEmptyHeader =
                        columnHeaders && columnHeaders[colNumber - 1] === 'EMPTY';

                      if (cells) {
                        const roll = cell?.roll_no_snapshot || '';
                        return (
                          <div
                            key={sIdx}
                            className={`h-7 px-1.5 flex items-center justify-center font-mono-tabular text-[11px] border ${
                              isCellEmptyHeader
                                ? 'bg-slate-100 dark:bg-slate-900 border-dashed border-slate-300 dark:border-slate-700 text-slate-400'
                                : roll
                                  ? 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 font-semibold text-slate-900 dark:text-white'
                                  : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 text-slate-300'
                            }`}
                          >
                            {isCellEmptyHeader ? '—' : roll || ''}
                          </div>
                        );
                      }

                      return (
                        <div
                          key={sIdx}
                          className={`h-7 px-1 flex items-center justify-center font-mono-tabular text-[10px] border ${
                            isMiddleDisabled
                              ? 'bg-slate-100 dark:bg-slate-900 border-dashed border-slate-300 dark:border-slate-700 text-slate-400'
                              : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {isMiddleDisabled ? '—' : `R${rIdx + 1}·S${sIdx + 1}`}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

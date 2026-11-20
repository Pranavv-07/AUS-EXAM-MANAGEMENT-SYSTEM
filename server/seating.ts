import type {
  CapacityValidationResult,
  ExamLayoutConfig,
  ExamSession,
  Hall,
  HallAllocation,
  MasterSummaryRow,
  SeatCell,
  SeatingMode,
  Student,
} from '../src/types/exam.ts';

export function compareRollNo(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

export function yearRoman(year: number): string {
  switch (year) {
    case 1:
      return 'I';
    case 2:
      return 'II';
    case 3:
      return 'III';
    case 4:
      return 'IV';
    default:
      return String(year);
  }
}

export function resolveHallBenchPattern(hall: Hall, layoutConfig?: ExamLayoutConfig): number[] {
  const override = layoutConfig?.room_patterns?.[String(hall.id)];
  if (Array.isArray(override) && override.length > 0) {
    const validOverride = override.map((n) => Math.max(1, Math.min(4, Number(n) || 1)));
    if (validOverride.length > 0) return validOverride;
  }

  if (Array.isArray(hall.bench_pattern) && hall.bench_pattern.length > 0) {
    const sum = hall.bench_pattern.reduce((s, n) => s + n, 0);
    if (sum === hall.grid_cols) {
      return hall.bench_pattern;
    }
  }

  // Fallback derived directly from grid_cols & bench_capacity
  const cap = Math.max(1, hall.bench_capacity || 3);
  const pattern: number[] = [];
  let remaining = hall.grid_cols;
  while (remaining > 0) {
    const size = Math.min(cap, remaining);
    pattern.push(size);
    remaining -= size;
  }
  return pattern;
}

export interface ColumnMeta {
  colIndex: number; // 0-based
  benchGroup: number; // 1-based
  subSeatIndex: number; // 1-based within bench
  benchSize: number;
  isCornerSeat: boolean;
}

export function buildColumnMetadata(benchPattern: number[]): ColumnMeta[] {
  const cols: ColumnMeta[] = [];
  let colIdx = 0;
  benchPattern.forEach((benchSize, bIdx) => {
    for (let s = 1; s <= benchSize; s++) {
      // Corner seats: first and last seat of bench (if benchSize >= 2); middle seats (e.g. seat 2 of 3) are non-corner
      const isCornerSeat = benchSize === 1 || s === 1 || s === benchSize;
      cols.push({
        colIndex: colIdx++,
        benchGroup: bIdx + 1,
        subSeatIndex: s,
        benchSize,
        isCornerSeat,
      });
    }
  });
  return cols;
}

export function getCohortLabel(
  student: Pick<Student, 'branch' | 'current_year' | 'minor_stream'>,
  seatingMode: SeatingMode,
  minorFilter?: string | null
): string {
  if (seatingMode === 'MINOR_STREAM' && student.minor_stream && student.minor_stream !== 'NONE') {
    if (!minorFilter || minorFilter === 'ALL' || student.minor_stream === minorFilter) {
      return `${student.branch}-${yearRoman(student.current_year)} (${student.minor_stream})`;
    }
  }
  return `${student.branch}-${yearRoman(student.current_year)}`;
}

/**
 * Determines which cohort index (0 = Primary, 1 = Secondary) owns each vertical column under INTERLEAVED mode,
 * respecting the room's physical bench_pattern and chosen interleave_style.
 */
export function getInterleavedColumnCohortIndices(
  hall: Hall,
  layoutConfig?: ExamLayoutConfig
): number[] {
  const benchPattern = resolveHallBenchPattern(hall, layoutConfig);
  const meta = buildColumnMetadata(benchPattern);
  const style = layoutConfig?.interleave_style;

  // Explicit BENCH_BLOCKS: alternate Cohort 0 and Cohort 1 by entire bench group (e.g. 3-2-3 or 2-3-2)
  if (style === 'BENCH_BLOCKS') {
    return meta.map((m) => (m.benchGroup - 1) % 2);
  }

  // Explicit PAIRED_COLUMNS or Labs: [0, 1, 0, 1, ...]
  if (style === 'PAIRED_COLUMNS' || (hall.room_type === 'LAB' && style !== 'ALTERNATE_SEATS')) {
    return meta.map((m) => m.colIndex % 2);
  }

  // Standard ALTERNATE_SEATS respecting bench boundaries:
  // Bench 1 (odd benchGroup): [0, 1, 0] (for size 3) or [0, 1] (for size 2)
  // Bench 2 (even benchGroup): [1, 0, 1] (for size 3) or [1, 0] (for size 2)
  return meta.map((m) => {
    const startWith = (m.benchGroup - 1) % 2;
    return (startWith + (m.subSeatIndex - 1)) % 2;
  });
}

export function computeHallCohortCapacities(
  hall: Hall,
  seatingMode: SeatingMode,
  numCohorts: number,
  layoutConfig?: ExamLayoutConfig
): { primarySeats: number; secondarySeats: number } {
  const benchPattern = resolveHallBenchPattern(hall, layoutConfig);
  const meta = buildColumnMetadata(benchPattern);

  if (seatingMode === 'SINGLE_YEAR_CORNERS') {
    const activeCornerCols = meta.filter((m) => m.isCornerSeat).length;
    return {
      primarySeats: activeCornerCols * hall.grid_rows,
      secondarySeats: 0,
    };
  }

  if (seatingMode !== 'INTERLEAVED' || numCohorts < 2) {
    return { primarySeats: meta.length * hall.grid_rows, secondarySeats: 0 };
  }

  const pattern = getInterleavedColumnCohortIndices(hall, layoutConfig);
  let primaryCols = 0;
  let secondaryCols = 0;
  for (const idx of pattern) {
    if (idx === 0) primaryCols++;
    else secondaryCols++;
  }
  return {
    primarySeats: primaryCols * hall.grid_rows,
    secondarySeats: secondaryCols * hall.grid_rows,
  };
}

export function groupStudentsIntoCohorts(
  students: Student[],
  targetYears: number[],
  targetBranches: string[],
  seatingMode: SeatingMode,
  minorStreamFilter: string | null
): Array<{ label: string; students: Student[] }> {
  const eligible = students
    .filter((s) => !s.is_detained)
    .filter((s) => (targetYears.length === 0 ? true : targetYears.includes(s.current_year)))
    .filter((s) => (targetBranches.length === 0 ? true : targetBranches.includes(s.branch)))
    .filter((s) => {
      if (seatingMode !== 'MINOR_STREAM') return true;
      if (!minorStreamFilter || minorStreamFilter === 'ALL') {
        return s.minor_stream !== 'NONE' && s.minor_stream !== '';
      }
      return s.minor_stream.toLowerCase() === minorStreamFilter.toLowerCase();
    })
    .sort((a, b) => compareRollNo(a.roll_no, b.roll_no));

  if (seatingMode === 'SEQUENTIAL' || seatingMode === 'SINGLE_YEAR_CORNERS') {
    const yearsStr = targetYears.map(yearRoman).join('/');
    const branchesStr = targetBranches.join('/');
    const label =
      targetYears.length === 1 && targetBranches.length === 1
        ? `${targetBranches[0]}-${yearRoman(targetYears[0])}`
        : [branchesStr, yearsStr].filter(Boolean).join('-') || 'COHORT';
    return eligible.length > 0 ? [{ label, students: eligible }] : [];
  }

  // Group by (year desc, branch asc)
  const map = new Map<string, Student[]>();
  const sortedYears = [...new Set(eligible.map((s) => s.current_year))].sort((a, b) => b - a);

  for (const yr of sortedYears) {
    const yrStudents = eligible.filter((s) => s.current_year === yr);
    const branches = [...new Set(yrStudents.map((s) => s.branch))].sort();
    for (const br of branches) {
      const group = yrStudents
        .filter((s) => s.branch === br)
        .sort((a, b) => compareRollNo(a.roll_no, b.roll_no));
      const label =
        seatingMode === 'MINOR_STREAM' && minorStreamFilter && minorStreamFilter !== 'ALL'
          ? `${br}-${yearRoman(yr)} (${minorStreamFilter})`
          : `${br}-${yearRoman(yr)}`;
      map.set(label, group);
    }
  }

  return Array.from(map.entries()).map(([label, list]) => ({ label, students: list }));
}

export function validateSessionCapacity(
  students: Student[],
  halls: Hall[],
  targetYears: number[],
  targetBranches: string[],
  seatingMode: SeatingMode,
  minorStreamFilter: string | null,
  layoutConfig?: ExamLayoutConfig
): CapacityValidationResult {
  const cohorts = groupStudentsIntoCohorts(
    students,
    targetYears,
    targetBranches,
    seatingMode,
    minorStreamFilter
  );

  const totalStudents = cohorts.reduce((acc, c) => acc + c.students.length, 0);

  let usableCapacity = 0;
  for (const h of halls) {
    const cap = computeHallCohortCapacities(h, seatingMode, cohorts.length, layoutConfig);
    usableCapacity += cap.primarySeats + cap.secondarySeats;
  }

  if (halls.length === 0) {
    return {
      valid: false,
      total_students: totalStudents,
      total_capacity: 0,
      cohort_breakdown: cohorts.map((c) => ({
        cohort_label: c.label,
        student_count: c.students.length,
        available_seats: 0,
        deficit: c.students.length,
      })),
      message: 'Select at least one examination hall or laboratory to validate capacity.',
    };
  }

  if (totalStudents === 0) {
    return {
      valid: false,
      total_students: 0,
      total_capacity: usableCapacity,
      cohort_breakdown: [],
      message: 'No eligible active students match the selected years, branches, or minor stream filter.',
    };
  }

  if (seatingMode === 'INTERLEAVED' && cohorts.length >= 2) {
    let primarySeats = 0;
    let secondarySeats = 0;
    for (const h of halls) {
      const cap = computeHallCohortCapacities(h, seatingMode, cohorts.length, layoutConfig);
      primarySeats += cap.primarySeats;
      secondarySeats += cap.secondarySeats;
    }

    const c0 = cohorts[0];
    const c1Count = cohorts.slice(1).reduce((acc, c) => acc + c.students.length, 0);
    const c1Label = cohorts.slice(1).map((c) => c.label).join(' + ');

    const def0 = Math.max(0, c0.students.length - primarySeats);
    const def1 = Math.max(0, c1Count - secondarySeats);

    const breakdown = [
      {
        cohort_label: c0.label,
        student_count: c0.students.length,
        available_seats: primarySeats,
        deficit: def0,
      },
      {
        cohort_label: c1Label,
        student_count: c1Count,
        available_seats: secondarySeats,
        deficit: def1,
      },
    ];

    const valid = def0 === 0 && def1 === 0;
    return {
      valid,
      total_students: totalStudents,
      total_capacity: usableCapacity,
      cohort_breakdown: breakdown,
      message: valid
        ? `Capacity validated: ${totalStudents} students fit cleanly across ${halls.length} rooms (${usableCapacity} usable seats).`
        : `Insufficient interleaved seats: ${def0 > 0 ? `${def0} ${c0.label} seats short` : ''}${def0 > 0 && def1 > 0 ? '; ' : ''}${def1 > 0 ? `${def1} ${c1Label} seats short` : ''}. Add more halls.`,
    };
  }

  const valid = usableCapacity >= totalStudents;
  return {
    valid,
    total_students: totalStudents,
    total_capacity: usableCapacity,
    cohort_breakdown: cohorts.map((c) => ({
      cohort_label: c.label,
      student_count: c.students.length,
      available_seats: usableCapacity,
      deficit: Math.max(0, c.students.length - usableCapacity),
    })),
    message: valid
      ? seatingMode === 'SINGLE_YEAR_CORNERS'
        ? `Corner-only capacity validated: ${totalStudents} students fit with middle seats empty (${usableCapacity} corner seats across ${halls.length} rooms).`
        : `Capacity validated: ${totalStudents} students ready across ${halls.length} halls (${usableCapacity} seats available).`
      : `Capacity shortfall: ${totalStudents - usableCapacity} additional seats required.`,
  };
}

export interface ComputedRoomAllocation {
  hall: Hall;
  sort_order: number;
  allocated_count: number;
  column_headers: string[];
  cells: SeatCell[];
  cohort_counts: Record<string, number>;
}

/**
 * Runs deterministic vertical-column seating allocation across ordered halls,
 * supporting Single-Year Corners (2 per bench, middle empty), Interleaved, Sequential, and Minor Stream.
 */
export function allocateSeatingMatrices(
  students: Student[],
  halls: Hall[],
  targetYears: number[],
  targetBranches: string[],
  seatingMode: SeatingMode,
  minorStreamFilter: string | null,
  layoutConfig?: ExamLayoutConfig
): ComputedRoomAllocation[] {
  const cohorts = groupStudentsIntoCohorts(
    students,
    targetYears,
    targetBranches,
    seatingMode,
    minorStreamFilter
  );

  const results: ComputedRoomAllocation[] = [];
  if (cohorts.length === 0) return results;

  if (seatingMode === 'INTERLEAVED' && cohorts.length >= 2) {
    const primaryCohort = cohorts[0];
    const primaryQueue = [...primaryCohort.students];

    const secondaryCohortLabel = cohorts.slice(1).map((c) => c.label).join('/');
    const secondaryQueue: Array<{ student: Student; label: string }> = [];
    for (const c of cohorts.slice(1)) {
      for (const st of c.students) {
        secondaryQueue.push({ student: st, label: c.label });
      }
    }

    let pIdx = 0;
    let sIdx = 0;

    for (let hIdx = 0; hIdx < halls.length; hIdx++) {
      const baseHall = halls[hIdx];
      if (pIdx >= primaryQueue.length && sIdx >= secondaryQueue.length) break;

      const benchPattern = resolveHallBenchPattern(baseHall, layoutConfig);
      const colMeta = buildColumnMetadata(benchPattern);
      const effectiveCols = colMeta.length;
      const hall: Hall = {
        ...baseHall,
        bench_pattern: benchPattern,
        grid_cols: effectiveCols,
        total_capacity: baseHall.grid_rows * effectiveCols,
      };

      const colOwnership = getInterleavedColumnCohortIndices(hall, layoutConfig);
      const columnHeaders: string[] = [];
      const cells: SeatCell[] = [];
      const cohortCounts: Record<string, number> = {};
      let allocatedCount = 0;

      const grid: Array<Array<SeatCell | null>> = Array.from({ length: hall.grid_rows }, () =>
        Array.from({ length: effectiveCols }, () => null)
      );

      for (let c = 0; c < effectiveCols; c++) {
        const meta = colMeta[c];
        const ownerIdx = colOwnership[c];
        let colLabel = ownerIdx === 0 ? primaryCohort.label : secondaryCohortLabel;
        const firstInColLabel = colLabel;

        for (let r = 0; r < hall.grid_rows; r++) {
          let assignedStudent: Student | null = null;
          let assignedLabel = firstInColLabel;

          if (ownerIdx === 0 && pIdx < primaryQueue.length) {
            assignedStudent = primaryQueue[pIdx++];
            assignedLabel = primaryCohort.label;
          } else if (ownerIdx !== 0 && sIdx < secondaryQueue.length) {
            const item = secondaryQueue[sIdx++];
            assignedStudent = item.student;
            assignedLabel = item.label;
            if (r === 0) colLabel = item.label;
          }

          if (assignedStudent) {
            allocatedCount++;
            cohortCounts[assignedLabel] = (cohortCounts[assignedLabel] || 0) + 1;
          }

          grid[r][c] = {
            row_index: r + 1,
            col_index: c + 1,
            bench_group: meta.benchGroup,
            sub_seat_index: meta.subSeatIndex,
            cohort_label: assignedStudent ? assignedLabel : colLabel,
            student_id: assignedStudent ? assignedStudent.id : null,
            roll_no_snapshot: assignedStudent ? assignedStudent.roll_no : null,
          };
        }
        columnHeaders.push(colLabel);
      }

      for (let r = 0; r < hall.grid_rows; r++) {
        for (let c = 0; c < effectiveCols; c++) {
          const cell = grid[r][c];
          if (cell) cells.push(cell);
        }
      }

      results.push({
        hall,
        sort_order: hIdx + 1,
        allocated_count: allocatedCount,
        column_headers: columnHeaders,
        cells,
        cohort_counts: cohortCounts,
      });
    }

    return results;
  }

  // SINGLE_YEAR_CORNERS, SEQUENTIAL, or MINOR_STREAM vertical column fill
  const flatQueue: Array<{ student: Student; label: string }> = [];
  for (const c of cohorts) {
    for (const st of c.students) {
      flatQueue.push({
        student: st,
        label: getCohortLabel(st, seatingMode, minorStreamFilter),
      });
    }
  }

  let qIdx = 0;
  for (let hIdx = 0; hIdx < halls.length; hIdx++) {
    const baseHall = halls[hIdx];
    if (qIdx >= flatQueue.length) break;

    const benchPattern = resolveHallBenchPattern(baseHall, layoutConfig);
    const colMeta = buildColumnMetadata(benchPattern);
    const effectiveCols = colMeta.length;
    const hall: Hall = {
      ...baseHall,
      bench_pattern: benchPattern,
      grid_cols: effectiveCols,
      total_capacity: baseHall.grid_rows * effectiveCols,
    };

    const columnHeaders: string[] = [];
    const cells: SeatCell[] = [];
    const cohortCounts: Record<string, number> = {};
    let allocatedCount = 0;

    const grid: Array<Array<SeatCell | null>> = Array.from({ length: hall.grid_rows }, () =>
      Array.from({ length: effectiveCols }, () => null)
    );

    for (let c = 0; c < effectiveCols; c++) {
      const meta = colMeta[c];
      const skipMiddleSeat = seatingMode === 'SINGLE_YEAR_CORNERS' && !meta.isCornerSeat;
      let colHeaderLabel = skipMiddleSeat ? 'EMPTY' : '-';

      for (let r = 0; r < hall.grid_rows; r++) {
        let assigned: { student: Student; label: string } | null = null;
        if (!skipMiddleSeat && qIdx < flatQueue.length) {
          assigned = flatQueue[qIdx++];
          if (r === 0 || colHeaderLabel === '-') {
            colHeaderLabel = assigned.label;
          }
          allocatedCount++;
          cohortCounts[assigned.label] = (cohortCounts[assigned.label] || 0) + 1;
        }

        grid[r][c] = {
          row_index: r + 1,
          col_index: c + 1,
          bench_group: meta.benchGroup,
          sub_seat_index: meta.subSeatIndex,
          cohort_label: skipMiddleSeat ? 'EMPTY' : assigned ? assigned.label : colHeaderLabel,
          student_id: assigned ? assigned.student.id : null,
          roll_no_snapshot: assigned ? assigned.student.roll_no : null,
        };
      }

      columnHeaders.push(skipMiddleSeat ? 'EMPTY' : colHeaderLabel === '-' ? cohorts[0].label : colHeaderLabel);
    }

    for (let r = 0; r < hall.grid_rows; r++) {
      for (let c = 0; c < effectiveCols; c++) {
        const cell = grid[r][c];
        if (cell) cells.push(cell);
      }
    }

    results.push({
      hall,
      sort_order: hIdx + 1,
      allocated_count: allocatedCount,
      column_headers: columnHeaders,
      cells,
      cohort_counts: cohortCounts,
    });
  }

  return results;
}

export function buildMasterSummaryRows(
  session: ExamSession,
  allocations: HallAllocation[]
): MasterSummaryRow[] {
  const rows: MasterSummaryRow[] = [];
  let sno = 1;

  for (const alloc of allocations) {
    const byCohort = new Map<string, string[]>();
    for (const cell of alloc.cells) {
      if (cell.roll_no_snapshot) {
        const list = byCohort.get(cell.cohort_label) || [];
        list.push(cell.roll_no_snapshot);
        byCohort.set(cell.cohort_label, list);
      }
    }

    for (const [cohortLabel, rolls] of byCohort.entries()) {
      const sorted = [...rolls].sort(compareRollNo);
      const subject =
        session.subject_mapping[cohortLabel] ||
        session.subject_mapping[cohortLabel.split(' ')[0]] ||
        session.subject_mapping[`YEAR_${cohortLabel.split('-')[1]?.replace(/[^IV]/g, '') || ''}`] ||
        Object.values(session.subject_mapping)[0] ||
        'Regular Examination';

      rows.push({
        sno: sno++,
        branch_floor_key: `${cohortLabel} / ${alloc.hall.floor}`,
        branch_label: cohortLabel,
        floor_label: alloc.hall.floor,
        roll_from: sorted[0] || '-',
        roll_to: sorted[sorted.length - 1] || '-',
        subject,
        room_no: alloc.hall.room_no,
        building_code: alloc.hall.building_code,
        building_name: alloc.hall.building_name,
        total: sorted.length,
      });
    }
  }

  rows.sort((a, b) => {
    const cmp = a.branch_floor_key.localeCompare(b.branch_floor_key);
    if (cmp !== 0) return cmp;
    return compareRollNo(a.roll_from, b.roll_from);
  });

  for (let i = 0; i < rows.length; i++) {
    rows[i].sno = i + 1;
    if (i > 0 && rows[i].branch_floor_key === rows[i - 1].branch_floor_key) {
      rows[i].row_span = 0;
    } else {
      let span = 1;
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[j].branch_floor_key === rows[i].branch_floor_key) span++;
        else break;
      }
      rows[i].row_span = span;
    }
  }

  return rows;
}

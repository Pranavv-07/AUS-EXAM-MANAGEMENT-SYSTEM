import type {
  CapacityValidationResult,
  CourseEligibilityRecord,
  DispatchFloorSummary,
  DispatchRoomRow,
  ExamLayoutConfig,
  ExamSession,
  ExcludedStudentInfo,
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

export function isGroundFloor(floor: string): boolean {
  const f = (floor || '').trim().toUpperCase();
  return (
    f.includes('GROUND') ||
    f === 'GF' ||
    f === 'G' ||
    f.startsWith('G ') ||
    f === 'FLOOR 0' ||
    f === '0 FLOOR' ||
    f === '0'
  );
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
 * Determines which cohort index (0 = Primary, 1 = Secondary) owns each vertical column under INTERLEAVED mode.
 */
export function getInterleavedColumnCohortIndices(
  hall: Hall,
  layoutConfig?: ExamLayoutConfig
): number[] {
  const benchPattern = resolveHallBenchPattern(hall, layoutConfig);
  const meta = buildColumnMetadata(benchPattern);
  const style = layoutConfig?.interleave_style;

  if (style === 'BENCH_BLOCKS') {
    return meta.map((m) => (m.benchGroup - 1) % 2);
  }

  if (style === 'PAIRED_COLUMNS' || (hall.room_type === 'LAB' && style !== 'ALTERNATE_SEATS')) {
    return meta.map((m) => m.colIndex % 2);
  }

  return meta.map((m) => {
    const startWith = (m.benchGroup - 1) % 2;
    return (startWith + (m.subSeatIndex - 1)) % 2;
  });
}

interface HallUsablePlan {
  benchPattern: number[];
  colMeta: ColumnMeta[];
  effectiveCols: number;
  colOwnership: number[]; // 0 or 1 for interleaved; 0 for others; -1 for corner middle empty
  bufferCoordSet: Set<string>; // `${r0}-${c0}` 0-based coordinates reserved for buffer seats
  primarySeats: number;
  secondarySeats: number;
  bufferReserved: number;
}

export function buildHallUsablePlan(
  hall: Hall,
  seatingMode: SeatingMode,
  numCohorts: number,
  layoutConfig?: ExamLayoutConfig
): HallUsablePlan {
  const benchPattern = resolveHallBenchPattern(hall, layoutConfig);
  const colMeta = buildColumnMetadata(benchPattern);
  const effectiveCols = colMeta.length;
  const normalizedHall: Hall = {
    ...hall,
    bench_pattern: benchPattern,
    grid_cols: effectiveCols,
  };

  let colOwnership: number[];
  if (seatingMode === 'SINGLE_YEAR_CORNERS') {
    colOwnership = colMeta.map((m) => (m.isCornerSeat ? 0 : -1));
  } else if (seatingMode === 'INTERLEAVED' && numCohorts >= 2) {
    colOwnership = getInterleavedColumnCohortIndices(normalizedHall, layoutConfig);
  } else {
    colOwnership = colMeta.map(() => 0);
  }

  const usableSlots: Array<{ r0: number; c0: number; owner: number }> = [];
  for (let c0 = 0; c0 < effectiveCols; c0++) {
    const owner = colOwnership[c0];
    if (owner === -1) continue;
    for (let r0 = 0; r0 < hall.grid_rows; r0++) {
      usableSlots.push({ r0, c0, owner });
    }
  }

  const requestedBuffer = Math.max(0, Math.min(4, Number(layoutConfig?.buffer_seats_per_hall) || 0));
  const maxBuffer = Math.max(0, usableSlots.length - 1);
  const bufferReserved = Math.min(requestedBuffer, maxBuffer);

  const bufferCoordSet = new Set<string>();
  if (bufferReserved > 0) {
    // Pick bottom-most cells from right-most columns (trying to balance primary & secondary if interleaved)
    if (seatingMode === 'INTERLEAVED' && numCohorts >= 2 && bufferReserved >= 2) {
      const revPrimary = usableSlots.filter((s) => s.owner === 0).reverse();
      const revSecondary = usableSlots.filter((s) => s.owner === 1).reverse();
      let pPick = 0;
      let sPick = 0;
      for (let i = 0; i < bufferReserved; i++) {
        if (i % 2 === 0 && pPick < revPrimary.length) {
          const s = revPrimary[pPick++];
          bufferCoordSet.add(`${s.r0}-${s.c0}`);
        } else if (sPick < revSecondary.length) {
          const s = revSecondary[sPick++];
          bufferCoordSet.add(`${s.r0}-${s.c0}`);
        } else if (pPick < revPrimary.length) {
          const s = revPrimary[pPick++];
          bufferCoordSet.add(`${s.r0}-${s.c0}`);
        }
      }
    } else {
      const tail = usableSlots.slice(-bufferReserved);
      for (const s of tail) {
        bufferCoordSet.add(`${s.r0}-${s.c0}`);
      }
    }
  }

  let primarySeats = 0;
  let secondarySeats = 0;
  for (const s of usableSlots) {
    if (bufferCoordSet.has(`${s.r0}-${s.c0}`)) continue;
    if (s.owner === 0) primarySeats++;
    else if (s.owner === 1) secondarySeats++;
  }

  return {
    benchPattern,
    colMeta,
    effectiveCols,
    colOwnership,
    bufferCoordSet,
    primarySeats,
    secondarySeats,
    bufferReserved: bufferCoordSet.size,
  };
}

export function computeHallCohortCapacities(
  hall: Hall,
  seatingMode: SeatingMode,
  numCohorts: number,
  layoutConfig?: ExamLayoutConfig
): { primarySeats: number; secondarySeats: number; bufferReserved: number } {
  const plan = buildHallUsablePlan(hall, seatingMode, numCohorts, layoutConfig);
  return {
    primarySeats: plan.primarySeats,
    secondarySeats: plan.secondarySeats,
    bufferReserved: plan.bufferReserved,
  };
}

export interface SessionFilterResult {
  eligibleStudents: Student[];
  excludedStudents: ExcludedStudentInfo[];
  excludedCount: number;
  holdCount: number;
}

/**
 * Evaluates student eligibility dynamically:
 * 1) Course-specific eligibility overrides (Roll No + Course Code) take priority when sessionCourseCodes match.
 * 2) SUPPLEMENTARY / re-registered records for matching session course codes include the student even if regular cohort differs.
 * 3) Global eligibility_status (DETAINED / CONDONATION_PENDING) filters remaining students without deleting master records.
 */
export function filterStudentsForSession(params: {
  students: Student[];
  courseEligibility?: CourseEligibilityRecord[];
  sessionCourseCodes?: string[];
  targetYears: number[];
  targetBranches: string[];
  seatingMode: SeatingMode;
  minorStreamFilter: string | null;
  layoutConfig?: ExamLayoutConfig;
}): SessionFilterResult {
  const {
    students,
    courseEligibility = [],
    sessionCourseCodes = [],
    targetYears,
    targetBranches,
    seatingMode,
    minorStreamFilter,
    layoutConfig,
  } = params;

  const upperSessionCodes = new Set(
    sessionCourseCodes.map((c) => c.trim().toUpperCase()).filter(Boolean)
  );
  const pinnedRolls = new Set(
    (layoutConfig?.pinned_students || []).map((p) => p.roll_no.trim().toUpperCase())
  );

  // Map roll_no -> course_eligibility records for this session's course codes
  const courseRulesByRoll = new Map<string, CourseEligibilityRecord[]>();
  if (upperSessionCodes.size > 0) {
    for (const rec of courseEligibility) {
      const code = rec.course_code.trim().toUpperCase();
      if (!upperSessionCodes.has(code)) continue;
      const roll = rec.roll_no.trim().toUpperCase();
      const list = courseRulesByRoll.get(roll) || [];
      list.push(rec);
      courseRulesByRoll.set(roll, list);
    }
  }

  const eligibleStudents: Student[] = [];
  const excludedStudents: ExcludedStudentInfo[] = [];

  for (const s of students) {
    const rollUpper = s.roll_no.trim().toUpperCase();
    const matchingCourseRules = courseRulesByRoll.get(rollUpper) || [];
    const hasSuppOrExplicitCourseEligible = matchingCourseRules.some(
      (r) => r.status === 'SUPPLEMENTARY' || r.status === 'ELIGIBLE'
    );
    const isPinned = pinnedRolls.has(rollUpper);

    const matchesYear = targetYears.length === 0 || targetYears.includes(s.current_year);
    const matchesBranch = targetBranches.length === 0 || targetBranches.includes(s.branch);
    const matchesMinor =
      seatingMode !== 'MINOR_STREAM'
        ? true
        : !minorStreamFilter || minorStreamFilter === 'ALL'
          ? s.minor_stream !== 'NONE' && s.minor_stream !== ''
          : s.minor_stream.toLowerCase() === minorStreamFilter.toLowerCase();

    const inCohort = matchesYear && matchesBranch && matchesMinor;

    // Candidate if in cohort, or explicitly mapped as SUPPLEMENTARY/ELIGIBLE for a scheduled course, or explicitly pinned
    if (!inCohort && !hasSuppOrExplicitCourseEligible && !isPinned) {
      continue;
    }

    // Precedence 1: Course-Specific Eligibility Rules for this session's courses
    if (matchingCourseRules.length > 0) {
      if (hasSuppOrExplicitCourseEligible) {
        eligibleStudents.push(s);
        continue;
      }

      const condonationRule = matchingCourseRules.find((r) => r.status === 'CONDONATION_PENDING');
      const detainedRule = matchingCourseRules.find((r) => r.status === 'DETAINED');

      if (condonationRule && !detainedRule) {
        excludedStudents.push({
          roll_no: s.roll_no,
          full_name: s.full_name,
          branch: s.branch,
          current_year: s.current_year,
          reason: 'CONDONATION_PENDING',
          course_code: condonationRule.course_code,
        });
        continue;
      }

      if (detainedRule) {
        excludedStudents.push({
          roll_no: s.roll_no,
          full_name: s.full_name,
          branch: s.branch,
          current_year: s.current_year,
          reason: 'DETAINED_COURSE',
          course_code: detainedRule.course_code,
        });
        continue;
      }
    }

    // Precedence 2: Global eligibility status (unless explicitly pinned)
    const effectiveStatus =
      s.eligibility_status || (s.is_detained ? 'DETAINED' : 'ELIGIBLE');

    if (effectiveStatus === 'CONDONATION_PENDING' && !isPinned) {
      excludedStudents.push({
        roll_no: s.roll_no,
        full_name: s.full_name,
        branch: s.branch,
        current_year: s.current_year,
        reason: 'CONDONATION_PENDING',
      });
      continue;
    }

    if ((effectiveStatus === 'DETAINED' || s.is_detained) && !isPinned) {
      excludedStudents.push({
        roll_no: s.roll_no,
        full_name: s.full_name,
        branch: s.branch,
        current_year: s.current_year,
        reason: 'DETAINED_GLOBAL',
      });
      continue;
    }

    eligibleStudents.push(s);
  }

  eligibleStudents.sort((a, b) => compareRollNo(a.roll_no, b.roll_no));
  excludedStudents.sort((a, b) => compareRollNo(a.roll_no, b.roll_no));

  return {
    eligibleStudents,
    excludedStudents,
    excludedCount: excludedStudents.length,
    holdCount: excludedStudents.filter((e) => e.reason === 'CONDONATION_PENDING').length,
  };
}

export function groupStudentsIntoCohorts(
  students: Student[],
  targetYears: number[],
  targetBranches: string[],
  seatingMode: SeatingMode,
  minorStreamFilter: string | null,
  alreadyFiltered = false
): Array<{ label: string; students: Student[] }> {
  const eligible = alreadyFiltered
    ? [...students].sort((a, b) => compareRollNo(a.roll_no, b.roll_no))
    : students
        .filter(
          (s) =>
            !s.is_detained &&
            s.eligibility_status !== 'DETAINED' &&
            s.eligibility_status !== 'CONDONATION_PENDING'
        )
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
  layoutConfig?: ExamLayoutConfig,
  courseEligibility?: CourseEligibilityRecord[],
  sessionCourseCodes?: string[]
): CapacityValidationResult {
  const filtered = filterStudentsForSession({
    students,
    courseEligibility,
    sessionCourseCodes,
    targetYears,
    targetBranches,
    seatingMode,
    minorStreamFilter,
    layoutConfig,
  });

  const cohorts = groupStudentsIntoCohorts(
    filtered.eligibleStudents,
    targetYears,
    targetBranches,
    seatingMode,
    minorStreamFilter,
    true
  );

  const totalStudents = cohorts.reduce((acc, c) => acc + c.students.length, 0);

  let usableCapacity = 0;
  let totalBufferReserved = 0;
  for (const h of halls) {
    const cap = computeHallCohortCapacities(h, seatingMode, cohorts.length, layoutConfig);
    usableCapacity += cap.primarySeats + cap.secondarySeats;
    totalBufferReserved += cap.bufferReserved;
  }

  if (halls.length === 0) {
    return {
      valid: false,
      total_students: totalStudents,
      total_capacity: 0,
      buffer_seats_reserved: 0,
      excluded_count: filtered.excludedCount,
      hold_count: filtered.holdCount,
      excluded_students: filtered.excludedStudents,
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
      buffer_seats_reserved: totalBufferReserved,
      excluded_count: filtered.excludedCount,
      hold_count: filtered.holdCount,
      excluded_students: filtered.excludedStudents,
      cohort_breakdown: [],
      message:
        filtered.excludedCount > 0
          ? `0 eligible students (${filtered.excludedCount} detained / on condonation hold).`
          : 'No eligible active students match the selected years, branches, or minor stream filter.',
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
      buffer_seats_reserved: totalBufferReserved,
      excluded_count: filtered.excludedCount,
      hold_count: filtered.holdCount,
      excluded_students: filtered.excludedStudents,
      cohort_breakdown: breakdown,
      message: valid
        ? `Capacity validated: ${totalStudents} eligible students fit across ${halls.length} rooms (${usableCapacity} assignable + ${totalBufferReserved} buffer seats reserved).`
        : `Insufficient interleaved seats: ${def0 > 0 ? `${def0} ${c0.label} seats short` : ''}${def0 > 0 && def1 > 0 ? '; ' : ''}${def1 > 0 ? `${def1} ${c1Label} seats short` : ''}. Add more halls.`,
    };
  }

  const valid = usableCapacity >= totalStudents;
  return {
    valid,
    total_students: totalStudents,
    total_capacity: usableCapacity,
    buffer_seats_reserved: totalBufferReserved,
    excluded_count: filtered.excludedCount,
    hold_count: filtered.holdCount,
    excluded_students: filtered.excludedStudents,
    cohort_breakdown: cohorts.map((c) => ({
      cohort_label: c.label,
      student_count: c.students.length,
      available_seats: usableCapacity,
      deficit: Math.max(0, c.students.length - usableCapacity),
    })),
    message: valid
      ? seatingMode === 'SINGLE_YEAR_CORNERS'
        ? `Corner-only capacity validated: ${totalStudents} students fit with middle seats empty (${usableCapacity} corner seats + ${totalBufferReserved} buffer seats).`
        : `Capacity validated: ${totalStudents} eligible students ready across ${halls.length} halls (${usableCapacity} seats + ${totalBufferReserved} buffer).`
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
 * supporting:
 * - Course-specific & global eligibility filtering + Condonation Hold exclusion
 * - Pinned students forced into designated hall_id first
 * - PwD (is_pwd) Ground-Floor priority placement
 * - Per-room buffer seat reservation (BUFFER cells left open at tail of room)
 * - Single-Year Corners, Interleaved, Sequential, and Minor Stream strategies
 */
export function allocateSeatingMatrices(
  students: Student[],
  halls: Hall[],
  targetYears: number[],
  targetBranches: string[],
  seatingMode: SeatingMode,
  minorStreamFilter: string | null,
  layoutConfig?: ExamLayoutConfig,
  courseEligibility?: CourseEligibilityRecord[],
  sessionCourseCodes?: string[]
): ComputedRoomAllocation[] {
  const filtered = filterStudentsForSession({
    students,
    courseEligibility,
    sessionCourseCodes,
    targetYears,
    targetBranches,
    seatingMode,
    minorStreamFilter,
    layoutConfig,
  });

  const cohorts = groupStudentsIntoCohorts(
    filtered.eligibleStudents,
    targetYears,
    targetBranches,
    seatingMode,
    minorStreamFilter,
    true
  );

  const results: ComputedRoomAllocation[] = [];
  if (cohorts.length === 0) return results;

  // Build lookup of cohort group index (0 = Primary, 1+ = Secondary in interleaved) and cohort label for every student
  const studentMeta = new Map<number, { cohortIdx: number; label: string }>();
  cohorts.forEach((c, cIdx) => {
    for (const st of c.students) {
      studentMeta.set(st.id, {
        cohortIdx: cIdx === 0 ? 0 : 1,
        label: getCohortLabel(st, seatingMode, minorStreamFilter),
      });
    }
  });

  // Identify pre-assigned students per hall:
  // 1) Explicit Pinned Students (`layoutConfig.pinned_students`)
  // 2) PwD Students (`is_pwd`) routed to Ground Floor halls when Ground Floor halls are among selected halls
  const preAssignedIds = new Set<number>();
  const pinnedByHall = new Map<number, Student[]>();
  const validHallIds = new Set(halls.map((h) => h.id));

  for (const pin of layoutConfig?.pinned_students || []) {
    const roll = pin.roll_no.trim().toUpperCase();
    const st = filtered.eligibleStudents.find((s) => s.roll_no.trim().toUpperCase() === roll);
    if (st && validHallIds.has(pin.hall_id) && !preAssignedIds.has(st.id)) {
      const list = pinnedByHall.get(pin.hall_id) || [];
      list.push(st);
      pinnedByHall.set(pin.hall_id, list);
      preAssignedIds.add(st.id);
    }
  }

  const groundFloorHalls = halls.filter((h) => isGroundFloor(h.floor));
  if (groundFloorHalls.length > 0) {
    const pwdStudents = filtered.eligibleStudents.filter(
      (s) => s.is_pwd && !preAssignedIds.has(s.id)
    );
    let gfIdx = 0;
    for (const st of pwdStudents) {
      const targetHall = groundFloorHalls[gfIdx % groundFloorHalls.length];
      gfIdx++;
      const list = pinnedByHall.get(targetHall.id) || [];
      list.push(st);
      pinnedByHall.set(targetHall.id, list);
      preAssignedIds.add(st.id);
    }
  }

  if (seatingMode === 'INTERLEAVED' && cohorts.length >= 2) {
    const primaryCohort = cohorts[0];
    const primaryQueue = primaryCohort.students.filter((st) => !preAssignedIds.has(st.id));

    const secondaryCohortLabel = cohorts.slice(1).map((c) => c.label).join('/');
    const secondaryQueue: Array<{ student: Student; label: string }> = [];
    for (const c of cohorts.slice(1)) {
      for (const st of c.students) {
        if (!preAssignedIds.has(st.id)) {
          secondaryQueue.push({ student: st, label: c.label });
        }
      }
    }

    let pIdx = 0;
    let sIdx = 0;

    for (let hIdx = 0; hIdx < halls.length; hIdx++) {
      const baseHall = halls[hIdx];
      const hallPreAssigned = pinnedByHall.get(baseHall.id) || [];
      if (
        hallPreAssigned.length === 0 &&
        pIdx >= primaryQueue.length &&
        sIdx >= secondaryQueue.length
      ) {
        break;
      }

      const plan = buildHallUsablePlan(baseHall, seatingMode, cohorts.length, layoutConfig);
      const hall: Hall = {
        ...baseHall,
        bench_pattern: plan.benchPattern,
        grid_cols: plan.effectiveCols,
        total_capacity: baseHall.grid_rows * plan.effectiveCols,
      };

      const hallPrePrimary = hallPreAssigned.filter(
        (st) => (studentMeta.get(st.id)?.cohortIdx ?? 0) === 0
      );
      const hallPreSecondary = hallPreAssigned.filter(
        (st) => (studentMeta.get(st.id)?.cohortIdx ?? 0) !== 0
      );
      let prePIdx = 0;
      let preSIdx = 0;

      const columnHeaders: string[] = [];
      const cells: SeatCell[] = [];
      const cohortCounts: Record<string, number> = {};
      let allocatedCount = 0;

      const grid: Array<Array<SeatCell | null>> = Array.from({ length: hall.grid_rows }, () =>
        Array.from({ length: plan.effectiveCols }, () => null)
      );

      for (let c = 0; c < plan.effectiveCols; c++) {
        const meta = plan.colMeta[c];
        const ownerIdx = plan.colOwnership[c];
        let colLabel = ownerIdx === 0 ? primaryCohort.label : secondaryCohortLabel;
        const firstInColLabel = colLabel;

        for (let r = 0; r < hall.grid_rows; r++) {
          const isBufferSeat = plan.bufferCoordSet.has(`${r}-${c}`);
          let assignedStudent: Student | null = null;
          let assignedLabel = firstInColLabel;

          if (!isBufferSeat) {
            if (ownerIdx === 0) {
              if (prePIdx < hallPrePrimary.length) {
                assignedStudent = hallPrePrimary[prePIdx++];
                assignedLabel = primaryCohort.label;
              } else if (pIdx < primaryQueue.length) {
                assignedStudent = primaryQueue[pIdx++];
                assignedLabel = primaryCohort.label;
              }
            } else {
              if (preSIdx < hallPreSecondary.length) {
                const st = hallPreSecondary[preSIdx++];
                assignedStudent = st;
                assignedLabel = studentMeta.get(st.id)?.label || secondaryCohortLabel;
                if (r === 0) colLabel = assignedLabel;
              } else if (sIdx < secondaryQueue.length) {
                const item = secondaryQueue[sIdx++];
                assignedStudent = item.student;
                assignedLabel = item.label;
                if (r === 0) colLabel = item.label;
              }
            }
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
            cohort_label: isBufferSeat
              ? 'BUFFER'
              : assignedStudent
                ? assignedLabel
                : colLabel,
            student_id: assignedStudent ? assignedStudent.id : null,
            roll_no_snapshot: assignedStudent ? assignedStudent.roll_no : null,
          };
        }
        columnHeaders.push(colLabel);
      }

      for (let r = 0; r < hall.grid_rows; r++) {
        for (let c = 0; c < plan.effectiveCols; c++) {
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
      if (!preAssignedIds.has(st.id)) {
        flatQueue.push({
          student: st,
          label: getCohortLabel(st, seatingMode, minorStreamFilter),
        });
      }
    }
  }

  let qIdx = 0;
  for (let hIdx = 0; hIdx < halls.length; hIdx++) {
    const baseHall = halls[hIdx];
    const hallPreAssigned = pinnedByHall.get(baseHall.id) || [];
    if (hallPreAssigned.length === 0 && qIdx >= flatQueue.length) break;

    let preFlatIdx = 0;
    const plan = buildHallUsablePlan(baseHall, seatingMode, cohorts.length, layoutConfig);
    const hall: Hall = {
      ...baseHall,
      bench_pattern: plan.benchPattern,
      grid_cols: plan.effectiveCols,
      total_capacity: baseHall.grid_rows * plan.effectiveCols,
    };

    const columnHeaders: string[] = [];
    const cells: SeatCell[] = [];
    const cohortCounts: Record<string, number> = {};
    let allocatedCount = 0;

    const grid: Array<Array<SeatCell | null>> = Array.from({ length: hall.grid_rows }, () =>
      Array.from({ length: plan.effectiveCols }, () => null)
    );

    for (let c = 0; c < plan.effectiveCols; c++) {
      const meta = plan.colMeta[c];
      const skipMiddleSeat = seatingMode === 'SINGLE_YEAR_CORNERS' && !meta.isCornerSeat;
      let colHeaderLabel = skipMiddleSeat ? 'EMPTY' : '-';

      for (let r = 0; r < hall.grid_rows; r++) {
        const isBufferSeat = !skipMiddleSeat && plan.bufferCoordSet.has(`${r}-${c}`);
        let assigned: { student: Student; label: string } | null = null;

        if (!skipMiddleSeat && !isBufferSeat) {
          if (preFlatIdx < hallPreAssigned.length) {
            const st = hallPreAssigned[preFlatIdx++];
            assigned = {
              student: st,
              label: getCohortLabel(st, seatingMode, minorStreamFilter),
            };
          } else if (qIdx < flatQueue.length) {
            assigned = flatQueue[qIdx++];
          }
          if (assigned) {
            if (r === 0 || colHeaderLabel === '-') {
              colHeaderLabel = assigned.label;
            }
            allocatedCount++;
            cohortCounts[assigned.label] = (cohortCounts[assigned.label] || 0) + 1;
          }
        }

        grid[r][c] = {
          row_index: r + 1,
          col_index: c + 1,
          bench_group: meta.benchGroup,
          sub_seat_index: meta.subSeatIndex,
          cohort_label: skipMiddleSeat
            ? 'EMPTY'
            : isBufferSeat
              ? 'BUFFER'
              : assigned
                ? assigned.label
                : colHeaderLabel,
          student_id: assigned ? assigned.student.id : null,
          roll_no_snapshot: assigned ? assigned.student.roll_no : null,
        };
      }

      columnHeaders.push(
        skipMiddleSeat ? 'EMPTY' : colHeaderLabel === '-' ? cohorts[0].label : colHeaderLabel
      );
    }

    for (let r = 0; r < hall.grid_rows; r++) {
      for (let c = 0; c < plan.effectiveCols; c++) {
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

export function resolveCohortSubject(
  session: ExamSession,
  cohortLabel: string
): string {
  return (
    session.subject_mapping[cohortLabel] ||
    session.subject_mapping[cohortLabel.split(' ')[0]] ||
    session.subject_mapping[`YEAR_${cohortLabel.split('-')[1]?.replace(/[^IV]/g, '') || ''}`] ||
    Object.values(session.subject_mapping)[0] ||
    'Regular Examination'
  );
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
      const subject = resolveCohortSubject(session, cohortLabel);

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

export function buildDispatchSummary(
  session: ExamSession,
  allocations: HallAllocation[],
  bufferPct = 5
): {
  bufferPct: number;
  roomRows: DispatchRoomRow[];
  floorSummaries: DispatchFloorSummary[];
  totals: {
    rooms: number;
    students: number;
    qp_with_buffer: number;
    booklets_with_buffer: number;
  };
} {
  const safePct = Math.max(0, Math.min(30, Number.isFinite(bufferPct) ? bufferPct : 5));
  const multiplier = 1 + safePct / 100;

  const roomRows: DispatchRoomRow[] = [];
  const floorMap = new Map<
    string,
    {
      building_code: string;
      floor: string;
      roomSet: Set<string>;
      student_count: number;
      qp_with_buffer: number;
      booklets_with_buffer: number;
    }
  >();

  for (const alloc of allocations) {
    const byCohort = new Map<string, number>();
    for (const cell of alloc.cells) {
      if (cell.roll_no_snapshot) {
        byCohort.set(cell.cohort_label, (byCohort.get(cell.cohort_label) || 0) + 1);
      }
    }

    const floorKey = `${alloc.hall.building_code}::${alloc.hall.floor}`;
    if (!floorMap.has(floorKey)) {
      floorMap.set(floorKey, {
        building_code: alloc.hall.building_code,
        floor: alloc.hall.floor,
        roomSet: new Set(),
        student_count: 0,
        qp_with_buffer: 0,
        booklets_with_buffer: 0,
      });
    }
    const fEntry = floorMap.get(floorKey)!;
    fEntry.roomSet.add(alloc.hall.room_no);

    for (const [cohortLabel, count] of byCohort.entries()) {
      const subject = resolveCohortSubject(session, cohortLabel);
      const withBuf = Math.ceil(count * multiplier);
      roomRows.push({
        room_no: alloc.hall.room_no,
        building_code: alloc.hall.building_code,
        floor: alloc.hall.floor,
        cohort_label: cohortLabel,
        subject,
        student_count: count,
        qp_with_buffer: withBuf,
        booklets_with_buffer: withBuf,
      });

      fEntry.student_count += count;
      fEntry.qp_with_buffer += withBuf;
      fEntry.booklets_with_buffer += withBuf;
    }
  }

  const floorSummaries: DispatchFloorSummary[] = Array.from(floorMap.values()).map((f) => ({
    floor: f.floor,
    building_code: f.building_code,
    rooms_count: f.roomSet.size,
    student_count: f.student_count,
    qp_with_buffer: f.qp_with_buffer,
    booklets_with_buffer: f.booklets_with_buffer,
  }));

  const totals = {
    rooms: allocations.length,
    students: roomRows.reduce((s, r) => s + r.student_count, 0),
    qp_with_buffer: roomRows.reduce((s, r) => s + r.qp_with_buffer, 0),
    booklets_with_buffer: roomRows.reduce((s, r) => s + r.booklets_with_buffer, 0),
  };

  return {
    bufferPct: safePct,
    roomRows,
    floorSummaries,
    totals,
  };
}

export type UserRole = 'ADMIN' | 'EXAMINER';

export interface User {
  id: number;
  username: string;
  full_name: string;
  emp_id: string;
  department: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export type EligibilityStatus = 'ELIGIBLE' | 'CONDONATION_PENDING' | 'DETAINED';
export type CourseEligibilityStatus = 'ELIGIBLE' | 'CONDONATION_PENDING' | 'DETAINED' | 'SUPPLEMENTARY';

export interface Student {
  id: number;
  roll_no: string;
  full_name: string;
  branch: string;
  current_year: number;
  batch_code: string;
  minor_stream: string;
  is_detained: boolean;
  eligibility_status: EligibilityStatus;
  is_pwd: boolean;
  created_at: string;
}

export interface CourseEligibilityRecord {
  id: number;
  roll_no: string;
  course_code: string;
  status: CourseEligibilityStatus;
  remarks: string;
  updated_at: string;
}

export interface MinorStreamOption {
  id: number;
  branch: string;
  name: string;
  code: string;
}

export interface ScheduledSubject {
  id: number;
  course_code: string;
  course_name: string;
  academic_year: number;
  branch: string;
  exam_date: string;
  session_slot: SessionSlot;
  created_at: string;
}

export interface FacultyWillingness {
  id: number;
  department: string;
  exam_title: string;
  emp_id: string;
  faculty_name: string;
  designation: string;
  exam_date: string;
  session_slot: SessionSlot;
  willing: 'YES' | 'NO';
  teaching_courses: string[];
  duty_count?: number;
  uploaded_at: string;
}

export type RoomType = 'CLASSROOM' | 'LAB';

export interface Hall {
  id: number;
  building_code: string;
  building_name: string;
  floor: string;
  room_no: string;
  room_type: RoomType;
  grid_rows: number;
  grid_cols: number;
  bench_capacity: number;
  bench_pattern: number[];
  total_capacity: number;
  is_active: boolean;
}

export type SessionSlot = 'FN' | 'AN';
export type SeatingMode =
  | 'INTERLEAVED'
  | 'SINGLE_YEAR_CORNERS'
  | 'SEQUENTIAL'
  | 'MINOR_STREAM';
export type ExamStatus = 'DRAFT' | 'ALLOCATED' | 'FINALIZED';

export type InterleaveStyle = 'ALTERNATE_SEATS' | 'BENCH_BLOCKS' | 'PAIRED_COLUMNS';

export interface PinnedStudentOverride {
  roll_no: string;
  hall_id: number;
  reason?: string;
}

export interface ExamLayoutConfig {
  interleave_style?: InterleaveStyle;
  room_patterns?: Record<string, number[]>;
  buffer_seats_per_hall?: number;
  pinned_students?: PinnedStudentOverride[];
  dispatch_buffer_pct?: number;
}

export interface ExamSession {
  id: number;
  exam_title: string;
  department: string;
  exam_date: string;
  session_slot: SessionSlot;
  session_timing: string;
  target_years: number[];
  target_branches: string[];
  seating_mode: SeatingMode;
  minor_stream_filter: string | null;
  subject_mapping: Record<string, string>;
  selected_subject_ids: number[];
  selected_hall_ids: number[];
  layout_config: ExamLayoutConfig;
  status: ExamStatus;
  created_by: number;
  created_at: string;
}

export interface SeatCell {
  id?: number;
  allocation_id?: number;
  row_index: number;
  col_index: number;
  bench_group: number;
  sub_seat_index: number;
  cohort_label: string;
  student_id: number | null;
  roll_no_snapshot: string | null;
}

export interface HallAllocation {
  id: number;
  exam_session_id: number;
  hall_id: number;
  sort_order: number;
  allocated_count: number;
  invigilator_1_name: string;
  invigilator_1_emp_id: string;
  invigilator_1_willing: boolean;
  invigilator_2_name: string;
  invigilator_2_emp_id: string;
  invigilator_2_willing: boolean;
  hall: Hall;
  cells: SeatCell[];
  cohort_counts: Record<string, number>;
  column_headers: string[];
}

export interface MasterSummaryRow {
  sno: number;
  branch_floor_key: string;
  branch_label: string;
  floor_label: string;
  roll_from: string;
  roll_to: string;
  subject: string;
  room_no: string;
  building_code: string;
  building_name: string;
  total: number;
  row_span?: number;
}

export interface ExcludedStudentInfo {
  roll_no: string;
  full_name: string;
  branch: string;
  current_year: number;
  reason: 'DETAINED_GLOBAL' | 'DETAINED_COURSE' | 'CONDONATION_PENDING';
  course_code?: string;
}

export interface CapacityValidationResult {
  valid: boolean;
  total_students: number;
  total_capacity: number;
  buffer_seats_reserved?: number;
  excluded_count?: number;
  hold_count?: number;
  excluded_students?: ExcludedStudentInfo[];
  cohort_breakdown: Array<{
    cohort_label: string;
    student_count: number;
    available_seats: number;
    deficit: number;
  }>;
  message: string;
}

export interface DispatchRoomRow {
  room_no: string;
  building_code: string;
  floor: string;
  cohort_label: string;
  subject: string;
  student_count: number;
  qp_with_buffer: number;
  booklets_with_buffer: number;
}

export interface DispatchFloorSummary {
  floor: string;
  building_code: string;
  rooms_count: number;
  student_count: number;
  qp_with_buffer: number;
  booklets_with_buffer: number;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string;
  role: string;
  action_type: string;
  details: string;
  created_at: string;
}

export interface UniversityAnalytics {
  total_students: number;
  active_students: number;
  detained_students: number;
  total_halls: number;
  total_seat_capacity: number;
  total_exam_sessions: number;
  total_examiners: number;
  students_by_year: Array<{ year: number; count: number }>;
  students_by_branch: Array<{ branch: string; count: number }>;
  students_by_minor: Array<{ minor_stream: string; count: number }>;
  recent_sessions: ExamSession[];
}

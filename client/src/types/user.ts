export type Role = "student" | "admin";

export type EnrollmentStatus = "pending" | "active" | "completed" | "withdrawn";

export type AuthUser = {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  display_name?: string;
  auth_provider?: string;
  cohort_start_date?: string | null;
  avatar_url?: string | null;
  forum_rules_accepted?: boolean;
  is_approved?: boolean;
  enrollment_status?: EnrollmentStatus | null;
};
export type Role = "student" | "admin";

export type AuthUser = {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  display_name?: string;
  auth_provider?: string;
  cohort_start_date?: string | null;
  avatar_url?: string | null;
};

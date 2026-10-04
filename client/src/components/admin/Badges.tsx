import type { AdminUser, Enrollment, ModuleProgressStatus } from "@/types/admin";

const ENROLLMENT_STYLES: Record<Enrollment["status"], string> = {
	pending: "bg-amber-100 text-amber-700",
	active: "bg-green-100 text-green-700",
	completed: "bg-blue-100 text-blue-700",
	withdrawn: "bg-gray-100 text-gray-600",
};

const ROLE_STYLES: Record<AdminUser["role"], string> = {
	admin: "bg-purple-100 text-purple-700",
	student: "bg-gray-100 text-gray-600",
};

export const PROGRESS_LABELS: Record<ModuleProgressStatus, string> = {
	completed: "Completed",
	in_progress: "In progress",
	not_started: "Not started",
	locked: "Not unlocked yet",
};

const PROGRESS_STYLES: Record<ModuleProgressStatus, string> = {
	completed: "bg-green-100 text-green-700",
	in_progress: "bg-amber-100 text-amber-700",
	not_started: "bg-red-100 text-red-700",
	locked: "bg-gray-100 text-gray-600",
};

const badge = "inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold";

export function EnrollmentStatusBadge({ status }: { status: Enrollment["status"] }) {
	return <span className={`${badge} capitalize ${ENROLLMENT_STYLES[status]}`}>{status}</span>;
}

export function RoleBadge({ role }: { role: AdminUser["role"] }) {
	return <span className={`${badge} capitalize ${ROLE_STYLES[role]}`}>{role}</span>;
}

export function ProgressStatusBadge({ status }: { status: ModuleProgressStatus }) {
	return <span className={`${badge} ${PROGRESS_STYLES[status]}`}>{PROGRESS_LABELS[status]}</span>;
}

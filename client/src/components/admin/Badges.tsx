import Badge, { type BadgeTone } from "@/components/ui/Badge";
import type { AdminUser, Enrollment, ModuleProgressStatus } from "@/types/admin";

const ENROLLMENT_TONES: Record<Enrollment["status"], BadgeTone> = {
	pending: "amber",
	active: "green",
	completed: "blue",
	withdrawn: "gray",
};

const ROLE_TONES: Record<AdminUser["role"], BadgeTone> = {
	admin: "purple",
	student: "gray",
};

export const PROGRESS_LABELS: Record<ModuleProgressStatus, string> = {
	completed: "Completed",
	in_progress: "In progress",
	not_started: "Not started",
	locked: "Not unlocked yet",
};

const PROGRESS_TONES: Record<ModuleProgressStatus, BadgeTone> = {
	completed: "green",
	in_progress: "amber",
	// Not started is a normal state, not an error, so it isn't red.
	not_started: "gray",
	locked: "gray",
};

/** "active" → "Active": sentence case, matching every other label. */
const sentenceCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function EnrollmentStatusBadge({ status }: { status: Enrollment["status"] }) {
	return <Badge tone={ENROLLMENT_TONES[status]}>{sentenceCase(status)}</Badge>;
}

/** For a user with no enrolment, so the status column always shows a badge. */
export function NotEnrolledBadge() {
	return <Badge tone="gray">Not enrolled</Badge>;
}

export function RoleBadge({ role }: { role: AdminUser["role"] }) {
	return <Badge tone={ROLE_TONES[role]}>{sentenceCase(role)}</Badge>;
}

export function ProgressStatusBadge({ status }: { status: ModuleProgressStatus }) {
	return <Badge tone={PROGRESS_TONES[status]}>{PROGRESS_LABELS[status]}</Badge>;
}

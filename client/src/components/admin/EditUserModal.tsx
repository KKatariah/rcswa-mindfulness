import { useState, type FormEvent } from "react";
import Modal from "@/components/main/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Field, FormActions, FormError, TextField } from "@/components/ui/form";
import Select from "@/components/ui/Select";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import { updateUser, createEnrollment, updateEnrollment, deleteEnrollment } from "@/lib/api";
import type { AdminUser, Cohort, Enrollment } from "@/types/admin";

type EditFormState = {
	full_name: string;
	email: string;
	role: AdminUser["role"];
	cohort: string;
};

function EditUserForm({
	initial,
	cohorts,
	onSubmit,
	onCancel,
}: {
	initial: EditFormState;
	cohorts: Cohort[];
	onSubmit: (data: EditFormState) => Promise<void>;
	onCancel: () => void;
}) {
	const [form, setForm] = useState(initial);
	const { submitting, error, run } = useFormSubmit("Failed to save user");
	const [confirmingPromote, setConfirmingPromote] = useState(false);
	const [pendingChanges, setPendingChanges] = useState<string[] | null>(null);

	const cohortName = (id: string) => cohorts.find((c) => String(c.id) === id)?.name ?? "their cohort";

	// Changes that cost the user access (or move them between cohort schedules) are confirmed before saving.
	function riskyChanges(): string[] {
		const changes: string[] = [];
		if (initial.role === "admin" && form.role !== "admin") {
			changes.push("lose access to the admin dashboard");
		}
		if (initial.cohort && !form.cohort) {
			changes.push(`be removed from ${cohortName(initial.cohort)} and lose access to the program's modules`);
		} else if (initial.cohort && form.cohort !== initial.cohort) {
			changes.push(`move from ${cohortName(initial.cohort)} to ${cohortName(form.cohort)}, which changes when each module unlocks for them`);
		}
		return changes;
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const changes = riskyChanges();
		if (changes.length > 0) {
			setPendingChanges(changes);
			return;
		}
		save();
	}

	function save() {
		setPendingChanges(null);
		void run(() => onSubmit(form));
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<FormError message={error} />

			<TextField
				id="user-name"
				label="Full name"
				required
				value={form.full_name}
				onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
			/>

			<TextField
				id="user-email"
				label="Email"
				type="email"
				required
				value={form.email}
				onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
			/>

			<Field id="user-role" label="Role">
				<Select
					id="user-role"
					value={form.role}
					onChange={(nextRole) => {
						if (nextRole === "admin" && initial.role !== "admin") {
							setConfirmingPromote(true);
							return;
						}
						setForm((f) => ({ ...f, role: nextRole as AdminUser["role"] }));
					}}
					options={[
						{ value: "student", label: "Student" },
						{ value: "admin", label: "Admin" },
					]}
					className="h-12 w-full cursor-pointer"
				/>
			</Field>

			<Field id="user-cohort" label="Cohort">
				<Select
					id="user-cohort"
					value={form.cohort}
					onChange={(cohort) => setForm((f) => ({ ...f, cohort }))}
					options={[
						{ value: "", label: "Not enrolled" },
						...cohorts.map((c) => ({ value: String(c.id), label: c.name })),
					]}
					className="h-12 w-full cursor-pointer"
				/>
			</Field>

			<FormActions submitting={submitting} onCancel={onCancel} />

			{pendingChanges && (
				<ConfirmDialog
					title="Save these changes?"
					message={`${initial.email} will ${pendingChanges.join(", and will ")}.`}
					confirmLabel="Save changes"
					danger
					onConfirm={save}
					onCancel={() => setPendingChanges(null)}
				/>
			)}

			{confirmingPromote && (
				<ConfirmDialog
					title="Promote to admin?"
					message={`${initial.email} will gain full access to the admin dashboard, including managing users, cohorts, and content.`}
					confirmLabel="Promote"
					onConfirm={() => {
						setForm((f) => ({ ...f, role: "admin" }));
						setConfirmingPromote(false);
					}}
					onCancel={() => setConfirmingPromote(false)}
				/>
			)}
		</form>
	);
}

/**
 * Edit a person's details and cohort. Used by the Users list and the profile page.
 * `enrollment` is their most recent enrollment; changing the cohort moves it, and
 * clearing the cohort deletes it.
 */
export default function EditUserModal({
	user,
	enrollment,
	cohorts,
	onClose,
	onSaved,
}: {
	user: AdminUser | null;
	enrollment: { id: number; cohort: number } | null;
	cohorts: Cohort[];
	onClose: () => void;
	// enrollment is the new one, null if they were removed from their cohort, or undefined if unchanged.
	onSaved: (user: AdminUser, enrollment: Enrollment | null | undefined) => void;
}) {
	async function handleSave(form: EditFormState) {
		if (!user) return;

		const updated = await updateUser(user.id, { full_name: form.full_name, email: form.email, role: form.role });

		const nextCohortId = form.cohort ? Number(form.cohort) : null;
		let nextEnrollment: Enrollment | null | undefined;

		if (nextCohortId === null && enrollment) {
			await deleteEnrollment(enrollment.id);
			nextEnrollment = null;
		} else if (nextCohortId !== null && !enrollment) {
			nextEnrollment = await createEnrollment({ user: user.id, cohort: nextCohortId });
		} else if (nextCohortId !== null && enrollment && enrollment.cohort !== nextCohortId) {
			nextEnrollment = await updateEnrollment(enrollment.id, { cohort: nextCohortId });
		}

		onSaved(updated, nextEnrollment);
	}

	return (
		<Modal isOpen={!!user} onClose={onClose} title="Edit User">
			{user && (
				<EditUserForm
					initial={{
						full_name: user.full_name,
						email: user.email,
						role: user.role,
						cohort: enrollment ? String(enrollment.cohort) : "",
					}}
					cohorts={cohorts}
					onSubmit={handleSave}
					onCancel={onClose}
				/>
			)}
		</Modal>
	);
}

import { useState, type FormEvent } from "react";
import Head from "next/head";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminPageHeader, { CreateButton } from "@/components/admin/AdminPageHeader";
import AdminTable from "@/components/admin/AdminTable";
import Modal from "@/components/main/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ErrorBanner } from "@/components/ui/feedback";
import { FormActions, FormError, TextField } from "@/components/ui/form";
import { PencilIcon, TrashIcon } from "@/components/ui/icons";
import { useAsync } from "@/hooks/useAsync";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import { listCohorts, listEnrollments, createCohort, updateCohort, deleteCohort } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Cohort } from "@/types/admin";
import { adminPageTitle } from "@/lib/pageTitle";

type CohortFormState = { name: string; year: string; start_date: string; end_date: string };

const EMPTY_FORM: CohortFormState = { name: "", year: "", start_date: "", end_date: "" };

function CohortForm({
	initial,
	onSubmit,
	onCancel,
}: {
	initial: CohortFormState;
	onSubmit: (data: CohortFormState) => Promise<void>;
	onCancel: () => void;
}) {
	const [form, setForm] = useState(initial);
	const { submitting, error, run } = useFormSubmit("Failed to save cohort");
	const [confirmingStartChange, setConfirmingStartChange] = useState(false);
	const set = (key: keyof CohortFormState) => (e: { target: { value: string } }) =>
		setForm((f) => ({ ...f, [key]: e.target.value }));

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		// Module unlock dates are counted from the start date, so moving it on an existing cohort is confirmed first.
		if (initial.start_date && form.start_date !== initial.start_date) {
			setConfirmingStartChange(true);
			return;
		}
		save();
	}

	function save() {
		setConfirmingStartChange(false);
		void run(() => onSubmit(form));
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<FormError message={error} />
			<TextField id="cohort-name" label="Name" required value={form.name} onChange={set("name")} placeholder="Sem2 2026" />
			<TextField id="cohort-year" label="Year" type="number" required value={form.year} onChange={set("year")} />
			<TextField
				id="cohort-start"
				label="Start date (Monday of week 1)"
				type="date"
				required
				value={form.start_date}
				onChange={set("start_date")}
			/>
			<TextField id="cohort-end" label="End date" type="date" required value={form.end_date} onChange={set("end_date")} />
			<FormActions submitting={submitting} onCancel={onCancel} />

			{confirmingStartChange && (
				<ConfirmDialog
					title="Change the start date?"
					message="Every module's unlock date for students in this cohort is counted from the start date, so this will move when modules open for them, including any already unlocked."
					confirmLabel="Change start date"
					onConfirm={save}
					onCancel={() => setConfirmingStartChange(false)}
				/>
			)}
		</form>
	);
}

/** Warning for deleting a cohort, sized to how many enrollment records it destroys. */
function deleteCohortMessage(enrollmentCount: number | null) {
	if (enrollmentCount === null) {
		return "This permanently deletes the cohort. Any students enrolled in it will lose their enrollment record. This can't be undone.";
	}
	if (enrollmentCount === 0) {
		return "No students are currently enrolled in this cohort. This can't be undone.";
	}
	const records = enrollmentCount === 1 ? "record" : "records";
	const students = enrollmentCount === 1 ? "the student" : "students";
	return `This will permanently delete ${enrollmentCount} enrollment ${records} for ${students} in this cohort. This can't be undone.`;
}

export default function AdminCohortsPage() {
	const { data: cohorts, setData: setCohorts, loading, error } = useAsync(listCohorts, [], [] as Cohort[], {
		errorFallback: "Failed to load cohorts",
	});
	const [modalOpen, setModalOpen] = useState(false);
	const [editing, setEditing] = useState<Cohort | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<Cohort | null>(null);
	const [deletingEnrollmentCount, setDeletingEnrollmentCount] = useState<number | null>(null);
	const [checkingEnrollments, setCheckingEnrollments] = useState(false);

	function openCreate() {
		setEditing(null);
		setModalOpen(true);
	}

	function openEdit(cohort: Cohort) {
		setEditing(cohort);
		setModalOpen(true);
	}

	async function handleSave(form: CohortFormState) {
		const payload = { name: form.name, year: Number(form.year), start_date: form.start_date, end_date: form.end_date };
		if (editing) {
			const updated = await updateCohort(editing.id, payload);
			setCohorts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
		} else {
			const created = await createCohort(payload);
			setCohorts((prev) => [created, ...prev]);
		}
		setModalOpen(false);
	}

	// Deleting a cohort cascades at the database level and permanently destroys
	// every enrollment record for students in it, so this looks up how many
	// enrollments are at stake before asking for confirmation — a plain "are
	// you sure?" undersells how destructive this action actually is.
	async function openDeleteConfirm(cohort: Cohort) {
		setDeleteError(null);
		setCheckingEnrollments(true);
		try {
			// Only the total is needed, not the rows.
			const { count } = await listEnrollments({ cohort: cohort.id, limit: 1 });
			setDeletingEnrollmentCount(count);
		} catch {
			// If the count fails to load, fall back to a generic warning rather
			// than blocking the delete flow entirely.
			setDeletingEnrollmentCount(null);
		} finally {
			setCheckingEnrollments(false);
		}
		setDeleting(cohort);
	}

	async function confirmDelete() {
		if (!deleting) return;
		const cohort = deleting;
		setDeleting(null);
		setDeleteError(null);
		try {
			await deleteCohort(cohort.id);
			setCohorts((prev) => prev.filter((c) => c.id !== cohort.id));
		} catch (e) {
			setDeleteError(errorMessage(e, "Failed to delete cohort"));
		}
	}

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle("Cohorts")}</title>
			</Head>

			<AdminPageHeader title="Cohorts">
				<CreateButton onClick={openCreate}>New Cohort</CreateButton>
			</AdminPageHeader>

			{deleteError && <ErrorBanner className="mt-4">{deleteError}</ErrorBanner>}

			<AdminTable
				columns={["Name", "Year", "Start", "End", ""]}
				loading={loading}
				error={error}
				empty={cohorts.length === 0}
				emptyMessage="No cohorts yet. Create one to get started."
			>
				{cohorts.map((cohort) => (
					<tr key={cohort.id} className="border-b border-gray-100 last:border-0">
						<td className="px-5 py-3 font-semibold text-ink">{cohort.name}</td>
						<td className="px-5 py-3 text-ink-soft">{cohort.year}</td>
						<td className="px-5 py-3 text-ink-soft">{cohort.start_date}</td>
						<td className="px-5 py-3 text-ink-soft">{cohort.end_date}</td>
						<td className="px-5 py-3">
							<div className="flex justify-end gap-3">
								<button type="button" onClick={() => openEdit(cohort)} aria-label="Edit cohort">
									<PencilIcon className="size-4 text-muted hover:text-brand-blue" />
								</button>
								<button
									type="button"
									onClick={() => openDeleteConfirm(cohort)}
									disabled={checkingEnrollments}
									aria-label="Delete cohort"
									className="disabled:opacity-50"
								>
									<TrashIcon className="size-4 text-muted hover:text-red-500" />
								</button>
							</div>
						</td>
					</tr>
				))}
			</AdminTable>

			<Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit Cohort" : "New Cohort"}>
				<CohortForm
					initial={editing ? { name: editing.name, year: String(editing.year), start_date: editing.start_date, end_date: editing.end_date } : EMPTY_FORM}
					onSubmit={handleSave}
					onCancel={() => setModalOpen(false)}
				/>
			</Modal>

			{deleting && (
				<ConfirmDialog
					title={`Delete "${deleting.name}"?`}
					message={deleteCohortMessage(deletingEnrollmentCount)}
					confirmLabel="Delete cohort"
					danger
					onConfirm={confirmDelete}
					onCancel={() => setDeleting(null)}
				/>
			)}
		</AdminLayout>
	);
}

import { useEffect, useState, type FormEvent } from "react";
import Head from "next/head";
import AdminLayout from "@/components/admin/AdminLayout";
import Modal from "@/components/main/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { PlusIcon, PencilIcon, TrashIcon } from "@/components/ui/icons";
import { listCohorts, listEnrollments, createCohort, updateCohort, deleteCohort } from "@/lib/api";
import type { Cohort } from "@/types/admin";

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
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			await onSubmit(form);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save cohort");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			{error && <p className="text-sm text-red-600" role="alert">{error}</p>}

			<div className="flex flex-col gap-2">
				<label htmlFor="cohort-name" className="text-sm font-semibold text-ink">Name</label>
				<input
					id="cohort-name"
					required
					value={form.name}
					onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
					placeholder="Sem2 2026"
					className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
				/>
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="cohort-year" className="text-sm font-semibold text-ink">Year</label>
				<input
					id="cohort-year"
					type="number"
					required
					value={form.year}
					onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
					className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
				/>
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="cohort-start" className="text-sm font-semibold text-ink">
					Start date (Monday of week 1)
				</label>
				<input
					id="cohort-start"
					type="date"
					required
					value={form.start_date}
					onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
					className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
				/>
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="cohort-end" className="text-sm font-semibold text-ink">End date</label>
				<input
					id="cohort-end"
					type="date"
					required
					value={form.end_date}
					onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
					className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
				/>
			</div>

			<div className="mt-2 flex gap-3">
				<button
					type="submit"
					disabled={submitting}
					className="h-12 flex-1 rounded-xl bg-brand-blue-dark text-[15px] font-bold text-white disabled:opacity-50"
				>
					{submitting ? "Saving…" : "Save"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="h-12 flex-1 rounded-xl border border-gray-200 text-[15px] font-semibold text-ink"
				>
					Cancel
				</button>
			</div>
		</form>
	);
}

export default function AdminCohortsPage() {
	const [cohorts, setCohorts] = useState<Cohort[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	const [editing, setEditing] = useState<Cohort | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<Cohort | null>(null);
	const [deletingEnrollmentCount, setDeletingEnrollmentCount] = useState<number | null>(null);
	const [checkingEnrollments, setCheckingEnrollments] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const data = await listCohorts(token);
				if (!cancelled) setCohorts(data);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load cohorts");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, []);

	function openCreate() {
		setEditing(null);
		setModalOpen(true);
	}

	function openEdit(cohort: Cohort) {
		setEditing(cohort);
		setModalOpen(true);
	}

	async function handleSave(form: CohortFormState) {
		const token = localStorage.getItem("token") ?? "";
		const payload = { name: form.name, year: Number(form.year), start_date: form.start_date, end_date: form.end_date };
		if (editing) {
			const updated = await updateCohort(editing.id, payload, token);
			setCohorts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
		} else {
			const created = await createCohort(payload, token);
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
			const token = localStorage.getItem("token") ?? "";
			const enrollments = await listEnrollments({ cohort: cohort.id }, token);
			setDeletingEnrollmentCount(enrollments.length);
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
		const token = localStorage.getItem("token") ?? "";
		try {
			await deleteCohort(cohort.id, token);
			setCohorts((prev) => prev.filter((c) => c.id !== cohort.id));
		} catch (e) {
			setDeleteError(e instanceof Error ? e.message : "Failed to delete cohort");
		}
	}

	return (
		<AdminLayout>
			<Head>
				<title>Cohorts — Admin</title>
			</Head>

			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-extrabold text-ink">Cohorts</h1>
				<button
					type="button"
					onClick={openCreate}
					className="flex h-11 items-center gap-2 rounded-xl bg-brand-blue px-4 text-[14px] font-bold text-white"
				>
					<PlusIcon className="size-4" />
					New Cohort
				</button>
			</div>

			{deleteError && (
				<p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600" role="alert">
					{deleteError}
				</p>
			)}

			<div className="mt-6 overflow-x-auto rounded-2xl border border-gray-200 bg-white">
				{loading ? (
					<div className="flex justify-center py-16">
						<span className="text-sm text-muted">Loading…</span>
					</div>
				) : error ? (
					<p className="p-6 text-sm text-red-600">{error}</p>
				) : cohorts.length === 0 ? (
					<p className="p-6 text-sm text-muted">No cohorts yet. Create one to get started.</p>
				) : (
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
								<th className="px-5 py-3">Name</th>
								<th className="px-5 py-3">Year</th>
								<th className="px-5 py-3">Start</th>
								<th className="px-5 py-3">End</th>
								<th className="px-5 py-3" />
							</tr>
						</thead>
						<tbody>
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
						</tbody>
					</table>
				)}
			</div>

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
					message={
						deletingEnrollmentCount === null
							? "This permanently deletes the cohort. Any students enrolled in it will lose their enrollment record. This can't be undone."
							: deletingEnrollmentCount === 0
								? "No students are currently enrolled in this cohort. This can't be undone."
								: `This will permanently delete ${deletingEnrollmentCount} enrollment record${deletingEnrollmentCount === 1 ? "" : "s"} for ${deletingEnrollmentCount === 1 ? "the student" : "students"} in this cohort. This can't be undone.`
					}
					confirmLabel="Delete cohort"
					danger
					onConfirm={confirmDelete}
					onCancel={() => setDeleting(null)}
				/>
			)}
		</AdminLayout>
	);
}

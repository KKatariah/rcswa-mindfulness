import { useEffect, useMemo, useState, type FormEvent } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import AdminLayout from "@/components/admin/AdminLayout";
import Modal from "@/components/main/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DragHandle, { ReorderHelp } from "@/components/ui/DragHandle";
import { PlusIcon, TrashIcon } from "@/components/ui/icons";
import { useDragReorder, type ReorderHandlers } from "@/hooks/useDragReorder";
import { listModulesAdmin, createModule, deleteModule, reorderModules } from "@/lib/api";
import type { AdminModule } from "@/types/admin";
import { weekLabel } from "@/lib/weeks";

type ModuleFormState = { week_number: string; title: string; description: string; is_published: boolean };

const EMPTY_FORM: ModuleFormState = { week_number: "", title: "", description: "", is_published: false };

export default function AdminModulesPage() {
	const router = useRouter();
	const [modules, setModules] = useState<AdminModule[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	const [form, setForm] = useState<ModuleFormState>(EMPTY_FORM);
	const [formError, setFormError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [deleting, setDeleting] = useState<AdminModule | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	// A dragged order waiting to be saved. Week numbers drive unlock dates, so moves are only
	// applied when the admin confirms with "Save order".
	const [pendingOrder, setPendingOrder] = useState<number[] | null>(null);
	const [savingOrder, setSavingOrder] = useState(false);
	const { draggingId, startDrag, handleKey } = useDragReorder<number>();

	const savedIds = modules.map((m) => m.id);
	const shown = useMemo(() => {
		if (!pendingOrder) return modules;
		const byId = new Map(modules.map((m) => [m.id, m]));
		return pendingOrder.map((id) => byId.get(id)!);
	}, [modules, pendingOrder]);
	// Positions keep the existing set of week numbers; dragging only changes who gets which.
	const weeks = useMemo(() => modules.map((m) => m.week_number).sort((a, b) => a - b), [modules]);

	const reorder: ReorderHandlers<number> = {
		onMove: (ids) => setPendingOrder(ids.join() === savedIds.join() ? null : ids),
		onDrop: () => {},
		onCancel: (before) => setPendingOrder(before.join() === savedIds.join() ? null : before),
	};

	async function saveOrder() {
		if (!pendingOrder) return;
		setSavingOrder(true);
		setDeleteError(null);
		try {
			await reorderModules(pendingOrder, localStorage.getItem("token") ?? "");
			setModules(shown.map((m, i) => ({ ...m, week_number: weeks[i] })));
			setPendingOrder(null);
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : "Failed to reorder modules");
		} finally {
			setSavingOrder(false);
		}
	}

	useEffect(() => {
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const data = await listModulesAdmin(token);
				if (!cancelled) setModules(data);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load modules");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, []);

	async function handleCreate(e: FormEvent) {
		e.preventDefault();
		setFormError(null);
		setSubmitting(true);
		try {
			const token = localStorage.getItem("token") ?? "";
			const created = await createModule(
				{
					week_number: Number(form.week_number),
					title: form.title,
					description: form.description,
					is_published: form.is_published,
				},
				token,
			);
			setModules((prev) => [...prev, created].sort((a, b) => a.week_number - b.week_number));
			// An unsaved drag order no longer covers every module.
			setPendingOrder(null);
			setModalOpen(false);
			setForm(EMPTY_FORM);
		} catch (err) {
			setFormError(err instanceof Error ? err.message : "Failed to create module");
		} finally {
			setSubmitting(false);
		}
	}

	async function handleDelete() {
		if (!deleting) return;
		const target = deleting;
		setDeleting(null);
		setDeleteError(null);
		try {
			const token = localStorage.getItem("token") ?? "";
			await deleteModule(target.id, token);
			setModules((prev) => prev.filter((m) => m.id !== target.id));
			setPendingOrder(null);
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : "Failed to delete module");
		}
	}

	return (
		<AdminLayout>
			<Head>
				<title>Modules — Admin</title>
			</Head>

			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-extrabold text-ink">Modules</h1>
				<button
					type="button"
					onClick={() => setModalOpen(true)}
					className="flex h-11 items-center gap-2 rounded-xl bg-brand-blue px-4 text-[14px] font-bold text-white"
				>
					<PlusIcon className="size-4" />
					New Module
				</button>
			</div>

			{deleteError && (
				<p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600" role="alert">
					{deleteError}
				</p>
			)}

			{pendingOrder && (
				<div
					role="status"
					className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between"
				>
					<p>
						Week order changed. Each module unlocks by its week number, so saving changes when these
						modules open for every cohort, including ones already running.
					</p>
					<div className="flex shrink-0 gap-2">
						<button
							type="button"
							onClick={() => setPendingOrder(null)}
							disabled={savingOrder}
							className="h-10 rounded-xl border border-amber-300 bg-white px-4 font-semibold text-ink disabled:opacity-50"
						>
							Discard
						</button>
						<button
							type="button"
							onClick={saveOrder}
							disabled={savingOrder}
							className="h-10 rounded-xl bg-brand-blue px-4 font-bold text-white disabled:opacity-50"
						>
							{savingOrder ? "Saving…" : "Save order"}
						</button>
					</div>
				</div>
			)}

			<div className="mt-6 overflow-x-auto rounded-2xl border border-gray-200 bg-white">
				{loading ? (
					<div className="flex justify-center py-16">
						<span className="text-sm text-muted">Loading…</span>
					</div>
				) : error ? (
					<p className="p-6 text-sm text-red-600">{error}</p>
				) : modules.length === 0 ? (
					<p className="p-6 text-sm text-muted">No modules yet. Create one to get started.</p>
				) : (
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
								<th className="w-10 px-3 py-3"><span className="sr-only">Reorder</span></th>
								<th className="px-5 py-3">Week</th>
								<th className="px-5 py-3">Title</th>
								<th className="px-5 py-3">Published</th>
								<th className="px-5 py-3">Content items</th>
								<th className="px-5 py-3" />
							</tr>
						</thead>
						<tbody>
							{shown.map((m, index) => (
								<tr
									key={m.id}
									data-reorder-id={m.id}
									onClick={() => router.push(`/admin/modules/${m.id}`)}
									className={`cursor-pointer border-b border-gray-100 last:border-0 hover:bg-surface-muted ${
										draggingId === m.id ? "bg-surface-muted opacity-50" : ""
									}`}
								>
									<td className="px-3 py-3">
										<DragHandle
											label={`Reorder ${m.title}`}
											onPointerDown={(e) => startDrag(e, m.id, shown.map((x) => x.id), reorder)}
											onKeyDown={(e) => handleKey(e, m.id, shown.map((x) => x.id), reorder)}
											disabled={savingOrder}
										/>
									</td>
									<td className="px-5 py-3 font-semibold text-ink">
										{weekLabel(weeks[index])}
										{weeks[index] !== m.week_number && (
											<span className="ml-1 text-xs font-normal text-amber-700">(was {weekLabel(m.week_number)})</span>
										)}
									</td>
									<td className="px-5 py-3 text-ink-soft">{m.title}</td>
									<td className="px-5 py-3">
										<span
											className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
												m.is_published ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
											}`}
										>
											{m.is_published ? "Published" : "Draft"}
										</span>
									</td>
									<td className="px-5 py-3 text-ink-soft">{m.content_items.length}</td>
									<td className="px-5 py-3">
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												setDeleting(m);
											}}
											aria-label="Delete module"
										>
											<TrashIcon className="size-4 text-muted hover:text-red-500" />
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			<ReorderHelp />

			<Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="New Module">
				<form onSubmit={handleCreate} className="flex flex-col gap-4">
					{formError && <p className="text-sm text-red-600" role="alert">{formError}</p>}

					<div className="flex flex-col gap-2">
						<label htmlFor="module-week" className="text-sm font-semibold text-ink">Week number</label>
						<input
							id="module-week"
							type="number"
							required
							value={form.week_number}
							onChange={(e) => setForm((f) => ({ ...f, week_number: e.target.value }))}
							className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label htmlFor="module-title" className="text-sm font-semibold text-ink">Title</label>
						<input
							id="module-title"
							required
							value={form.title}
							onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
							className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label htmlFor="module-description" className="text-sm font-semibold text-ink">Description</label>
						<textarea
							id="module-description"
							rows={3}
							value={form.description}
							onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
							className="resize-none rounded-xl border border-gray-200 p-3 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
						/>
					</div>

					<label className="flex items-center gap-2 text-sm font-semibold text-ink">
						<input
							type="checkbox"
							checked={form.is_published}
							onChange={(e) => setForm((f) => ({ ...f, is_published: e.target.checked }))}
						/>
						Published
					</label>

					<button
						type="submit"
						disabled={submitting}
						className="h-12 rounded-xl bg-brand-blue-dark text-[15px] font-bold text-white disabled:opacity-50"
					>
						{submitting ? "Saving…" : "Create"}
					</button>
				</form>
			</Modal>

			{deleting && (
				<ConfirmDialog
					title={`Delete "${deleting.title}"?`}
					message={
						deleting.content_items.length === 0
							? "This module has no content items yet. This can't be undone."
							: `This will permanently delete ${deleting.content_items.length} content item${deleting.content_items.length === 1 ? "" : "s"} and all student completion history for ${deleting.content_items.length === 1 ? "it" : "them"}. This can't be undone.`
					}
					confirmLabel="Delete module"
					danger
					onConfirm={handleDelete}
					onCancel={() => setDeleting(null)}
				/>
			)}
		</AdminLayout>
	);
}

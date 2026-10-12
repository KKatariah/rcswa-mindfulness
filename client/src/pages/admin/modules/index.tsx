import { useMemo, useState, type FormEvent } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminPageHeader, { CreateButton } from "@/components/admin/AdminPageHeader";
import AdminTable, { REORDER_COLUMN } from "@/components/admin/AdminTable";
import Modal from "@/components/main/Modal";
import Badge from "@/components/ui/Badge";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DragHandle, { ReorderHelp } from "@/components/ui/DragHandle";
import { ErrorBanner } from "@/components/ui/feedback";
import { FormActions, FormError, TextAreaField, TextField } from "@/components/ui/form";
import { TrashIcon } from "@/components/ui/icons";
import { useAsync } from "@/hooks/useAsync";
import { useDragReorder, type ReorderHandlers } from "@/hooks/useDragReorder";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import { listModulesAdmin, createModule, deleteModule, reorderModules } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { deleteModuleMessage } from "@/lib/modules";
import { weekLabel } from "@/lib/weeks";
import type { AdminModule } from "@/types/admin";
import { adminPageTitle } from "@/lib/pageTitle";
import Button from "@/components/ui/Button";

type ModuleFormState = { week_number: string; title: string; description: string; is_published: boolean };

const EMPTY_FORM: ModuleFormState = { week_number: "", title: "", description: "", is_published: false };

export default function AdminModulesPage() {
	const router = useRouter();
	const { data: modules, setData: setModules, loading, error } = useAsync(listModulesAdmin, [], [] as AdminModule[], {
		errorFallback: "Failed to load modules",
	});
	const [modalOpen, setModalOpen] = useState(false);
	const [form, setForm] = useState<ModuleFormState>(EMPTY_FORM);
	const { submitting, error: formError, run } = useFormSubmit("Failed to create module");
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
			await reorderModules(pendingOrder);
			setModules(shown.map((m, i) => ({ ...m, week_number: weeks[i] })));
			setPendingOrder(null);
		} catch (err) {
			setDeleteError(errorMessage(err, "Failed to reorder modules"));
		} finally {
			setSavingOrder(false);
		}
	}

	function handleCreate(e: FormEvent) {
		e.preventDefault();
		void run(async () => {
			const created = await createModule({
				week_number: Number(form.week_number),
				title: form.title,
				description: form.description,
				is_published: form.is_published,
			});
			setModules((prev) => [...prev, created].sort((a, b) => a.week_number - b.week_number));
			// An unsaved drag order no longer covers every module.
			setPendingOrder(null);
			setModalOpen(false);
			setForm(EMPTY_FORM);
		});
	}

	async function handleDelete() {
		if (!deleting) return;
		const target = deleting;
		setDeleting(null);
		setDeleteError(null);
		try {
			await deleteModule(target.id);
			setModules((prev) => prev.filter((m) => m.id !== target.id));
			setPendingOrder(null);
		} catch (err) {
			setDeleteError(errorMessage(err, "Failed to delete module"));
		}
	}

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle("Modules")}</title>
			</Head>

			<AdminPageHeader title="Modules">
				<CreateButton onClick={() => setModalOpen(true)}>New Module</CreateButton>
			</AdminPageHeader>

			{deleteError && <ErrorBanner className="mt-4">{deleteError}</ErrorBanner>}

			{/* Only once the drag ends: toggling mid-drag (each time the row passes its old spot) resized the page and made the sticky sidebar jump. */}
			{pendingOrder && draggingId === null && (
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
						<Button
							type="button"
							onClick={saveOrder}
							disabled={savingOrder}
							variant="primary" size={null} className="h-10 rounded-xl px-4 font-bold disabled:opacity-50"
						>
							{savingOrder ? "Saving…" : "Save order"}
						</Button>
					</div>
				</div>
			)}

			<AdminTable
				columns={[REORDER_COLUMN, "Week", "Title", "Published", "Content items", ""]}
				loading={loading}
				error={error}
				empty={modules.length === 0}
				emptyMessage="No modules yet. Create one to get started."
			>
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
							<Badge tone={m.is_published ? "green" : "gray"}>{m.is_published ? "Published" : "Draft"}</Badge>
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
								<TrashIcon className="size-4 text-muted hover:text-red-500 cursor-pointer" />
							</button>
						</td>
					</tr>
				))}
			</AdminTable>

			<ReorderHelp />

			<Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="New Module">
				<form onSubmit={handleCreate} className="flex flex-col gap-4">
					<FormError message={formError} />
					<TextField
						id="module-week"
						label="Week number"
						type="number"
						required
						value={form.week_number}
						onChange={(e) => setForm((f) => ({ ...f, week_number: e.target.value }))}
					/>
					<TextField
						id="module-title"
						label="Title"
						required
						value={form.title}
						onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
					/>
					<TextAreaField
						id="module-description"
						label="Description"
						rows={3}
						value={form.description}
						onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
					/>
					<label className="flex items-center gap-2 text-sm font-semibold text-ink cursor-pointer">
						<input
							type="checkbox"
							checked={form.is_published}
							onChange={(e) => setForm((f) => ({ ...f, is_published: e.target.checked }))}
							className="cursor-pointer"
						/>
						Published
					</label>
					<FormActions submitting={submitting} submitLabel="Create" className="" />
				</form>
			</Modal>

			{deleting && (
				<ConfirmDialog
					title={`Delete "${deleting.title}"?`}
					message={deleteModuleMessage(deleting.content_items.length)}
					confirmLabel="Delete module"
					danger
					onConfirm={handleDelete}
					onCancel={() => setDeleting(null)}
				/>
			)}
		</AdminLayout>
	);
}

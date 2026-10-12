import { useEffect, useMemo, useState, type FormEvent } from "react";
import Head from "next/head";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminPageHeader, { CreateButton } from "@/components/admin/AdminPageHeader";
import AdminTable, { REORDER_COLUMN } from "@/components/admin/AdminTable";
import Modal from "@/components/main/Modal";
import Card from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DragHandle, { ReorderHelp } from "@/components/ui/DragHandle";
import { ErrorBanner, LoadingState } from "@/components/ui/feedback";
import { Field, FormActions, FormError, TextField } from "@/components/ui/form";
import { PlusIcon, PencilIcon, TrashIcon } from "@/components/ui/icons";
import Select from "@/components/ui/Select";
import { useAsync } from "@/hooks/useAsync";
import { useDragReorder, type ReorderHandlers } from "@/hooks/useDragReorder";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import {
	listAdditionalResources,
	createAdditionalResource,
	updateAdditionalResource,
	deleteAdditionalResource,
	reorderAdditionalResources,
} from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { safeUrl } from "@/lib/safeUrl";
import type { AdditionalResourceCategory, AdminAdditionalResource } from "@/types/admin";
import { adminPageTitle } from "@/lib/pageTitle";
import Button from "@/components/ui/Button";

const CATEGORY_OPTIONS: { value: AdditionalResourceCategory; label: string }[] = [
	{ value: "book", label: "Book" },
	{ value: "documentary", label: "Documentary" },
	{ value: "online_program", label: "Online Program" },
];

const SECTIONS: { category: AdditionalResourceCategory; heading: string }[] = [
	{ category: "book", heading: "Books" },
	{ category: "documentary", heading: "Documentaries" },
	{ category: "online_program", heading: "Online Programs" },
];

function byOrder(a: AdminAdditionalResource, b: AdminAdditionalResource) {
	return a.display_order - b.display_order || a.id - b.id;
}

// Rewrites one category's display_order to match `ids`, leaving other categories alone.
function withOrder(resources: AdminAdditionalResource[], category: AdditionalResourceCategory, ids: number[]) {
	return resources.map((r) => (r.category === category ? { ...r, display_order: ids.indexOf(r.id) + 1 } : r));
}

type ResourceFormState = {
	category: AdditionalResourceCategory;
	title: string;
	author: string;
	url: string;
	cover_image: File | null;
	existing_cover_url: string | null;
};

const EMPTY_FORM: ResourceFormState = {
	category: "book",
	title: "",
	author: "",
	url: "",
	cover_image: null,
	existing_cover_url: null,
};

function ResourceForm({
	initial,
	onSubmit,
	onCancel,
}: {
	initial: ResourceFormState;
	onSubmit: (data: ResourceFormState) => Promise<void>;
	onCancel: () => void;
}) {
	const [form, setForm] = useState(initial);
	const { submitting, error, run } = useFormSubmit("Failed to save resource");

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		void run(() => onSubmit(form));
	}

	// Only create a fresh object URL when the picked file actually changes, and
	// revoke it on cleanup/unmount — creating one on every render (e.g. each
	// keystroke in the title field) leaks a blob URL that never gets freed.
	const objectUrl = useMemo(
		() => (form.cover_image ? URL.createObjectURL(form.cover_image) : null),
		[form.cover_image],
	);
	useEffect(() => {
		return () => {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [objectUrl]);
	const coverPreview = objectUrl ?? form.existing_cover_url;

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<FormError message={error} />

			<Field id="resource-category" label="Category">
				<Select
					id="resource-category"
					value={form.category}
					onChange={(value) =>
						setForm((f) => ({
							...f,
							category: value as AdditionalResourceCategory,
							// Author only applies to books; clear it when switching away so a
							// hidden stale value can't be silently saved onto a documentary/program.
							author: value === "book" ? f.author : "",
						}))
					}
					options={CATEGORY_OPTIONS}
					className="h-12 w-full cursor-pointer"
				/>
			</Field>

			<TextField
				id="resource-title"
				label="Title"
				required
				value={form.title}
				onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
			/>

			{form.category === "book" && (
				<TextField
					id="resource-author"
					label="Author"
					value={form.author}
					onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
				/>
			)}

			<TextField
				id="resource-url"
				label={`Link ${form.category === "book" ? "(optional)" : ""}`}
				type="url"
				value={form.url}
				onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
				placeholder="https://…"
			/>

			<Field id="resource-cover" label="Cover image">
				{coverPreview && (
					// eslint-disable-next-line @next/next/no-img-element -- local blob preview / API-hosted image, not a next/image candidate
					<img src={coverPreview} alt="" className="h-32 w-24 rounded-lg border border-gray-200 object-cover" />
				)}
				<input
					id="resource-cover"
					type="file"
					accept="image/*"
					onChange={(e) => setForm((f) => ({ ...f, cover_image: e.target.files?.[0] ?? null }))}
					className="file:cursor-pointer text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:text-sm file:font-semibold"
				/>
			</Field>

			<FormActions submitting={submitting} onCancel={onCancel} />
		</form>
	);
}

export default function AdminResourcesPage() {
	const {
		data: resources,
		setData: setResources,
		loading,
		error,
	} = useAsync(() => listAdditionalResources(), [], [] as AdminAdditionalResource[], {
		errorFallback: "Failed to load resources",
	});
	const [modalOpen, setModalOpen] = useState(false);
	const [editing, setEditing] = useState<AdminAdditionalResource | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [newCategory, setNewCategory] = useState<AdditionalResourceCategory>("book");
	// Dragged orders waiting to be saved, per category, like every other edit on the admin pages.
	const [pendingOrders, setPendingOrders] = useState<Partial<Record<AdditionalResourceCategory, number[]>>>({});
	const [savingOrder, setSavingOrder] = useState<AdditionalResourceCategory | null>(null);
	const [deleting, setDeleting] = useState<AdminAdditionalResource | null>(null);
	const { draggingId, startDrag, handleKey } = useDragReorder<number>();

	const sections = useMemo(
		() =>
			SECTIONS.map((s) => {
				const saved = resources.filter((r) => r.category === s.category).sort(byOrder);
				const pending = pendingOrders[s.category];
				if (!pending) return { ...s, saved, items: saved };
				// Resources added or deleted since the drag keep the pending order for the rest.
				const byId = new Map(saved.map((r) => [r.id, r]));
				const kept = pending.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
				return { ...s, saved, items: [...kept, ...saved.filter((r) => !pending.includes(r.id))] };
			}),
		[resources, pendingOrders],
	);

	function openCreate(category: AdditionalResourceCategory = "book") {
		setEditing(null);
		setNewCategory(category);
		setModalOpen(true);
	}

	function setPendingOrder(category: AdditionalResourceCategory, ids: number[] | null) {
		setPendingOrders((prev) => {
			const next = { ...prev };
			if (ids) next[category] = ids;
			else delete next[category];
			return next;
		});
	}

	// Drags are local to one category; the server stores each category's order separately.
	function reorderHandlers(category: AdditionalResourceCategory, savedIds: number[]): ReorderHandlers<number> {
		const update = (ids: number[]) => setPendingOrder(category, ids.join() === savedIds.join() ? null : ids);
		return { onMove: update, onDrop: () => {}, onCancel: update };
	}

	async function saveOrder(category: AdditionalResourceCategory, ids: number[]) {
		setSavingOrder(category);
		setDeleteError(null);
		try {
			await reorderAdditionalResources(category, ids);
			setResources((prev) => withOrder(prev, category, ids));
			setPendingOrder(category, null);
		} catch (err) {
			setDeleteError(errorMessage(err, "Failed to reorder resources"));
		} finally {
			setSavingOrder(null);
		}
	}

	function openEdit(resource: AdminAdditionalResource) {
		setEditing(resource);
		setModalOpen(true);
	}

	async function handleSave(form: ResourceFormState) {
		const payload = {
			category: form.category,
			title: form.title,
			author: form.author,
			url: form.url,
			// Only send a new file when one was picked, so editing text fields
			// never wipes an existing cover.
			...(form.cover_image ? { cover_image: form.cover_image } : {}),
		};
		if (editing) {
			const updated = await updateAdditionalResource(editing.id, payload);
			setResources((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
		} else {
			const created = await createAdditionalResource(payload);
			setResources((prev) => [...prev, created]);
		}
		setModalOpen(false);
	}

	async function handleDelete() {
		if (!deleting) return;
		const resource = deleting;
		setDeleting(null);
		setDeleteError(null);
		try {
			await deleteAdditionalResource(resource.id);
			setResources((prev) => prev.filter((r) => r.id !== resource.id));
		} catch (e) {
			setDeleteError(errorMessage(e, "Failed to delete resource"));
		}
	}

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle("Resources")}</title>
			</Head>

			<AdminPageHeader title="Resources">
				<CreateButton onClick={() => openCreate()}>New Resource</CreateButton>
			</AdminPageHeader>

			{deleteError && <ErrorBanner className="mt-4">{deleteError}</ErrorBanner>}

			{loading ? (
				<Card className="mt-6">
					<LoadingState />
				</Card>
			) : error ? (
				<Card as="p" className="mt-6 p-6 text-sm text-red-600">{error}</Card>
			) : (
				sections.map(({ category, heading, saved, items }) => (
					<section key={category} aria-labelledby={`resources-${category}`} className="mt-8">
						<div className="flex items-center justify-between">
							<h2 id={`resources-${category}`} className="text-lg font-bold text-ink">
								{heading} <span className="text-sm font-semibold text-muted">({items.length})</span>
							</h2>
							<button
								type="button"
								onClick={() => openCreate(category)}
								className="flex items-center gap-1 text-sm font-semibold text-brand-blue cursor-pointer hover:underline"
							>
								<PlusIcon className="size-4 cursor-pointer" />
								Add
							</button>
						</div>
						<AdminTable
							columns={[REORDER_COLUMN, "Cover", "Title", ...(category === "book" ? ["Author"] : []), ""]}
							empty={items.length === 0}
							emptyMessage="Nothing here yet."
							className="mt-3"
						>
							{items.map((resource) => (
								<tr
									key={resource.id}
									data-reorder-id={resource.id}
									className={`border-b border-gray-100 last:border-0 ${
										draggingId === resource.id ? "bg-surface-muted opacity-50" : ""
									}`}
								>
									<td className="px-3 py-3">
										<DragHandle
											label={`Reorder ${resource.title}`}
											onPointerDown={(e) => startDrag(e, resource.id, items.map((r) => r.id), reorderHandlers(category, saved.map((r) => r.id)))}
											onKeyDown={(e) => handleKey(e, resource.id, items.map((r) => r.id), reorderHandlers(category, saved.map((r) => r.id)))}
										/>
									</td>
									<td className="px-5 py-3">
										{resource.cover_image ? (
											// eslint-disable-next-line @next/next/no-img-element -- API-hosted thumbnail, not a next/image candidate
											<img src={safeUrl(resource.cover_image)} alt="" className="size-10 rounded-lg object-cover" />
										) : (
											<div className="size-10 rounded-lg bg-surface-muted" />
										)}
									</td>
									<td className="px-5 py-3 font-semibold text-ink">{resource.title}</td>
									{category === "book" && (
										<td className="px-5 py-3 text-ink-soft">{resource.author || "—"}</td>
									)}
									<td className="px-5 py-3">
										<div className="flex justify-end gap-3">
											<button type="button" onClick={() => openEdit(resource)} aria-label="Edit resource">
												<PencilIcon className="size-4 text-muted hover:text-brand-blue cursor-pointer" />
											</button>
											<button type="button" onClick={() => setDeleting(resource)} aria-label="Delete resource">
												<TrashIcon className="size-4 text-muted hover:text-red-500 cursor-pointer" />
											</button>
										</div>
									</td>
								</tr>
							))}
						</AdminTable>
						{/* Only once the drag ends: toggling mid-drag (each time the row passes its old spot) resized the page and made the sticky sidebar jump. */}
						{pendingOrders[category] && draggingId === null && (
							<div
								role="status"
								className="mt-3 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between"
							>
								<p>{heading} order changed. Save to show students the new order.</p>
								<div className="flex shrink-0 gap-2">
									<button
										type="button"
										onClick={() => setPendingOrder(category, null)}
										disabled={savingOrder === category}
										className="h-10 rounded-xl border border-amber-300 bg-white px-4 font-semibold text-ink disabled:opacity-50 cursor-pointer hover:bg-surface-muted"
									>
										Discard
									</button>
									<Button
										type="button"
										onClick={() => saveOrder(category, items.map((r) => r.id))}
										disabled={savingOrder === category}
										variant="primary" size={null} className="h-10 rounded-xl px-4 font-bold disabled:opacity-50"
									>
										{savingOrder === category ? "Saving…" : "Save order"}
									</Button>
								</div>
							</div>
						)}
					</section>
				))
			)}
			<ReorderHelp />

			<Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit Resource" : "New Resource"}>
				<ResourceForm
					initial={
						editing
							? {
									category: editing.category,
									title: editing.title,
									author: editing.author,
									url: editing.url,
									cover_image: null,
									existing_cover_url: editing.cover_image,
								}
							: { ...EMPTY_FORM, category: newCategory }
					}
					onSubmit={handleSave}
					onCancel={() => setModalOpen(false)}
				/>
			</Modal>

			{deleting && (
				<ConfirmDialog
					title={`Delete "${deleting.title}"?`}
					message="Students will no longer see this resource. This can't be undone."
					confirmLabel="Delete resource"
					danger
					onConfirm={handleDelete}
					onCancel={() => setDeleting(null)}
				/>
			)}
		</AdminLayout>
	);
}

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { safeUrl } from "@/lib/safeUrl";
import Head from "next/head";
import AdminLayout from "@/components/admin/AdminLayout";
import Modal from "@/components/main/Modal";
import Select from "@/components/ui/Select";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { PlusIcon, PencilIcon, TrashIcon } from "@/components/ui/icons";
import DragHandle, { ReorderHelp } from "@/components/ui/DragHandle";
import { useDragReorder, type ReorderHandlers } from "@/hooks/useDragReorder";
import {
	listAdditionalResources,
	createAdditionalResource,
	updateAdditionalResource,
	deleteAdditionalResource,
	reorderAdditionalResources,
} from "@/lib/api";
import type { AdditionalResourceCategory, AdminAdditionalResource } from "@/types/admin";

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
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			await onSubmit(form);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save resource");
		} finally {
			setSubmitting(false);
		}
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
			{error && <p className="text-sm text-red-600" role="alert">{error}</p>}

			<div className="flex flex-col gap-2">
				<label htmlFor="resource-category" className="text-sm font-semibold text-ink">Category</label>
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
					className="h-12 w-full"
				/>
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="resource-title" className="text-sm font-semibold text-ink">Title</label>
				<input
					id="resource-title"
					required
					value={form.title}
					onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
					className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
				/>
			</div>

			{form.category === "book" && (
				<div className="flex flex-col gap-2">
					<label htmlFor="resource-author" className="text-sm font-semibold text-ink">Author</label>
					<input
						id="resource-author"
						value={form.author}
						onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
						className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
					/>
				</div>
			)}

			<div className="flex flex-col gap-2">
				<label htmlFor="resource-url" className="text-sm font-semibold text-ink">
					Link {form.category === "book" ? "(optional)" : ""}
				</label>
				<input
					id="resource-url"
					type="url"
					value={form.url}
					onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
					placeholder="https://…"
					className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
				/>
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="resource-cover" className="text-sm font-semibold text-ink">Cover image</label>
				{coverPreview && (
					// eslint-disable-next-line @next/next/no-img-element -- local blob preview / API-hosted image, not a next/image candidate
					<img src={coverPreview} alt="" className="h-32 w-24 rounded-lg border border-gray-200 object-cover" />
				)}
				<input
					id="resource-cover"
					type="file"
					accept="image/*"
					onChange={(e) => setForm((f) => ({ ...f, cover_image: e.target.files?.[0] ?? null }))}
					className="text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:text-sm file:font-semibold"
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

export default function AdminResourcesPage() {
	const [resources, setResources] = useState<AdminAdditionalResource[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	const [editing, setEditing] = useState<AdminAdditionalResource | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [newCategory, setNewCategory] = useState<AdditionalResourceCategory>("book");
	const { draggingId, startDrag, handleKey } = useDragReorder<number>();
	const [deleting, setDeleting] = useState<AdminAdditionalResource | null>(null);

	const sections = useMemo(
		() => SECTIONS.map((s) => ({ ...s, items: resources.filter((r) => r.category === s.category).sort(byOrder) })),
		[resources],
	);

	useEffect(() => {
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const data = await listAdditionalResources(token);
				if (!cancelled) setResources(data);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load resources");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, []);

	function openCreate(category: AdditionalResourceCategory = "book") {
		setEditing(null);
		setNewCategory(category);
		setModalOpen(true);
	}

	// Drags are local to one category; the server stores each category's order separately.
	function reorderHandlers(category: AdditionalResourceCategory): ReorderHandlers<number> {
		const snapshot = resources;
		return {
			onMove: (ids) => setResources((prev) => withOrder(prev, category, ids)),
			onCancel: () => setResources(snapshot),
			onDrop: async (ids) => {
				setDeleteError(null);
				try {
					await reorderAdditionalResources(category, ids, localStorage.getItem("token") ?? "");
				} catch (err) {
					setResources(snapshot);
					setDeleteError(err instanceof Error ? err.message : "Failed to reorder resources");
				}
			},
		};
	}

	function openEdit(resource: AdminAdditionalResource) {
		setEditing(resource);
		setModalOpen(true);
	}

	async function handleSave(form: ResourceFormState) {
		const token = localStorage.getItem("token") ?? "";
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
			const updated = await updateAdditionalResource(editing.id, payload, token);
			setResources((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
		} else {
			const created = await createAdditionalResource(payload, token);
			setResources((prev) => [...prev, created]);
		}
		setModalOpen(false);
	}

	async function handleDelete() {
		if (!deleting) return;
		const resource = deleting;
		setDeleting(null);
		setDeleteError(null);
		const token = localStorage.getItem("token") ?? "";
		try {
			await deleteAdditionalResource(resource.id, token);
			setResources((prev) => prev.filter((r) => r.id !== resource.id));
		} catch (e) {
			setDeleteError(e instanceof Error ? e.message : "Failed to delete resource");
		}
	}

	return (
		<AdminLayout>
			<Head>
				<title>Resources — Admin</title>
			</Head>

			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-extrabold text-ink">Resources</h1>
				<button
					type="button"
					onClick={() => openCreate()}
					className="flex h-11 items-center gap-2 rounded-xl bg-brand-blue px-4 text-[14px] font-bold text-white"
				>
					<PlusIcon className="size-4" />
					New Resource
				</button>
			</div>

			{deleteError && (
				<p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600" role="alert">
					{deleteError}
				</p>
			)}

			{loading ? (
				<div className="mt-6 flex justify-center rounded-2xl border border-gray-200 bg-white py-16">
					<span className="text-sm text-muted">Loading…</span>
				</div>
			) : error ? (
				<p className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-red-600">{error}</p>
			) : (
				sections.map(({ category, heading, items }) => (
					<section key={category} aria-labelledby={`resources-${category}`} className="mt-8">
						<div className="flex items-center justify-between">
							<h2 id={`resources-${category}`} className="text-lg font-bold text-ink">
								{heading} <span className="text-sm font-semibold text-muted">({items.length})</span>
							</h2>
							<button
								type="button"
								onClick={() => openCreate(category)}
								className="flex items-center gap-1 text-[14px] font-semibold text-brand-blue"
							>
								<PlusIcon className="size-4" />
								Add
							</button>
						</div>
						<div className="mt-3 overflow-x-auto rounded-2xl border border-gray-200 bg-white">
							{items.length === 0 ? (
								<p className="p-6 text-sm text-muted">Nothing here yet.</p>
							) : (
								<table className="w-full text-left text-sm">
									<thead>
										<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
											<th className="w-10 px-3 py-3"><span className="sr-only">Reorder</span></th>
											<th className="px-5 py-3">Cover</th>
											<th className="px-5 py-3">Title</th>
											{category === "book" && <th className="px-5 py-3">Author</th>}
											<th className="px-5 py-3" />
										</tr>
									</thead>
									<tbody>
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
														onPointerDown={(e) => startDrag(e, resource.id, items.map((r) => r.id), reorderHandlers(category))}
														onKeyDown={(e) => handleKey(e, resource.id, items.map((r) => r.id), reorderHandlers(category))}
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
															<PencilIcon className="size-4 text-muted hover:text-brand-blue" />
														</button>
														<button type="button" onClick={() => setDeleting(resource)} aria-label="Delete resource">
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

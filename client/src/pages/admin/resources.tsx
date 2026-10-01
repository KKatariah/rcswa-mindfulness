import { useEffect, useMemo, useState, type FormEvent } from "react";
import { safeUrl } from "@/lib/safeUrl";
import Head from "next/head";
import AdminLayout from "@/components/admin/AdminLayout";
import Modal from "@/components/main/Modal";
import Select from "@/components/ui/Select";
import { PlusIcon, PencilIcon, TrashIcon } from "@/components/ui/icons";
import {
	listAdditionalResources,
	createAdditionalResource,
	updateAdditionalResource,
	deleteAdditionalResource,
} from "@/lib/api";
import type { AdditionalResourceCategory, AdminAdditionalResource } from "@/types/admin";

const CATEGORY_OPTIONS: { value: AdditionalResourceCategory; label: string }[] = [
	{ value: "book", label: "Book" },
	{ value: "documentary", label: "Documentary" },
	{ value: "online_program", label: "Online Program" },
];

const CATEGORY_LABELS: Record<AdditionalResourceCategory, string> = {
	book: "Book",
	documentary: "Documentary",
	online_program: "Online Program",
};

type ResourceFormState = {
	category: AdditionalResourceCategory;
	title: string;
	author: string;
	url: string;
	display_order: string;
	cover_image: File | null;
	existing_cover_url: string | null;
};

const EMPTY_FORM: ResourceFormState = {
	category: "book",
	title: "",
	author: "",
	url: "",
	display_order: "0",
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
				<label htmlFor="resource-order" className="text-sm font-semibold text-ink">Display order</label>
				<input
					id="resource-order"
					type="number"
					value={form.display_order}
					onChange={(e) => setForm((f) => ({ ...f, display_order: e.target.value }))}
					className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
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

	function openCreate() {
		setEditing(null);
		setModalOpen(true);
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
			display_order: Number(form.display_order) || 0,
			// Only send a new file when one was picked, so editing text fields
			// never wipes an existing cover.
			...(form.cover_image ? { cover_image: form.cover_image } : {}),
		};
		if (editing) {
			const updated = await updateAdditionalResource(editing.id, payload, token);
			setResources((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
		} else {
			const created = await createAdditionalResource(payload, token);
			setResources((prev) => [created, ...prev]);
		}
		setModalOpen(false);
	}

	async function handleDelete(resource: AdminAdditionalResource) {
		if (!confirm(`Delete "${resource.title}"?`)) return;
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
					onClick={openCreate}
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

			<div className="mt-6 overflow-x-auto rounded-2xl border border-gray-200 bg-white">
				{loading ? (
					<div className="flex justify-center py-16">
						<span className="text-sm text-muted">Loading…</span>
					</div>
				) : error ? (
					<p className="p-6 text-sm text-red-600">{error}</p>
				) : resources.length === 0 ? (
					<p className="p-6 text-sm text-muted">No resources yet. Add one to get started.</p>
				) : (
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
								<th className="px-5 py-3">Cover</th>
								<th className="px-5 py-3">Category</th>
								<th className="px-5 py-3">Title</th>
								<th className="px-5 py-3">Author</th>
								<th className="px-5 py-3">Order</th>
								<th className="px-5 py-3" />
							</tr>
						</thead>
						<tbody>
							{resources.map((resource) => (
								<tr key={resource.id} className="border-b border-gray-100 last:border-0">
									<td className="px-5 py-3">
										{resource.cover_image ? (
											// eslint-disable-next-line @next/next/no-img-element -- API-hosted thumbnail, not a next/image candidate
											<img src={safeUrl(resource.cover_image)} alt="" className="size-10 rounded-lg object-cover" />
										) : (
											<div className="size-10 rounded-lg bg-surface-muted" />
										)}
									</td>
									<td className="px-5 py-3 text-ink-soft">{CATEGORY_LABELS[resource.category]}</td>
									<td className="px-5 py-3 font-semibold text-ink">{resource.title}</td>
									<td className="px-5 py-3 text-ink-soft">{resource.author || "—"}</td>
									<td className="px-5 py-3 text-ink-soft">{resource.display_order}</td>
									<td className="px-5 py-3">
										<div className="flex justify-end gap-3">
											<button type="button" onClick={() => openEdit(resource)} aria-label="Edit resource">
												<PencilIcon className="size-4 text-muted hover:text-brand-blue" />
											</button>
											<button type="button" onClick={() => handleDelete(resource)} aria-label="Delete resource">
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

			<Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit Resource" : "New Resource"}>
				<ResourceForm
					initial={
						editing
							? {
									category: editing.category,
									title: editing.title,
									author: editing.author,
									url: editing.url,
									display_order: String(editing.display_order),
									cover_image: null,
									existing_cover_url: editing.cover_image,
								}
							: EMPTY_FORM
					}
					onSubmit={handleSave}
					onCancel={() => setModalOpen(false)}
				/>
			</Modal>
		</AdminLayout>
	);
}

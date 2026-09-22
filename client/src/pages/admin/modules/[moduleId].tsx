import { useEffect, useState, type FormEvent } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AdminLayout from "@/components/admin/AdminLayout";
import { PencilIcon, TrashIcon } from "@/components/ui/icons";
import {
	getModuleAdmin,
	updateModule,
	createContentItem,
	updateContentItem,
	deleteContentItem,
} from "@/lib/api";
import type { AdminModule, AdminContentItem } from "@/types/admin";

type ContentItemFormState = {
	title: string;
	type: "video" | "audio" | "text";
	provider: "youtube" | "soundcloud" | "";
	embed_url: string;
	body: string;
};

const EMPTY_ITEM_FORM: ContentItemFormState = { title: "", type: "text", provider: "", embed_url: "", body: "" };

function ContentItemForm({
	initial,
	onSubmit,
	onCancel,
}: {
	initial: ContentItemFormState;
	onSubmit: (data: ContentItemFormState) => Promise<void>;
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
			setError(err instanceof Error ? err.message : "Failed to save content item");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5">
			{error && <p className="text-sm text-red-600" role="alert">{error}</p>}

			<div className="flex flex-col gap-2">
				<label htmlFor="item-title" className="text-sm font-semibold text-ink">Title</label>
				<input
					id="item-title"
					required
					value={form.title}
					onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
					className="h-11 rounded-xl border border-gray-200 px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue"
				/>
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="item-type" className="text-sm font-semibold text-ink">Type</label>
				<select
					id="item-type"
					value={form.type}
					onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ContentItemFormState["type"] }))}
					className="h-11 rounded-xl border border-gray-200 px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue"
				>
					<option value="text">Text</option>
					<option value="video">Video</option>
					<option value="audio">Audio</option>
				</select>
			</div>

			{form.type === "text" ? (
				<div className="flex flex-col gap-2">
					<label htmlFor="item-body" className="text-sm font-semibold text-ink">
						Content (Markdown)
					</label>
					<textarea
						id="item-body"
						rows={6}
						value={form.body}
						onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
						className="resize-none rounded-xl border border-gray-200 p-3 font-mono text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue"
					/>
					{form.body.trim() && (
						<div className="rounded-xl border border-gray-100 bg-surface-muted p-3">
							<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
							<div className="prose prose-neutral prose-sm max-w-none break-words">
								<ReactMarkdown remarkPlugins={[remarkGfm]}>{form.body}</ReactMarkdown>
							</div>
						</div>
					)}
				</div>
			) : (
				<>
					<div className="flex flex-col gap-2">
						<label htmlFor="item-provider" className="text-sm font-semibold text-ink">Provider</label>
						<select
							id="item-provider"
							value={form.provider}
							onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as ContentItemFormState["provider"] }))}
							className="h-11 rounded-xl border border-gray-200 px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue"
						>
							<option value="">Select a provider…</option>
							<option value="youtube">YouTube</option>
							<option value="soundcloud">SoundCloud</option>
						</select>
					</div>
					<div className="flex flex-col gap-2">
						<label htmlFor="item-embed-url" className="text-sm font-semibold text-ink">Embed URL</label>
						<input
							id="item-embed-url"
							type="url"
							value={form.embed_url}
							onChange={(e) => setForm((f) => ({ ...f, embed_url: e.target.value }))}
							placeholder="https://www.youtube.com/embed/…"
							className="h-11 rounded-xl border border-gray-200 px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue"
						/>
					</div>
				</>
			)}

			<div className="flex gap-3">
				<button
					type="submit"
					disabled={submitting}
					className="h-11 flex-1 rounded-xl bg-brand-blue-dark text-sm font-bold text-white disabled:opacity-50"
				>
					{submitting ? "Saving…" : "Save"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="h-11 flex-1 rounded-xl border border-gray-200 text-sm font-semibold text-ink"
				>
					Cancel
				</button>
			</div>
		</form>
	);
}

export default function AdminModuleEditorPage() {
	const router = useRouter();
	const moduleId = router.query.moduleId;

	const [module, setModule] = useState<AdminModule | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [addingItem, setAddingItem] = useState(false);
	const [editingItem, setEditingItem] = useState<AdminContentItem | null>(null);
	const [metaSaving, setMetaSaving] = useState(false);

	useEffect(() => {
		if (!moduleId || Array.isArray(moduleId)) return;
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const data = await getModuleAdmin(Number(moduleId), token);
				if (!cancelled) setModule(data);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load module");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, [moduleId]);

	async function refresh() {
		if (!module) return;
		const token = localStorage.getItem("token") ?? "";
		const data = await getModuleAdmin(module.id, token);
		setModule(data);
	}

	async function handleMetaSave(e: FormEvent) {
		e.preventDefault();
		if (!module) return;
		setMetaSaving(true);
		try {
			const token = localStorage.getItem("token") ?? "";
			const updated = await updateModule(
				module.id,
				{ title: module.title, description: module.description, week_number: module.week_number, is_published: module.is_published },
				token,
			);
			setModule((prev) => (prev ? { ...prev, ...updated } : prev));
		} finally {
			setMetaSaving(false);
		}
	}

	async function handleAddItem(form: ContentItemFormState) {
		if (!module) return;
		const token = localStorage.getItem("token") ?? "";
		await createContentItem({ module: module.id, ...form }, token);
		setAddingItem(false);
		await refresh();
	}

	async function handleEditItem(form: ContentItemFormState) {
		if (!editingItem) return;
		const token = localStorage.getItem("token") ?? "";
		await updateContentItem(editingItem.id, form, token);
		setEditingItem(null);
		await refresh();
	}

	async function handleDeleteItem(item: AdminContentItem) {
		if (!confirm(`Delete content item "${item.title}"?`)) return;
		const token = localStorage.getItem("token") ?? "";
		await deleteContentItem(item.id, token);
		await refresh();
	}

	if (loading) {
		return (
			<AdminLayout>
				<div className="flex justify-center py-16">
					<span className="text-sm text-muted">Loading…</span>
				</div>
			</AdminLayout>
		);
	}

	if (error || !module) {
		return (
			<AdminLayout>
				<p className="text-sm text-red-600">{error ?? "Module not found."}</p>
			</AdminLayout>
		);
	}

	return (
		<AdminLayout>
			<Head>
				<title>{module.title} — Admin</title>
			</Head>

			<form onSubmit={handleMetaSave} className="rounded-2xl border border-gray-200 bg-white p-5">
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="flex flex-col gap-2">
						<label htmlFor="meta-week" className="text-sm font-semibold text-ink">Week number</label>
						<input
							id="meta-week"
							type="number"
							value={module.week_number}
							onChange={(e) => setModule((m) => m && { ...m, week_number: Number(e.target.value) })}
							className="h-11 rounded-xl border border-gray-200 px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue"
						/>
					</div>
					<div className="flex flex-col gap-2">
						<label htmlFor="meta-title" className="text-sm font-semibold text-ink">Title</label>
						<input
							id="meta-title"
							value={module.title}
							onChange={(e) => setModule((m) => m && { ...m, title: e.target.value })}
							className="h-11 rounded-xl border border-gray-200 px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue"
						/>
					</div>
				</div>
				<div className="mt-4 flex flex-col gap-2">
					<label htmlFor="meta-description" className="text-sm font-semibold text-ink">Description</label>
					<textarea
						id="meta-description"
						rows={3}
						value={module.description}
						onChange={(e) => setModule((m) => m && { ...m, description: e.target.value })}
						className="resize-none rounded-xl border border-gray-200 p-3 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue"
					/>
				</div>
				<label className="mt-4 flex items-center gap-2 text-sm font-semibold text-ink">
					<input
						type="checkbox"
						checked={module.is_published}
						onChange={(e) => setModule((m) => m && { ...m, is_published: e.target.checked })}
					/>
					Published
				</label>
				<button
					type="submit"
					disabled={metaSaving}
					className="mt-4 h-11 rounded-xl bg-brand-blue-dark px-6 text-sm font-bold text-white disabled:opacity-50"
				>
					{metaSaving ? "Saving…" : "Save module"}
				</button>
			</form>

			<div className="mt-6 flex items-center justify-between">
				<h2 className="text-lg font-extrabold text-ink">Content items</h2>
				{!addingItem && (
					<button
						type="button"
						onClick={() => setAddingItem(true)}
						className="rounded-xl bg-brand-blue px-4 py-2 text-sm font-bold text-white"
					>
						Add content item
					</button>
				)}
			</div>

			<div className="mt-4 space-y-3">
				{addingItem && (
					<ContentItemForm
						initial={EMPTY_ITEM_FORM}
						onSubmit={handleAddItem}
						onCancel={() => setAddingItem(false)}
					/>
				)}

				{module.content_items.length === 0 && !addingItem && (
					<p className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-muted">
						No content items yet.
					</p>
				)}

				{module.content_items.map((item) =>
					editingItem?.id === item.id ? (
						<ContentItemForm
							key={item.id}
							initial={{ title: item.title, type: item.type, provider: item.provider, embed_url: item.embed_url, body: item.body }}
							onSubmit={handleEditItem}
							onCancel={() => setEditingItem(null)}
						/>
					) : (
						<div key={item.id} className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4">
							<div className="flex items-center gap-3">
								<span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold uppercase text-muted">
									{item.type}
								</span>
								<span className="text-sm font-semibold text-ink">{item.title}</span>
							</div>
							<div className="flex gap-3">
								<button type="button" onClick={() => setEditingItem(item)} aria-label="Edit content item">
									<PencilIcon className="size-4 text-muted hover:text-brand-blue" />
								</button>
								<button type="button" onClick={() => handleDeleteItem(item)} aria-label="Delete content item">
									<TrashIcon className="size-4 text-muted hover:text-red-500" />
								</button>
							</div>
						</div>
					)
				)}
			</div>
		</AdminLayout>
	);
}

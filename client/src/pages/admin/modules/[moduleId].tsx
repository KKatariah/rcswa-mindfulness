import { useEffect, useRef, useState, type FormEvent } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AdminLayout from "@/components/admin/AdminLayout";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ContentEmbed from "@/components/modules/ContentEmbed";
import ModuleProgress from "@/components/admin/ModuleProgress";
import DragHandle, { ReorderHelp } from "@/components/ui/DragHandle";
import { PencilIcon, TrashIcon } from "@/components/ui/icons";
import { useDragReorder, type ReorderHandlers } from "@/hooks/useDragReorder";
import {
	getModuleAdmin,
	updateModule,
	deleteModule,
	createContentItem,
	updateContentItem,
	deleteContentItem,
	reorderContentItems,
} from "@/lib/api";
import type { AdminModule, AdminContentItem } from "@/types/admin";

type ContentItemFormState = {
	title: string;
	type: "video" | "audio";
	provider: "youtube" | "soundcloud" | "";
	embed_url: string;
};

const EMPTY_ITEM_FORM: ContentItemFormState = { title: "", type: "video", provider: "", embed_url: "" };

// Mirrors the backend's normalize_youtube_embed_url/normalize_soundcloud_embed_url
// matching in app/models.py, so a link is classified the same way client-side.
const YOUTUBE_URL_RE =
	/youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)[A-Za-z0-9_-]{11}|youtu\.be\/[A-Za-z0-9_-]{11}/;
const SOUNDCLOUD_URL_RE = /^https?:\/\/(?:www\.)?soundcloud\.com\/\S+$/;
const SOUNDCLOUD_EMBED_PREFIX = "https://w.soundcloud.com/player/";

function detectProvider(url: string): "youtube" | "soundcloud" | null {
	const trimmed = url.trim();
	if (!trimmed) return null;
	if (YOUTUBE_URL_RE.test(trimmed)) return "youtube";
	if (trimmed.startsWith(SOUNDCLOUD_EMBED_PREFIX) || SOUNDCLOUD_URL_RE.test(trimmed)) return "soundcloud";
	return null;
}

const YOUTUBE_ID_RE = /(?:[?&]v=|embed\/|shorts\/|\/v\/|youtu\.be\/)([A-Za-z0-9_-]{11})/;

// Client-side copy of the backend's link normalisation, so the preview shows what students will see.
function toEmbedUrl(url: string, provider: "youtube" | "soundcloud"): string | null {
	const trimmed = url.trim();
	if (provider === "youtube") {
		const id = trimmed.match(YOUTUBE_ID_RE)?.[1];
		return id ? `https://www.youtube.com/embed/${id}` : null;
	}
	if (trimmed.startsWith(SOUNDCLOUD_EMBED_PREFIX)) return trimmed;
	return `${SOUNDCLOUD_EMBED_PREFIX}?url=${encodeURIComponent(trimmed)}`;
}

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

	const previewProvider = detectProvider(form.embed_url);
	const previewUrl = previewProvider ? toEmbedUrl(form.embed_url, previewProvider) : null;

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);

		const provider = detectProvider(form.embed_url);
		if (!provider) {
			setError("Enter a valid YouTube or SoundCloud link.");
			return;
		}
		const toSubmit: ContentItemFormState = { ...form, type: provider === "soundcloud" ? "audio" : "video", provider };

		setSubmitting(true);
		try {
			await onSubmit(toSubmit);
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
				<label htmlFor="item-embed-url" className="text-sm font-semibold text-ink">Link</label>
				<input
					id="item-embed-url"
					type="url"
					value={form.embed_url}
					onChange={(e) => setForm((f) => ({ ...f, embed_url: e.target.value }))}
					placeholder="Paste a YouTube or SoundCloud link…"
					className="h-11 rounded-xl border border-gray-200 px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue"
				/>
				{previewProvider && previewUrl && (
					<div className="rounded-xl border border-gray-100 bg-surface-muted p-3">
						<p className="text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
						<ContentEmbed
							type={previewProvider === "soundcloud" ? "audio" : "video"}
							title={form.title || undefined}
							embedUrl={previewUrl}
						/>
					</div>
				)}
			</div>

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
	// Publish state as last saved, so a save that flips it can ask first.
	const [savedPublished, setSavedPublished] = useState(false);
	const [confirmingPublish, setConfirmingPublish] = useState(false);
	const [deletingItem, setDeletingItem] = useState<AdminContentItem | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [addingItem, setAddingItem] = useState(false);
	const [editingItem, setEditingItem] = useState<AdminContentItem | null>(null);
	const [metaSaving, setMetaSaving] = useState(false);
	const [metaError, setMetaError] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const { draggingId, startDrag, handleKey } = useDragReorder<number>();
	const [confirmingModuleDelete, setConfirmingModuleDelete] = useState(false);
	const descriptionRef = useRef<HTMLTextAreaElement>(null);

	// Grow the description box to fit its text so long descriptions aren't hidden behind a scrollbar.
	const description = module?.description;
	useEffect(() => {
		const el = descriptionRef.current;
		if (!el) return;
		const fit = () => {
			el.style.height = "auto";
			el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
		};
		fit();
		// Text rewraps when the window width changes.
		window.addEventListener("resize", fit);
		return () => window.removeEventListener("resize", fit);
	}, [description]);
	const [moduleDeleting, setModuleDeleting] = useState(false);
	const [moduleDeleteError, setModuleDeleteError] = useState<string | null>(null);

	useEffect(() => {
		if (!moduleId || Array.isArray(moduleId)) return;
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const data = await getModuleAdmin(Number(moduleId), token);
				if (!cancelled) {
					setModule(data);
					setSavedPublished(data.is_published);
				}
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

	function handleMetaSubmit(e: FormEvent) {
		e.preventDefault();
		if (!module) return;
		if (module.is_published !== savedPublished) {
			setConfirmingPublish(true);
			return;
		}
		saveMeta();
	}

	async function saveMeta() {
		if (!module) return;
		setConfirmingPublish(false);
		setMetaSaving(true);
		setMetaError(null);
		try {
			const token = localStorage.getItem("token") ?? "";
			const updated = await updateModule(
				module.id,
				{ title: module.title, description: module.description, summary: module.summary, week_number: module.week_number, is_published: module.is_published },
				token,
			);
			setModule((prev) => (prev ? { ...prev, ...updated } : prev));
			setSavedPublished(updated.is_published);
		} catch (err) {
			setMetaError(err instanceof Error ? err.message : "Failed to save module");
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

	function itemReorder(current: AdminModule): ReorderHandlers<number> {
		const byId = new Map(current.content_items.map((item) => [item.id, item]));
		const arrange = (ids: number[]) => setModule((m) => m && { ...m, content_items: ids.map((id) => byId.get(id)!) });
		return {
			onMove: arrange,
			onCancel: arrange,
			onDrop: async (ids, before) => {
				setDeleteError(null);
				try {
					await reorderContentItems(current.id, ids, localStorage.getItem("token") ?? "");
				} catch (err) {
					arrange(before);
					setDeleteError(err instanceof Error ? err.message : "Failed to reorder content items");
				}
			},
		};
	}

	async function handleDeleteItem() {
		if (!deletingItem) return;
		const item = deletingItem;
		setDeletingItem(null);
		setDeleteError(null);
		const token = localStorage.getItem("token") ?? "";
		try {
			await deleteContentItem(item.id, token);
			await refresh();
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : "Failed to delete content item");
		}
	}

	async function handleDeleteModule() {
		if (!module) return;
		setConfirmingModuleDelete(false);
		setModuleDeleteError(null);
		setModuleDeleting(true);
		try {
			const token = localStorage.getItem("token") ?? "";
			await deleteModule(module.id, token);
			router.push("/admin/modules");
		} catch (err) {
			setModuleDeleteError(err instanceof Error ? err.message : "Failed to delete module");
			setModuleDeleting(false);
		}
	}

	// Matches send_due_reminders: the week's first audio item is the one students are reminded about each day.
	const reminderItemId = module?.content_items.find((item) => item.type === "audio")?.id;

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

			<form onSubmit={handleMetaSubmit} className="rounded-2xl border border-gray-200 bg-white p-5">
				{metaError && (
					<p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600" role="alert">
						{metaError}
					</p>
				)}
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
					<label htmlFor="meta-summary" className="text-sm font-semibold text-ink">
						Summary <span className="font-normal text-muted">(shown on the homepage)</span>
					</label>
					<input
						id="meta-summary"
						maxLength={300}
						value={module.summary}
						onChange={(e) => setModule((m) => m && { ...m, summary: e.target.value })}
						className="h-11 rounded-xl border border-gray-200 px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue"
					/>
					<p className="text-right text-xs text-muted">{module.summary.length}/300</p>
				</div>
				<div className="mt-4 flex flex-col gap-2">
					<label htmlFor="meta-description" className="text-sm font-semibold text-ink">
						Description (Markdown)
					</label>
					<textarea
						id="meta-description"
						ref={descriptionRef}
						rows={14}
						value={module.description}
						onChange={(e) => setModule((m) => m && { ...m, description: e.target.value })}
						className="resize-y overflow-y-auto rounded-xl border border-gray-200 p-3 font-mono text-sm leading-relaxed text-ink outline-none focus:ring-2 focus:ring-brand-blue"
					/>
					{module.description.trim() && (
						<div className="rounded-xl border border-gray-100 bg-surface-muted p-3">
							<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
							<div className="prose prose-neutral prose-sm max-w-none break-words">
								<ReactMarkdown remarkPlugins={[remarkGfm]}>{module.description}</ReactMarkdown>
							</div>
						</div>
					)}
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

			{deleteError && (
				<p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600" role="alert">
					{deleteError}
				</p>
			)}

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
							initial={{ title: item.title, type: item.type, provider: item.provider, embed_url: item.embed_url }}
							onSubmit={handleEditItem}
							onCancel={() => setEditingItem(null)}
						/>
					) : (
						<div
							key={item.id}
							data-reorder-id={item.id}
							className={`flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 ${
								draggingId === item.id ? "opacity-50" : ""
							}`}
						>
							<div className="flex min-w-0 items-center gap-3">
								<DragHandle
									label={`Reorder ${item.title}`}
									onPointerDown={(e) => startDrag(e, item.id, module.content_items.map((i) => i.id), itemReorder(module))}
									onKeyDown={(e) => handleKey(e, item.id, module.content_items.map((i) => i.id), itemReorder(module))}
									disabled={editingItem !== null}
								/>
								<span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold uppercase text-muted">
									{item.type}
								</span>
								<span className="min-w-0 wrap-anywhere text-sm font-semibold text-ink">{item.title}</span>
								{item.id === reminderItemId && (
									<span
										title="Students get a reminder for this meditation every day of the week"
										className="shrink-0 rounded-full bg-brand-blue/10 px-2.5 py-0.5 text-xs font-semibold text-brand-blue"
									>
										Daily reminder
									</span>
								)}
							</div>
							<div className="flex items-center gap-3">
								<button type="button" onClick={() => setEditingItem(item)} aria-label="Edit content item">
									<PencilIcon className="size-4 text-muted hover:text-brand-blue" />
								</button>
								<button type="button" onClick={() => setDeletingItem(item)} aria-label="Delete content item">
									<TrashIcon className="size-4 text-muted hover:text-red-500" />
								</button>
							</div>
						</div>
					)
				)}
			</div>

			<ReorderHelp />

			<ModuleProgress moduleId={module.id} items={module.content_items} />

			<div className="mt-8 flex items-center justify-between rounded-2xl border border-red-200 bg-red-50 p-4">
				<div>
					<p className="text-sm font-semibold text-red-700">Danger zone</p>
					<p className="text-xs text-red-600">
						Permanently delete this module, its content items, and all student completion history for them.
					</p>
				</div>
				<button
					type="button"
					onClick={() => setConfirmingModuleDelete(true)}
					disabled={moduleDeleting}
					className="h-10 shrink-0 rounded-xl border border-red-300 px-4 text-sm font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
				>
					{moduleDeleting ? "Deleting…" : "Delete module"}
				</button>
			</div>
			{moduleDeleteError && (
				<p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600" role="alert">
					{moduleDeleteError}
				</p>
			)}

			{confirmingPublish && (
				<ConfirmDialog
					title={module.is_published ? `Publish "${module.title}"?` : `Unpublish "${module.title}"?`}
					message={
						module.is_published
							? "Students will be able to see this module once their cohort reaches its week, and it will appear on the homepage."
							: "Students will no longer be able to open this module, including anyone partway through it. Their completion history is kept."
					}
					confirmLabel={module.is_published ? "Publish" : "Unpublish"}
					danger={!module.is_published}
					onConfirm={saveMeta}
					onCancel={() => setConfirmingPublish(false)}
				/>
			)}

			{deletingItem && (
				<ConfirmDialog
					title={`Delete "${deletingItem.title}"?`}
					message="This permanently deletes the content item and every student's completion record for it. This can't be undone."
					confirmLabel="Delete item"
					danger
					onConfirm={handleDeleteItem}
					onCancel={() => setDeletingItem(null)}
				/>
			)}

			{confirmingModuleDelete && (
				<ConfirmDialog
					title={`Delete "${module.title}"?`}
					message={
						module.content_items.length === 0
							? "This module has no content items yet. This can't be undone."
							: `This will permanently delete ${module.content_items.length} content item${module.content_items.length === 1 ? "" : "s"} and all student completion history for ${module.content_items.length === 1 ? "it" : "them"}. This can't be undone.`
					}
					confirmLabel="Delete module"
					danger
					onConfirm={handleDeleteModule}
					onCancel={() => setConfirmingModuleDelete(false)}
				/>
			)}
		</AdminLayout>
	);
}

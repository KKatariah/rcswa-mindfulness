import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import AdminLayout from "@/components/admin/AdminLayout";
import DangerZone from "@/components/admin/DangerZone";
import ModuleProgress from "@/components/admin/ModuleProgress";
import ContentEmbed from "@/components/modules/ContentEmbed";
import Card from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DragHandle, { ReorderHelp } from "@/components/ui/DragHandle";
import { ErrorBanner, LoadingState } from "@/components/ui/feedback";
import { FormActions, FormError, TextAreaField, TextField } from "@/components/ui/form";
import { PencilIcon, TrashIcon } from "@/components/ui/icons";
import Markdown from "@/components/ui/Markdown";
import { useAsync } from "@/hooks/useAsync";
import { useDragReorder, type ReorderHandlers } from "@/hooks/useDragReorder";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import {
	getModuleAdmin,
	updateModule,
	deleteModule,
	createContentItem,
	updateContentItem,
	deleteContentItem,
	reorderContentItems,
} from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { deleteModuleMessage } from "@/lib/modules";
import type { AdminModule, AdminContentItem } from "@/types/admin";
import { adminPageTitle } from "@/lib/pageTitle";
import Button from "@/components/ui/Button";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { weekLabel } from "@/lib/weeks";

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
	const { submitting, error, setError, run } = useFormSubmit("Failed to save content item");

	const previewProvider = detectProvider(form.embed_url);
	const previewUrl = previewProvider ? toEmbedUrl(form.embed_url, previewProvider) : null;

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const provider = detectProvider(form.embed_url);
		if (!provider) {
			setError("Enter a valid YouTube or SoundCloud link.");
			return;
		}
		void run(() => onSubmit({ ...form, type: provider === "soundcloud" ? "audio" : "video", provider }));
	}

	return (
		<Card as="form" onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
			<FormError message={error} />

			<TextField
				id="item-title"
				label="Title"
				size="md"
				required
				value={form.title}
				onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
			/>

			<div className="flex flex-col gap-2">
				<TextField
					id="item-embed-url"
					label="Link"
					size="md"
					type="url"
					value={form.embed_url}
					onChange={(e) => setForm((f) => ({ ...f, embed_url: e.target.value }))}
					placeholder="Paste a YouTube or SoundCloud link…"
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

			<FormActions submitting={submitting} onCancel={onCancel} size="md" className="" />
		</Card>
	);
}

export default function AdminModuleEditorPage() {
	const router = useRouter();
	const moduleId = router.query.moduleId;
	const validId = typeof moduleId === "string";

	// Publish state as last saved, so a save that flips it can ask first.
	const [savedPublished, setSavedPublished] = useState(false);
	const { data: module, setData: setModule, loading, error } = useAsync(
		async () => {
			const loaded = await getModuleAdmin(Number(moduleId));
			setSavedPublished(loaded.is_published);
			return loaded;
		},
		[moduleId],
		null as AdminModule | null,
		{ enabled: validId, errorFallback: "Failed to load module" },
	);
	const [addingItem, setAddingItem] = useState(false);
	const [editingItem, setEditingItem] = useState<AdminContentItem | null>(null);
	const meta = useFormSubmit("Failed to save module");
	const [deleteError, setDeleteError] = useState<string | null>(null);
	// A dragged content-item order waiting to be saved, like every other edit on this page.
	const [pendingItemOrder, setPendingItemOrder] = useState<number[] | null>(null);
	const [savingItemOrder, setSavingItemOrder] = useState(false);
	const { draggingId, startDrag, handleKey } = useDragReorder<number>();
	const [confirmingModuleDelete, setConfirmingModuleDelete] = useState(false);
	const [moduleDeleting, setModuleDeleting] = useState(false);
	const [deletingItem, setDeletingItem] = useState<AdminContentItem | null>(null);
	const [confirmingPublish, setConfirmingPublish] = useState(false);
	const [moduleDeleteError, setModuleDeleteError] = useState<string | null>(null);
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

	// Edits the loaded module in place (the meta form is bound straight to it).
	const patch = (changes: Partial<AdminModule>) => setModule((m) => m && { ...m, ...changes });

	async function refresh() {
		if (!module) return;
		setModule(await getModuleAdmin(module.id));
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

	function saveMeta() {
		if (!module) return;
		setConfirmingPublish(false);
		void meta.run(async () => {
			const updated = await updateModule(module.id, {
				title: module.title,
				description: module.description,
				summary: module.summary,
				week_number: module.week_number,
				is_published: module.is_published,
			});
			patch(updated);
			setSavedPublished(updated.is_published);
		});
	}

	async function handleAddItem(form: ContentItemFormState) {
		if (!module) return;
		await createContentItem({ module: module.id, ...form });
		setAddingItem(false);
		await refresh();
	}

	async function handleEditItem(form: ContentItemFormState) {
		if (!editingItem) return;
		await updateContentItem(editingItem.id, form);
		setEditingItem(null);
		await refresh();
	}

	const savedItems = module?.content_items;
	const shownItems = useMemo(() => {
		if (!savedItems || !pendingItemOrder) return savedItems ?? [];
		const byId = new Map(savedItems.map((item) => [item.id, item]));
		// Items added or deleted since the drag keep the pending order for the rest.
		const kept = pendingItemOrder.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
		return [...kept, ...savedItems.filter((item) => !pendingItemOrder.includes(item.id))];
	}, [savedItems, pendingItemOrder]);

	const itemReorder: ReorderHandlers<number> = {
		onMove: (ids) => setPendingItemOrder(ids.join() === savedItems?.map((i) => i.id).join() ? null : ids),
		onDrop: () => {},
		onCancel: (before) => setPendingItemOrder(before.join() === savedItems?.map((i) => i.id).join() ? null : before),
	};

	async function saveItemOrder() {
		if (!module || !pendingItemOrder) return;
		setSavingItemOrder(true);
		setDeleteError(null);
		try {
			await reorderContentItems(module.id, shownItems.map((i) => i.id));
			patch({ content_items: shownItems });
			setPendingItemOrder(null);
		} catch (err) {
			setDeleteError(errorMessage(err, "Failed to reorder content items"));
		} finally {
			setSavingItemOrder(false);
		}
	}

	async function handleDeleteItem() {
		if (!deletingItem) return;
		const item = deletingItem;
		setDeletingItem(null);
		setDeleteError(null);
		try {
			await deleteContentItem(item.id);
			await refresh();
		} catch (err) {
			setDeleteError(errorMessage(err, "Failed to delete content item"));
		}
	}

	async function handleDeleteModule() {
		if (!module) return;
		setConfirmingModuleDelete(false);
		setModuleDeleteError(null);
		setModuleDeleting(true);
		try {
			await deleteModule(module.id);
			router.push("/admin/modules");
		} catch (err) {
			setModuleDeleteError(errorMessage(err, "Failed to delete module"));
			setModuleDeleting(false);
		}
	}

	// Matches send_due_reminders: the week's first audio item is the one students are reminded about each day.
	const reminderItemId = shownItems.find((item) => item.type === "audio")?.id;

	if (loading) {
		return (
			<AdminLayout>
				<LoadingState />
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
				<title>{adminPageTitle(module.title)}</title>
			</Head>
			{/* The stored title exactly as in the Title field below, with the week as a label above it. */}
			<AdminPageHeader
				title={module.title}
				eyebrow={weekLabel(module.week_number)}
				back={{ href: "/admin/modules", label: "All modules" }}
			/>

			<Card as="form" onSubmit={handleMetaSubmit} className="mt-4 p-5">
				{meta.error && <ErrorBanner className="mb-4">{meta.error}</ErrorBanner>}
				<div className="grid gap-4 sm:grid-cols-2">
					<TextField
						id="meta-week"
						label="Week number"
						size="md"
						type="number"
						value={module.week_number}
						onChange={(e) => patch({ week_number: Number(e.target.value) })}
					/>
					<TextField
						id="meta-title"
						label="Title"
						size="md"
						value={module.title}
						onChange={(e) => patch({ title: e.target.value })}
					/>
				</div>
				<div className="mt-4 flex flex-col gap-2">
					<TextField
						id="meta-summary"
						label={
							<>
								Summary <span className="font-normal text-muted">(shown on the homepage)</span>
							</>
						}
						size="md"
						maxLength={300}
						value={module.summary}
						onChange={(e) => patch({ summary: e.target.value })}
					/>
					<p className="text-right text-xs text-muted">{module.summary.length}/300</p>
				</div>
				<div className="mt-4 flex flex-col gap-2">
					<TextAreaField
						id="meta-description"
						label="Description (Markdown)"
						size="md"
						ref={descriptionRef}
						rows={14}
						value={module.description}
						onChange={(e) => patch({ description: e.target.value })}
						className="resize-y overflow-y-auto font-mono leading-relaxed"
					/>
					{module.description.trim() && (
						<div className="rounded-xl border border-gray-100 bg-surface-muted p-3">
							<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
							<Markdown className="prose-sm">{module.description}</Markdown>
						</div>
					)}
				</div>
				<label className="mt-4 flex items-center gap-2 text-sm font-semibold text-ink">
					<input
						type="checkbox"
						checked={module.is_published}
						onChange={(e) => patch({ is_published: e.target.checked })}
					/>
					Published
				</label>
				<Button
					type="submit"
					disabled={meta.submitting}
					variant="dark" size="md" className="mt-4 px-6"
				>
					{meta.submitting ? "Saving…" : "Save module"}
				</Button>
			</Card>

			{deleteError && <ErrorBanner className="mt-4">{deleteError}</ErrorBanner>}

			<div className="mt-6 flex items-center justify-between">
				<h2 className="text-lg font-extrabold text-ink">Content items</h2>
				{!addingItem && (
					<Button
						type="button"
						onClick={() => setAddingItem(true)}
						variant="primary" size={null} className="rounded-xl px-4 py-2 text-sm font-bold"
					>
						Add content item
					</Button>
				)}
			</div>

			<div className="mt-4 space-y-3">
				{addingItem && (
					<ContentItemForm initial={EMPTY_ITEM_FORM} onSubmit={handleAddItem} onCancel={() => setAddingItem(false)} />
				)}

				{module.content_items.length === 0 && !addingItem && (
					<Card as="p" className="p-6 text-sm text-muted">
						No content items yet.
					</Card>
				)}

				{shownItems.map((item) =>
					editingItem?.id === item.id ? (
						<ContentItemForm
							key={item.id}
							initial={{ title: item.title, type: item.type, provider: item.provider, embed_url: item.embed_url }}
							onSubmit={handleEditItem}
							onCancel={() => setEditingItem(null)}
						/>
					) : (
						<Card
							key={item.id}
							data-reorder-id={item.id}
							className={`flex items-center justify-between gap-3 p-4 ${draggingId === item.id ? "opacity-50" : ""}`}
						>
							<div className="flex min-w-0 items-center gap-3">
								<DragHandle
									label={`Reorder ${item.title}`}
									onPointerDown={(e) => startDrag(e, item.id, shownItems.map((i) => i.id), itemReorder)}
									onKeyDown={(e) => handleKey(e, item.id, shownItems.map((i) => i.id), itemReorder)}
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
						</Card>
					),
				)}
			</div>

			{/* Only once the drag ends: toggling mid-drag (each time the row passes its old spot) resized the page and made the sticky sidebar jump. */}
			{pendingItemOrder && draggingId === null && (
				<div
					role="status"
					className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between"
				>
					<p>Content item order changed. Save to show students the new order.</p>
					<div className="flex shrink-0 gap-2">
						<button
							type="button"
							onClick={() => setPendingItemOrder(null)}
							disabled={savingItemOrder}
							className="h-10 rounded-xl border border-amber-300 bg-white px-4 font-semibold text-ink disabled:opacity-50"
						>
							Discard
						</button>
						<Button
							type="button"
							onClick={saveItemOrder}
							disabled={savingItemOrder}
							variant="primary" size={null} className="h-10 rounded-xl px-4 font-bold disabled:opacity-50"
						>
							{savingItemOrder ? "Saving…" : "Save order"}
						</Button>
					</div>
				</div>
			)}

			<ReorderHelp />

			<ModuleProgress moduleId={module.id} items={module.content_items} />

			<DangerZone
				description="Permanently delete this module, its content items, and all student completion history for them."
				actionLabel={moduleDeleting ? "Deleting…" : "Delete module"}
				onAction={() => setConfirmingModuleDelete(true)}
				disabled={moduleDeleting}
				className="mt-8"
			/>
			{moduleDeleteError && <ErrorBanner className="mt-3">{moduleDeleteError}</ErrorBanner>}

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
					message={deleteModuleMessage(module.content_items.length)}
					confirmLabel="Delete module"
					danger
					onConfirm={handleDeleteModule}
					onCancel={() => setConfirmingModuleDelete(false)}
				/>
			)}
		</AdminLayout>
	);
}

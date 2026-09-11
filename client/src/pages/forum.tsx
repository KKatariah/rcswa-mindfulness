import { type FormEvent, useEffect, useState } from "react";
import Head from "next/head";
import Navbar from "@/components/main/Navbar";
import Footer from "@/components/main/Footer";
import { useAuth } from "@/context/AuthContext";
import {
	createForumPost,
	createForumThread,
	deleteForumPost,
	deleteForumThread,
	getForumThread,
	getProgramStatus,
	listForumThreads,
	pinForumThread,
	updateForumPost,
} from "@/lib/api";
import type { ForumPost, ForumThread, ForumThreadDetail } from "@/types/forum";

// ── Utilities ──────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string) {
	const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (diff < 60) return "Just now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	const days = Math.floor(diff / 86400);
	if (days === 1) return "Yesterday";
	if (days < 7) return `${days}d ago`;
	return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function Avatar({ name }: { name: string }) {
	const trimmed = name.trim();
	const initial = trimmed && trimmed !== "Deleted user" ? trimmed[0].toUpperCase() : "?";
	return (
		<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-blue text-sm font-bold text-white">
			{initial}
		</div>
	);
}

// ── Composer ───────────────────────────────────────────────────────────────────

function Composer({ onSubmit }: { onSubmit: (body: string) => Promise<void> }) {
	const [body, setBody] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (!body.trim()) return;
		setError(null);
		setSubmitting(true);
		try {
			await onSubmit(body);
			setBody("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to post");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="rounded-2xl border border-gray-200 bg-white p-5">
			<form onSubmit={handleSubmit}>
				<textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					placeholder="What's on your mind?"
					rows={3}
					className="w-full resize-none rounded-xl border border-gray-200 bg-surface-muted p-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-blue"
				/>
				{error && <p className="mt-2 text-xs text-red-600">{error}</p>}
				<div className="mt-3 flex justify-end">
					<button
						type="submit"
						disabled={submitting || !body.trim()}
						className="rounded-xl bg-brand-blue px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
					>
						{submitting ? "Posting…" : "Post"}
					</button>
				</div>
			</form>
		</div>
	);
}

// ── Post card (reply) ──────────────────────────────────────────────────────────

type PostCardProps = {
	post: ForumPost;
	onEdit: (id: number, body: string) => void;
	onDelete: (id: number) => void;
};

function PostCard({ post, onEdit, onDelete }: PostCardProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(post.body);
	const [saving, setSaving] = useState(false);

	async function handleSave() {
		if (!draft.trim()) return;
		setSaving(true);
		try {
			await onEdit(post.id, draft);
			setEditing(false);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex gap-3">
			<Avatar name={post.author_name} />
			<div className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white p-4">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-baseline gap-2">
						<span className="text-sm font-semibold text-ink">{post.author_name}</span>
						<span className="text-xs text-muted">{formatRelativeTime(post.created_at)}</span>
					</div>
					{post.can_edit && !editing && (
						<div className="flex shrink-0 items-center gap-3">
							<button
								type="button"
								onClick={() => { setDraft(post.body); setEditing(true); }}
								className="text-xs font-semibold text-brand-blue hover:underline"
							>
								Edit
							</button>
							<button
								type="button"
								onClick={() => onDelete(post.id)}
								className="text-xs font-semibold text-red-500 hover:underline"
							>
								Delete
							</button>
						</div>
					)}
				</div>

				{editing ? (
					<div className="mt-3 space-y-2">
						<textarea
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							rows={3}
							className="w-full resize-none rounded-xl border border-gray-300 p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
						/>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={handleSave}
								disabled={saving}
								className="rounded-lg bg-brand-blue px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
							>
								{saving ? "Saving…" : "Save"}
							</button>
							<button
								type="button"
								onClick={() => setEditing(false)}
								className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-semibold text-ink"
							>
								Cancel
							</button>
						</div>
					</div>
				) : (
					<p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{post.body}</p>
				)}
			</div>
		</div>
	);
}

// ── Thread detail ──────────────────────────────────────────────────────────────

type ThreadDetailViewProps = {
	thread: ForumThreadDetail;
	onBack: () => void;
	onReply: (body: string) => Promise<void>;
	onEditPost: (id: number, body: string) => void;
	onDeletePost: (id: number) => void;
	onDeleteThread: () => void;
	onPinThread: (id: number, is_pinned: boolean) => void;
	isActive: boolean;
};

function ThreadDetailView({
	thread,
	onBack,
	onReply,
	onEditPost,
	onDeletePost,
	onDeleteThread,
	onPinThread,
	isActive,
}: ThreadDetailViewProps) {
	const [replyBody, setReplyBody] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [editingOpening, setEditingOpening] = useState(false);
	const [draftOpening, setDraftOpening] = useState(thread.opening_post?.body ?? thread.body);
	const [savingOpening, setSavingOpening] = useState(false);

	async function handleReply(e: FormEvent) {
		e.preventDefault();
		if (!replyBody.trim()) return;
		setSubmitting(true);
		try {
			await onReply(replyBody);
			setReplyBody("");
		} finally {
			setSubmitting(false);
		}
	}

	async function handleSaveOpeningPost() {
		if (!draftOpening.trim() || !thread.opening_post) return;
		setSavingOpening(true);
		try {
			await onEditPost(thread.opening_post.id, draftOpening);
			setEditingOpening(false);
		} finally {
			setSavingOpening(false);
		}
	}

	return (
		<div className="mx-auto max-w-2xl space-y-4">
			<button
				type="button"
				onClick={onBack}
				className="text-sm font-semibold text-brand-blue hover:underline"
			>
				← Back to forum
			</button>

			{/* Opening post */}
			<div className={`rounded-2xl border bg-white p-6 ${thread.is_pinned ? "border-amber-200" : "border-gray-200"}`}>
				{thread.is_pinned && (
					<p className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-600">
						Pinned
					</p>
				)}

				<div className="flex items-start gap-3">
					<Avatar name={thread.author_name} />
					<div className="min-w-0 flex-1">
						<div className="flex items-start justify-between gap-2">
							<div className="flex items-baseline gap-2">
								<span className="text-sm font-semibold text-ink">{thread.author_name}</span>
								<span className="text-xs text-muted">{formatRelativeTime(thread.created_at)}</span>
							</div>
							<div className="flex shrink-0 items-center gap-3">
								{thread.can_pin && !editingOpening && (
									<button
										type="button"
										onClick={() => onPinThread(thread.id, !thread.is_pinned)}
										className="text-xs font-semibold text-amber-600 hover:underline"
									>
										{thread.is_pinned ? "Unpin" : "Pin"}
									</button>
								)}
								{thread.opening_post?.can_edit && !editingOpening && (
									<button
										type="button"
										onClick={() => { setDraftOpening(thread.opening_post!.body); setEditingOpening(true); }}
										className="text-xs font-semibold text-brand-blue hover:underline"
									>
										Edit
									</button>
								)}
								{thread.can_edit && !editingOpening && (
									<button
										type="button"
										onClick={onDeleteThread}
										className="text-xs font-semibold text-red-500 hover:underline"
									>
										Delete
									</button>
								)}
							</div>
						</div>

						{editingOpening ? (
							<div className="mt-3 space-y-2">
								<textarea
									value={draftOpening}
									onChange={(e) => setDraftOpening(e.target.value)}
									rows={4}
									className="w-full resize-none rounded-xl border border-gray-300 p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
								/>
								<div className="flex gap-2">
									<button
										type="button"
										onClick={handleSaveOpeningPost}
										disabled={savingOpening}
										className="rounded-lg bg-brand-blue px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
									>
										{savingOpening ? "Saving…" : "Save"}
									</button>
									<button
										type="button"
										onClick={() => setEditingOpening(false)}
										className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-semibold text-ink"
									>
										Cancel
									</button>
								</div>
							</div>
						) : (
							<p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{thread.body}</p>
						)}
					</div>
				</div>
			</div>

			{/* Replies */}
			{thread.replies.length > 0 && (
				<div className="space-y-3">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted">
						{thread.replies.length} {thread.replies.length === 1 ? "Reply" : "Replies"}
					</p>
					{thread.replies.map((post) => (
						<PostCard
							key={post.id}
							post={post}
							onEdit={onEditPost}
							onDelete={onDeletePost}
						/>
					))}
				</div>
			)}

			{/* Reply composer */}
			{isActive ? (
				<form onSubmit={handleReply} className="rounded-2xl border border-gray-200 bg-white p-5">
					<p className="text-sm font-bold text-ink">Reply</p>
					<textarea
						value={replyBody}
						onChange={(e) => setReplyBody(e.target.value)}
						placeholder="Write your reply…"
						rows={3}
						required
						className="mt-3 w-full resize-none rounded-xl border border-gray-200 bg-surface-muted p-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-blue"
					/>
					<div className="mt-3 flex justify-end">
						<button
							type="submit"
							disabled={submitting || !replyBody.trim()}
							className="rounded-xl bg-brand-blue px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
						>
							{submitting ? "Posting…" : "Reply"}
						</button>
					</div>
				</form>
			) : (
				<p className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-muted">
					The forum is read-only — replies can&apos;t be posted right now.
				</p>
			)}
		</div>
	);
}

// ── Feed view ──────────────────────────────────────────────────────────────────

type FeedViewProps = {
	threads: ForumThread[];
	onSelect: (id: number) => void;
	onCreateThread: (body: string) => Promise<void>;
	isActive: boolean;
};

function FeedView({ threads, onSelect, onCreateThread, isActive }: FeedViewProps) {
	return (
		<div className="mx-auto max-w-2xl space-y-4">
			{isActive ? (
				<Composer onSubmit={onCreateThread} />
			) : (
				<p className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-muted">
					The forum is read-only — new threads can&apos;t be started right now.
				</p>
			)}

			{threads.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted">
					No threads yet. Be the first to start a conversation!
				</p>
			) : (
				threads.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => onSelect(t.id)}
						className={`w-full rounded-2xl border bg-white p-5 text-left transition-shadow hover:shadow-sm ${
							t.is_pinned
								? "border-amber-200"
								: "border-gray-200 hover:border-brand-blue/40"
						}`}
					>
						{t.is_pinned && (
							<p className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-600">
								Pinned
							</p>
						)}
						<div className="flex items-start gap-3">
							<Avatar name={t.author_name} />
							<div className="min-w-0 flex-1">
								<div className="flex items-baseline gap-2">
									<span className="text-sm font-semibold text-ink">{t.author_name}</span>
									<span className="text-xs text-muted">{formatRelativeTime(t.updated_at)}</span>
								</div>
								<p className="mt-1.5 line-clamp-3 text-sm text-ink-soft">{t.body}</p>
								<div className="mt-3">
									<span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-muted">
										{t.reply_count} {t.reply_count === 1 ? "reply" : "replies"}
									</span>
								</div>
							</div>
						</div>
					</button>
				))
			)}
		</div>
	);
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ForumPage() {
	const { user, isLoading: authLoading } = useAuth();
	const [threads, setThreads] = useState<ForumThread[]>([]);
	const [selectedThread, setSelectedThread] = useState<ForumThreadDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isActive, setIsActive] = useState(true);

	useEffect(() => {
		if (authLoading) return;

		let cancelled = false;

		(async () => {
			if (!user) {
				if (!cancelled) setLoading(false);
				return;
			}

			const token = localStorage.getItem("token") ?? "";
			try {
				const [data, status] = await Promise.all([
					listForumThreads(token),
					getProgramStatus(token),
				]);
				if (!cancelled) {
					setThreads(data);
					setIsActive(status.is_active);
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load forum");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => { cancelled = true; };
	}, [user, authLoading]);

	async function loadThread(id: number) {
		const token = localStorage.getItem("token") ?? "";
		try {
			const thread = await getForumThread(id, token);
			setSelectedThread(thread);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load thread");
		}
	}

	async function handleCreateThread(body: string) {
		const token = localStorage.getItem("token") ?? "";
		const thread = await createForumThread({ body }, token);
		setThreads((prev) => [thread, ...prev]);
	}

	async function handleReply(body: string) {
		if (!selectedThread) return;
		const token = localStorage.getItem("token") ?? "";
		await createForumPost({ thread: selectedThread.id, body }, token);
		await loadThread(selectedThread.id);
	}

	async function handleEditPost(id: number, body: string) {
		const token = localStorage.getItem("token") ?? "";
		await updateForumPost(id, { body }, token);
		if (selectedThread) await loadThread(selectedThread.id);
	}

	async function handleDeletePost(id: number) {
		if (!confirm("Delete this reply?")) return;
		const token = localStorage.getItem("token") ?? "";
		await deleteForumPost(id, token);
		if (selectedThread) await loadThread(selectedThread.id);
	}

	async function handlePinThread(id: number, is_pinned: boolean) {
		const token = localStorage.getItem("token") ?? "";
		await pinForumThread(id, is_pinned, token);
		setSelectedThread((prev) => prev && prev.id === id ? { ...prev, is_pinned } : prev);
		const updated = await listForumThreads(token);
		setThreads(updated);
	}

	async function handleDeleteThread() {
		if (!selectedThread) return;
		if (!confirm("Delete this thread and all its replies?")) return;
		const token = localStorage.getItem("token") ?? "";
		await deleteForumThread(selectedThread.id, token);
		setThreads((prev) => prev.filter((t) => t.id !== selectedThread.id));
		setSelectedThread(null);
	}

	return (
		<>
			<Head>
				<title>Forum — Wellbeing Course</title>
			</Head>

			<div className="min-h-screen bg-surface-muted">
				<div className="relative bg-brand-blue-dark px-6 pb-10 pt-0 sm:px-10 lg:px-30">
					<Navbar />
					<div className="pt-20 pb-4">
						<h1 className="text-3xl font-extrabold text-white">Community Forum</h1>
						<p className="mt-2 text-sm text-white/70">
							Share your experience and support fellow participants
						</p>
					</div>
				</div>

				<main className="px-6 py-8 sm:px-10 lg:px-30">
					{authLoading || loading ? (
						<div className="flex justify-center py-20">
							<span className="text-sm text-muted">Loading…</span>
						</div>
					) : !user ? (
						<div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center">
							<p className="font-semibold text-ink">Please log in to access the forum.</p>
							<p className="mt-2 text-sm text-muted">
								Use the Log In button in the navigation bar above.
							</p>
						</div>
					) : error ? (
						<div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
							<p className="font-semibold text-red-700">Something went wrong</p>
							<p className="mt-2 text-sm text-red-600">{error}</p>
							<button
								type="button"
								onClick={() => setError(null)}
								className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white"
							>
								Dismiss
							</button>
						</div>
					) : (
						<>
							{!isActive && (
								<div className="mx-auto mb-4 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center text-sm font-semibold text-amber-700">
									The program has ended — the forum is now read-only.
								</div>
							)}
							{selectedThread ? (
								<ThreadDetailView
									thread={selectedThread}
									onBack={() => setSelectedThread(null)}
									onReply={handleReply}
									onEditPost={handleEditPost}
									onDeletePost={handleDeletePost}
									onDeleteThread={handleDeleteThread}
									onPinThread={handlePinThread}
									isActive={isActive}
								/>
							) : (
								<FeedView
									threads={threads}
									onSelect={loadThread}
									onCreateThread={handleCreateThread}
									isActive={isActive}
								/>
							)}
						</>
					)}
				</main>

				<Footer />
			</div>
		</>
	);
}

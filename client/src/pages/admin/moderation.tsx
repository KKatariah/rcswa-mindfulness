import { type FormEvent, type ReactNode, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminTable from "@/components/admin/AdminTable";
import ForumRulesEditor from "@/components/admin/ForumRulesEditor";
import Modal from "@/components/main/Modal";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ErrorBanner, LoadingState } from "@/components/ui/feedback";
import { FormActions, FormError } from "@/components/ui/form";
import { LoadMore } from "@/components/ui/paging";
import Select from "@/components/ui/Select";
import Tabs from "@/components/ui/Tabs";
import { usePagedList } from "@/hooks/usePagedList";
import {
	type ForumBanDays,
	liftForumBan,
	listRemovedPosts,
	listReportedPosts,
	listUsers,
	moderateForumPost,
	restoreForumPost,
} from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { adminPageTitle } from "@/lib/pageTitle";
import type { AdminUser, ModeratedPost, ReportedPost } from "@/types/admin";
import { formatDateTime } from "@/lib/dates";

type Tab = "reported" | "removed" | "banned" | "rules";

const TABS: { id: Tab; label: string }[] = [
	{ id: "reported", label: "Reported" },
	{ id: "removed", label: "Removed posts" },
	{ id: "banned", label: "Banned users" },
	{ id: "rules", label: "Forum rules" },
];


function banEnds(until: string | null) {
	return until ? `until ${formatDateTime(until)}` : "until lifted";
}

function authorLabel(author: ModeratedPost["author"]) {
	if (!author) return "Deleted user";
	return author.display_name ? `${author.display_name} (${author.full_name})` : author.full_name || author.email;
}

/** "Opening post" or "Reply", the thread it's in, its author and its text. */
function PostSummary({ post, children }: { post: ModeratedPost; children?: ReactNode }) {
	return (
		<div className="min-w-0 space-y-2">
			<div className="flex flex-wrap items-center gap-2 text-xs text-muted">
				<Badge tone={post.is_head_post ? "blue" : "gray"}>{post.is_head_post ? "Opening post" : "Reply"}</Badge>
				<span>
					in{" "}
					{post.is_deleted && post.is_head_post ? (
						<span className="font-semibold text-ink">{post.thread_title}</span>
					) : (
						<Link href={`/forum?thread=${post.thread}`} className="font-semibold text-brand-blue hover:underline">
							{post.thread_title}
						</Link>
					)}
				</span>
				{post.cohort_name && <span>· {post.cohort_name}</span>}
				<span>· {formatDateTime(post.created_at)}</span>
			</div>
			<div className="flex flex-wrap items-center gap-2 text-sm">
				{post.author ? (
					<Link href={`/admin/users/${post.author.id}`} className="font-semibold text-ink hover:underline">
						{authorLabel(post.author)}
					</Link>
				) : (
					<span className="font-semibold text-ink">Deleted user</span>
				)}
				{post.author && <span className="text-muted">{post.author.email}</span>}
				{post.author?.forum_banned && (
					<span className="flex items-center gap-1.5 text-xs text-muted">
						<Badge tone="red">Banned</Badge>
						{banEnds(post.author.forum_banned_until)}
					</span>
				)}
			</div>
			<p className="whitespace-pre-wrap wrap-anywhere rounded-xl bg-surface-muted p-3 text-sm text-ink-soft">{post.body}</p>
			{children}
		</div>
	);
}

function RemovedNote({ post }: { post: ModeratedPost }) {
	if (!post.is_deleted) return null;
	const who = post.removed_by_author ? "its author" : (post.deleted_by_name ?? "someone");
	const what = post.is_head_post ? "Thread removed" : "Removed";
	return (
		<p className="text-xs font-semibold text-red-600">
			{what} by {who}
			{post.removed_by_author === false && " (moderator)"}
			{post.deleted_at && ` on ${formatDateTime(post.deleted_at)}`}
		</p>
	);
}

const BUTTON = "h-9 rounded-lg px-3 text-xs font-bold disabled:opacity-50 enabled:cursor-pointer";
const SECONDARY = `${BUTTON} border border-gray-200 bg-white text-ink-soft hover:border-brand-blue hover:text-brand-blue`;
const DANGER = `${BUTTON} border border-red-200 bg-white text-red-600 hover:bg-red-50`;

// ── Reported ───────────────────────────────────────────────────────────────────

const BAN_OPTIONS: { value: string; label: string; days: ForumBanDays }[] = [
	{ value: "1", label: "1 day", days: 1 },
	{ value: "7", label: "7 days", days: 7 },
	{ value: "30", label: "30 days", days: 30 },
	{ value: "", label: "Until I lift it", days: null },
];

/** Picks a ban length, then hides the post and bans its author. */
function BanDialog({
	post,
	onConfirm,
	onClose,
}: {
	post: ReportedPost;
	onConfirm: (days: ForumBanDays) => Promise<void>;
	onClose: () => void;
}) {
	const [choice, setChoice] = useState("7");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			await onConfirm(BAN_OPTIONS.find((o) => o.value === choice)!.days);
			onClose();
		} catch (err) {
			setError(errorMessage(err, "Failed to ban user"));
			setSubmitting(false);
		}
	}

	return (
		<Modal isOpen onClose={onClose} title="Ban from the forum">
			<form onSubmit={handleSubmit} className="flex flex-col gap-4">
				<p className="text-sm text-ink-soft">
					{post.is_head_post ? "This thread" : "This post"} will be hidden and {authorLabel(post.author)} won&apos;t
					be able to post, reply, edit or report in the forum. They can still read it and use the rest of the
					program.
				</p>
				<div className="flex flex-col gap-2">
					<span id="ban-length-label" className="text-sm font-semibold text-ink">
						Ban length
					</span>
					<Select
						id="ban-length"
						value={choice}
						onChange={setChoice}
						options={BAN_OPTIONS.map(({ value, label }) => ({ value, label }))}
						className="h-12 w-full"
					/>
				</div>
				<FormError message={error} />
				<FormActions submitting={submitting} submitLabel="Hide and ban" busyLabel="Banning…" onCancel={onClose} />
			</form>
		</Modal>
	);
}

function ReportedPanel() {
	const list = usePagedList((page) => listReportedPosts(page), [], { errorFallback: "Failed to load reported posts" });
	const [busyId, setBusyId] = useState<number | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [banning, setBanning] = useState<ReportedPost | null>(null);
	const [hiding, setHiding] = useState<ReportedPost | null>(null);

	async function act(post: ReportedPost, run: () => Promise<unknown>, fallback: string) {
		setBusyId(post.id);
		setActionError(null);
		try {
			await run();
			list.removeItem(post.id);
		} catch (e) {
			setActionError(errorMessage(e, fallback));
		} finally {
			setBusyId(null);
		}
	}

	if (list.loading) return <LoadingState />;
	if (list.error) return <ErrorBanner>{list.error}</ErrorBanner>;

	return (
		<div className="space-y-4">
			<p className="text-sm text-muted">
				{list.count === 0
					? "Nothing to review. Posts that students report will show up here."
					: `${list.count} ${list.count === 1 ? "post" : "posts"} waiting for review`}
			</p>
			{actionError && <ErrorBanner>{actionError}</ErrorBanner>}

			{list.items.map((post) => (
				<Card key={post.id} as="section" aria-label={`Reported post by ${authorLabel(post.author)}`} className="p-5">
					<PostSummary post={post}>
						<RemovedNote post={post} />
					</PostSummary>

					<div className="mt-4 border-t border-gray-100 pt-3">
						<p className="text-xs font-semibold uppercase tracking-wide text-muted">
							{post.flags.length} {post.flags.length === 1 ? "report" : "reports"}
						</p>
						<ul className="mt-2 space-y-1.5">
							{post.flags.map((flag) => (
								<li key={flag.id} className="text-sm">
									<span className="font-semibold text-ink">{flag.flagged_by_name}</span>
									<span className="text-muted"> · {formatDateTime(flag.created_at)}</span>
									<span className="block text-ink-soft">{flag.reason || <em className="text-muted">No reason given</em>}</span>
								</li>
							))}
						</ul>
					</div>

					<div className="mt-4 flex flex-wrap justify-end gap-2">
						<button
							type="button"
							disabled={busyId === post.id}
							onClick={() => act(post, () => moderateForumPost(post.id, "dismiss"), "Failed to dismiss reports")}
							className={SECONDARY}
						>
							Dismiss
						</button>
						{!post.is_deleted && (
							<button type="button" disabled={busyId === post.id} onClick={() => setHiding(post)} className={DANGER}>
								{post.is_head_post ? "Hide thread" : "Hide post"}
							</button>
						)}
						{post.author && !post.author.forum_banned && (
							<button
								type="button"
								disabled={busyId === post.id}
								onClick={() => setBanning(post)}
								className={`${BUTTON} bg-red-500 text-white hover:bg-red-600`}
							>
								Ban author…
							</button>
						)}
					</div>
				</Card>
			))}

			<LoadMore hasMore={list.hasMore} loading={list.loadingMore} error={list.loadMoreError} onLoadMore={list.loadMore} />

			{hiding && (
				<ConfirmDialog
					title={hiding.is_head_post ? "Hide this thread?" : "Hide this post?"}
					message={
						hiding.is_head_post
							? "The thread and all its replies will be taken off the forum. You can restore it from Removed posts."
							: "The post will be taken off the forum. You can restore it from Removed posts."
					}
					confirmLabel={hiding.is_head_post ? "Hide thread" : "Hide post"}
					danger
					onConfirm={() => {
						const post = hiding;
						setHiding(null);
						act(post, () => moderateForumPost(post.id, "hide"), "Failed to hide post");
					}}
					onCancel={() => setHiding(null)}
				/>
			)}

			{banning && (
				<BanDialog
					post={banning}
					onConfirm={async (days) => {
						await moderateForumPost(banning.id, "ban", days);
						// The author's other reported posts now show them as banned.
						await list.reload();
					}}
					onClose={() => setBanning(null)}
				/>
			)}
		</div>
	);
}

// ── Removed posts ──────────────────────────────────────────────────────────────

function RemovedPanel() {
	const list = usePagedList((page) => listRemovedPosts(page), [], { errorFallback: "Failed to load removed posts" });
	const [busyId, setBusyId] = useState<number | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	async function handleRestore(post: ModeratedPost) {
		setBusyId(post.id);
		setActionError(null);
		try {
			await restoreForumPost(post.id);
			list.removeItem(post.id);
		} catch (e) {
			setActionError(errorMessage(e, "Failed to restore post"));
		} finally {
			setBusyId(null);
		}
	}

	if (list.loading) return <LoadingState />;
	if (list.error) return <ErrorBanner>{list.error}</ErrorBanner>;

	return (
		<div className="space-y-4">
			<p className="text-sm text-muted">
				{list.count === 0
					? "No removed posts. Posts and threads deleted by their author or a moderator show up here."
					: "Posts and threads deleted by their author or a moderator, most recent first."}
			</p>
			{actionError && <ErrorBanner>{actionError}</ErrorBanner>}

			{list.items.map((post) => (
				<Card key={post.id} as="section" aria-label={`Removed post by ${authorLabel(post.author)}`} className="p-5">
					<PostSummary post={post}>
						<RemovedNote post={post} />
					</PostSummary>
					<div className="mt-4 flex justify-end">
						<button type="button" disabled={busyId === post.id} onClick={() => handleRestore(post)} className={SECONDARY}>
							{post.is_head_post ? "Restore thread" : "Restore post"}
						</button>
					</div>
				</Card>
			))}

			<LoadMore hasMore={list.hasMore} loading={list.loadingMore} error={list.loadMoreError} onLoadMore={list.loadMore} />
		</div>
	);
}

// ── Banned users ───────────────────────────────────────────────────────────────

function BannedPanel() {
	const list = usePagedList((page) => listUsers({ forum_banned: "true", ...page }), [], {
		errorFallback: "Failed to load banned users",
	});
	const [busyId, setBusyId] = useState<number | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [lifting, setLifting] = useState<AdminUser | null>(null);

	async function handleLift() {
		if (!lifting) return;
		const user = lifting;
		setLifting(null);
		setBusyId(user.id);
		setActionError(null);
		try {
			await liftForumBan(user.id);
			list.removeItem(user.id);
		} catch (e) {
			setActionError(errorMessage(e, "Failed to lift ban"));
		} finally {
			setBusyId(null);
		}
	}

	return (
		<>
			{actionError && <ErrorBanner className="mb-4">{actionError}</ErrorBanner>}
			<AdminTable
				className=""
				columns={["Name", "Email", "Banned", ""]}
				loading={list.loading}
				error={list.error}
				empty={list.items.length === 0}
				emptyMessage="Nobody is banned from the forum. Ban someone from a reported post."
			>
				{list.items.map((u) => (
					<tr key={u.id} className="border-b border-gray-100 last:border-0">
						<td className="px-5 py-3 font-semibold text-ink">
							<Link href={`/admin/users/${u.id}`} className="hover:underline">
								{u.full_name || "—"}
							</Link>
						</td>
						<td className="px-5 py-3 text-ink-soft">{u.email}</td>
						<td className="px-5 py-3 text-ink-soft">{banEnds(u.forum_banned_until)}</td>
						<td className="px-5 py-3">
							<div className="flex justify-end">
								<button type="button" disabled={busyId === u.id} onClick={() => setLifting(u)} className={SECONDARY}>
									Lift ban
								</button>
							</div>
						</td>
					</tr>
				))}
			</AdminTable>
			<LoadMore
				hasMore={list.hasMore}
				loading={list.loadingMore}
				error={list.loadMoreError}
				onLoadMore={list.loadMore}
				className="mt-4"
			/>

			{lifting && (
				<ConfirmDialog
					title="Lift this ban?"
					message={`${lifting.full_name || lifting.email} will be able to post in the forum again straight away.`}
					confirmLabel="Lift ban"
					onConfirm={handleLift}
					onCancel={() => setLifting(null)}
				/>
			)}
		</>
	);
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminModerationPage() {
	const [tab, setTab] = useState<Tab>("reported");

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle("Moderation")}</title>
			</Head>

			<AdminPageHeader title="Moderation" />

			<Tabs tabs={TABS} active={tab} onChange={setTab} label="Moderation sections" className="mt-6" />

			{/* Each panel mounts fresh when its tab opens, so it always shows the latest. */}
			<div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label} className="mt-6">
				{tab === "reported" && <ReportedPanel />}
				{tab === "removed" && <RemovedPanel />}
				{tab === "banned" && <BannedPanel />}
				{tab === "rules" && <ForumRulesEditor />}
			</div>
		</AdminLayout>
	);
}

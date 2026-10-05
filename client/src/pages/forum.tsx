import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import AppShell from "@/components/main/AppShell";
import Footer from "@/components/main/Footer";
import Card from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ChevronLeftIcon, MessageCircleIcon, SearchIcon } from "@/components/ui/icons";
import PageHeader from "@/components/ui/PageHeader";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAsync } from "@/hooks/useAsync";
import { useRequireAuth } from "@/hooks/useRequireAuth";
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
import { errorMessage } from "@/lib/errors";
import type { ForumPost, ForumThread, ForumThreadDetail } from "@/types/forum";
import type { AuthUser } from "@/types/user";

// ── Utilities ──────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

function isAdminUser(user: AuthUser | null) {
  return user?.role === "admin";
}

// Matches FORUM_POST_MAX_CHARS in app/serializers.py.
const POST_MAX_CHARS = 5000;

// Keep in step with the "forum_post" throttle rate in server/settings.py (6/min).
const POST_WINDOW_MS = 30_000;
const POST_LIMIT = 3;
const TIMEOUT_SECONDS = 30;
const POST_TIMESTAMPS_KEY = "forum:postTimestamps";

function getStoredTimestamps(): number[] {
  try {
    const raw = localStorage.getItem(POST_TIMESTAMPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((n) => typeof n === "number")
      : [];
  } catch {
    return [];
  }
}

function computeRemainingSeconds(timestamps: number[], now: number) {
  const recent = timestamps.filter((t) => now - t < POST_WINDOW_MS);
  if (recent.length < POST_LIMIT) return 0;
  const lockoutEnd = Math.max(...recent) + TIMEOUT_SECONDS * 1000;
  return Math.max(0, Math.ceil((lockoutEnd - now) / 1000));
}

function useForumPostCooldown(bypass: boolean) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (bypass) {
      return;
    }
    function tick() {
      setRemaining(computeRemainingSeconds(getStoredTimestamps(), Date.now()));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [bypass]);

  function markPosted() {
    if (bypass) return;
    const now = Date.now();
    const updated = [
      ...getStoredTimestamps().filter((t) => now - t < POST_WINDOW_MS),
      now,
    ];
    localStorage.setItem(POST_TIMESTAMPS_KEY, JSON.stringify(updated));
    setRemaining(computeRemainingSeconds(updated, now));
  }

  return { remaining: bypass ? 0 : remaining, markPosted };
}

// ── Small pieces ───────────────────────────────────────────────────────────────

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  return <UserAvatar avatarUrl={avatarUrl} fullName={name} size={36} className="shrink-0" />;
}

/** Author name with "2h ago" and "(edited)". */
function AuthorLine({ name, createdAt, editedAt }: { name: string; createdAt: string; editedAt?: string | null }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="min-w-0 truncate text-sm font-semibold text-ink">{name}</span>
      <span className="text-xs text-gray-400">
        {formatRelativeTime(createdAt)}
        {editedAt && " (edited)"}
      </span>
    </div>
  );
}

const ACTION_TONES = {
  pin: "text-amber-600",
  edit: "text-brand-blue",
  delete: "text-red-500",
} as const;

/** Small text button for Pin / Edit / Delete. */
function TextAction({
  tone,
  onClick,
  disabled,
  children,
}: {
  tone: keyof typeof ACTION_TONES;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-xs font-semibold hover:underline disabled:opacity-50 ${ACTION_TONES[tone]}`}
    >
      {children}
    </button>
  );
}

function PinnedLabel({ className }: { className: string }) {
  return <p className={`text-xs font-semibold uppercase tracking-wide text-amber-600 ${className}`}>Pinned</p>;
}

/** Textarea with Save / Cancel for editing a post in place. */
function InlineEditor({
  initial,
  rows = 3,
  onSave,
  onDone,
}: {
  initial: string;
  rows?: number;
  onSave: (body: string) => Promise<void>;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!draft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    // Inside a clickable thread row: typing or pressing a button here mustn't open the thread.
    <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={rows}
        maxLength={POST_MAX_CHARS}
        className="w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-semibold text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Composer ───────────────────────────────────────────────────────────────────

/** Form for starting a thread or replying, with the client-side posting cooldown. */
function Composer({
  heading,
  placeholder,
  submitLabel,
  onSubmit,
  user,
}: {
  heading: ReactNode;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  user: AuthUser | null;
}) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { remaining, markPosted } = useForumPostCooldown(isAdminUser(user));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || remaining > 0) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(body);
      markPosted();
      setBody("");
    } catch (err) {
      setError(errorMessage(err, "Failed to post"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card as="form" onSubmit={handleSubmit} className="p-5">
      {heading}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        maxLength={POST_MAX_CHARS}
        className="mt-3 w-full resize-none rounded-xl border border-gray-200 bg-surface-muted p-3 text-sm text-ink placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-blue"
      />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex items-center justify-between">
        {remaining > 0 ? (
          <p className="text-xs text-gray-400">You can post again in {remaining}s</p>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={submitting || !body.trim() || remaining > 0}
          className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {submitting ? "Posting…" : remaining > 0 ? `Wait ${remaining}s` : submitLabel}
        </button>
      </div>
    </Card>
  );
}

function ReadOnlyNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[10px] border border-gray-200 bg-white p-5 text-sm text-muted">{children}</p>
  );
}

// ── Post card (reply) ──────────────────────────────────────────────────────────

function PostCard({
  post,
  onEdit,
  onDelete,
}: {
  post: ForumPost;
  onEdit: (id: number, body: string) => Promise<void>;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Avatar name={post.author_name} avatarUrl={post.author_avatar_url} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <AuthorLine name={post.author_name} createdAt={post.created_at} editedAt={post.edited_at} />
            {post.can_edit && !editing && (
              <div className="flex shrink-0 items-center gap-3">
                <TextAction tone="edit" onClick={() => setEditing(true)}>Edit</TextAction>
                <TextAction tone="delete" onClick={() => onDelete(post.id)}>Delete</TextAction>
              </div>
            )}
          </div>

          {editing ? (
            <InlineEditor initial={post.body} onSave={(body) => onEdit(post.id, body)} onDone={() => setEditing(false)} />
          ) : (
            <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm text-gray-600">{post.body}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Thread detail ──────────────────────────────────────────────────────────────

type ThreadDetailViewProps = {
  thread: ForumThreadDetail;
  onBack: () => void;
  onReply: (body: string) => Promise<void>;
  onEditPost: (id: number, body: string) => Promise<void>;
  onDeletePost: (id: number) => void;
  onDeleteThread: () => void;
  onPinThread: (id: number, is_pinned: boolean) => Promise<void>;
  isActive: boolean;
  user: AuthUser | null;
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
  user,
}: ThreadDetailViewProps) {
  const [editingOpening, setEditingOpening] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const openingPost = thread.opening_post;

  async function handlePinToggle() {
    setPinError(null);
    try {
      await onPinThread(thread.id, !thread.is_pinned);
    } catch (error) {
      setPinError(errorMessage(error, "Failed to update pin"));
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-ink shadow-[0_6px_9px_rgba(0,0,0,0.05)] transition-colors hover:bg-surface-muted"
      >
        <ChevronLeftIcon className="size-4" />
        Back to forum
      </button>

      {/* Opening post */}
      <div
        className={`rounded-[10px] border bg-white p-6 shadow-[0_6px_9px_rgba(0,0,0,0.05)] ${thread.is_pinned ? "border-amber-200" : "border-gray-200"}`}
      >
        {thread.is_pinned && <PinnedLabel className="mb-3" />}

        <div className="flex items-start gap-3">
          <Avatar name={thread.author_name} avatarUrl={thread.author_avatar_url} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <AuthorLine
                name={thread.author_name}
                createdAt={thread.created_at}
                editedAt={thread.edited_at ?? openingPost?.edited_at ?? null}
              />
              {!editingOpening && (
                <div className="flex shrink-0 items-center gap-3">
                  {thread.can_pin && (
                    <TextAction tone="pin" onClick={handlePinToggle}>{thread.is_pinned ? "Unpin" : "Pin"}</TextAction>
                  )}
                  {openingPost?.can_edit && (
                    <TextAction tone="edit" onClick={() => setEditingOpening(true)}>Edit</TextAction>
                  )}
                  {thread.can_edit && <TextAction tone="delete" onClick={onDeleteThread}>Delete</TextAction>}
                </div>
              )}
            </div>

            {editingOpening && openingPost ? (
              <InlineEditor
                initial={openingPost.body}
                rows={4}
                onSave={(body) => onEditPost(openingPost.id, body)}
                onDone={() => setEditingOpening(false)}
              />
            ) : (
              <>
                <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm text-gray-600">{thread.body}</p>
                {pinError && <p className="mt-2 text-sm font-medium text-red-600">{pinError}</p>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Replies */}
      {thread.replies.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-white">
            {thread.replies.length} {thread.replies.length === 1 ? "Reply" : "Replies"}
          </p>
          {thread.replies.map((post) => (
            <PostCard key={post.id} post={post} onEdit={onEditPost} onDelete={onDeletePost} />
          ))}
        </div>
      )}

      {isActive ? (
        <Composer
          heading={<p className="text-sm font-bold text-ink">Reply</p>}
          placeholder="Write your reply…"
          submitLabel="Reply"
          onSubmit={onReply}
          user={user}
        />
      ) : (
        <ReadOnlyNotice>The forum is read-only — replies can&apos;t be posted right now.</ReadOnlyNotice>
      )}
    </div>
  );
}

// ── Thread row (feed) ────────────────────────────────────────────────────────
// Split out from FeedView because each row needs its own edit/save state, and
// hooks can't be called per-item inside a .map() on the parent.

type ThreadRowProps = {
  thread: ForumThread;
  isFirst: boolean;
  isLast: boolean;
  isOnly: boolean;
  isAdmin: boolean;
  onSelect: (id: number) => void;
  onEdit: (id: number, body: string) => Promise<void>;
  onDelete: (id: number) => void;
  onPin: (id: number, is_pinned: boolean) => Promise<void>;
};

function ThreadRow({ thread, isFirst, isLast, isOnly, isAdmin, onSelect, onEdit, onDelete, onPin }: ThreadRowProps) {
  const [editing, setEditing] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  async function handlePin() {
    setPinError(null);
    setPinning(true);
    try {
      await onPin(thread.id, !thread.is_pinned);
    } catch (err) {
      setPinError(errorMessage(err, "Failed to update pin"));
    } finally {
      setPinning(false);
    }
  }

  return (
    <div
      role={editing ? undefined : "button"}
      tabIndex={editing ? undefined : 0}
      onClick={editing ? undefined : () => onSelect(thread.id)}
      onKeyDown={
        editing
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(thread.id);
              }
            }
      }
      className={[
        "w-full p-5 text-left transition-colors",
        editing ? "" : "cursor-pointer hover:bg-surface-muted",
        isFirst ? "" : "border-t border-gray-200",
        isOnly ? "rounded-[10px]" : "",
        !isOnly && isFirst ? "rounded-t-[10px]" : "",
        !isOnly && isLast ? "rounded-b-[10px]" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {thread.is_pinned && <PinnedLabel className="mb-2" />}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Avatar name={thread.author_name} avatarUrl={thread.author_avatar_url} />
          <div className="min-w-0 flex-1">
            <AuthorLine name={thread.author_name} createdAt={thread.created_at} editedAt={thread.edited_at} />

            {editing ? (
              <InlineEditor initial={thread.body} onSave={(body) => onEdit(thread.id, body)} onDone={() => setEditing(false)} />
            ) : (
              <p className="mt-1 line-clamp-2 wrap-anywhere text-sm text-gray-600">{thread.body}</p>
            )}

            {pinError && <p className="mt-2 text-xs font-medium text-red-600">{pinError}</p>}

            <div className="mt-3 flex items-center gap-1 text-gray-400">
              <MessageCircleIcon className="size-3.5" />
              <span className="text-xs font-medium">
                {thread.reply_count} {thread.reply_count === 1 ? "reply" : "replies"}
              </span>
            </div>
          </div>
        </div>

        {isAdmin && !editing && (
          <div className="flex shrink-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <TextAction tone="pin" onClick={handlePin} disabled={pinning}>
              {thread.is_pinned ? "Unpin" : "Pin"}
            </TextAction>
            <TextAction tone="edit" onClick={() => setEditing(true)}>Edit</TextAction>
            <TextAction tone="delete" onClick={() => onDelete(thread.id)}>Delete</TextAction>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Feed view ──────────────────────────────────────────────────────────────────

type FeedViewProps = {
  threads: ForumThread[];
  onSelect: (id: number) => void;
  onCreateThread: (body: string) => Promise<void>;
  onEditThread: (id: number, body: string) => Promise<void>;
  onDeleteThread: (id: number) => void;
  onPinThread: (id: number, is_pinned: boolean) => Promise<void>;
  isActive: boolean;
  user: AuthUser | null;
};

function FeedView({
  threads,
  onSelect,
  onCreateThread,
  onEditThread,
  onDeleteThread,
  onPinThread,
  isActive,
  user,
}: FeedViewProps) {
  const isAdmin = isAdminUser(user);

  return (
    <div className="flex flex-col gap-4">
      {isActive ? (
        <Composer
          heading={
            <div className="flex items-center gap-3">
              <Avatar name={user?.full_name || "User"} avatarUrl={user?.avatar_url} />
              <p className="text-sm font-bold text-ink">What&apos;s on your mind?</p>
            </div>
          }
          placeholder="Share your thoughts, ask a question, or start a discussion..."
          submitLabel="Post"
          onSubmit={onCreateThread}
          user={user}
        />
      ) : (
        <ReadOnlyNotice>The forum is read-only — new threads can&apos;t be started right now.</ReadOnlyNotice>
      )}
      <Card>
        {threads.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">No threads yet. Be the first to start a conversation!</p>
        ) : (
          threads.map((thread, index) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              isFirst={index === 0}
              isLast={index === threads.length - 1}
              isOnly={threads.length === 1}
              isAdmin={isAdmin}
              onSelect={onSelect}
              onEdit={onEditThread}
              onDelete={onDeleteThread}
              onPin={onPinThread}
            />
          ))
        )}
      </Card>
    </div>
  );
}

// ── Right column ────────────────────────────────────────────────────────────

function ForumSidebar({ query, onQueryChange }: { query: string; onQueryChange: (v: string) => void }) {
  return (
    <div className="hidden min-w-0 space-y-4 xl:block">
      <Card className="p-5">
        <p className="text-sm font-bold text-ink">Search</p>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-surface-muted px-3 py-2">
          <SearchIcon className="size-4 shrink-0 text-gray-400" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search for keyword…"
            className="w-full bg-transparent text-sm text-ink placeholder:text-gray-400 focus:outline-none"
          />
        </div>
      </Card>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

type PendingDelete = { kind: "post" | "thread"; id: number };

const DELETE_PROMPTS = {
  post: { title: "Delete this reply?", confirmLabel: "Delete reply" },
  thread: { title: "Delete this thread and all its replies?", confirmLabel: "Delete thread" },
} as const;

export default function ForumPage() {
  const { user, isLoading: authLoading } = useRequireAuth();
  // Bumped by "Try again" to re-run the initial load.
  const [attempt, setAttempt] = useState(0);
  const forum = useAsync(
    async () => {
      const [threads, status] = await Promise.all([listForumThreads(), getProgramStatus()]);
      return { threads, isActive: status.is_active };
    },
    [user, attempt],
    { threads: [] as ForumThread[], isActive: true },
    { enabled: !authLoading && !!user, errorFallback: "Failed to load forum" },
  );
  const { threads, isActive } = forum.data;
  const [selectedThread, setSelectedThread] = useState<ForumThreadDetail | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [query, setQuery] = useState("");

  const loading = authLoading || (!!user && forum.loading);
  const error = actionError ?? forum.error;

  useEffect(() => {
    const handleForumReset = () => {
      setSelectedThread(null);
    };

    window.addEventListener("forum:reset", handleForumReset);
    return () => window.removeEventListener("forum:reset", handleForumReset);
  }, []);

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) =>
        t.body.toLowerCase().includes(q) ||
        t.author_name.toLowerCase().includes(q),
    );
  }, [threads, query]);

  function setThreads(update: (prev: ForumThread[]) => ForumThread[]) {
    forum.setData((d) => ({ ...d, threads: update(d.threads) }));
  }

  // Re-fetch rather than patching the list locally: the server sorts threads
  // (pinned ones first) and owns each thread's reply_count.
  async function refreshThreads() {
    const updated = await listForumThreads();
    setThreads(() => updated);
  }

  async function loadThread(id: number) {
    try {
      setSelectedThread(await getForumThread(id));
    } catch (e) {
      setActionError(errorMessage(e, "Failed to load thread"));
    }
  }

  async function handleCreateThread(body: string) {
    await createForumThread({ body });
    await refreshThreads();
  }

  async function handleReply(body: string) {
    if (!selectedThread) return;
    await createForumPost({ thread: selectedThread.id, body });
    await loadThread(selectedThread.id);
    await refreshThreads();
  }

  async function handleEditPost(id: number, body: string) {
    await updateForumPost(id, { body });
    if (selectedThread) await loadThread(selectedThread.id);
  }

  async function handlePinThread(id: number, is_pinned: boolean) {
    await pinForumThread(id, is_pinned);
    await refreshThreads();
    if (selectedThread && selectedThread.id === id) {
      setSelectedThread(await getForumThread(id));
    }
  }

  // Admin-only edit directly from the feed row, without opening the thread.
  // Editing a thread's body actually means editing its opening post, whose id
  // isn't part of the lightweight feed ForumThread — so this quietly fetches
  // the thread detail first just to get that id.
  async function handleEditThreadFromFeed(id: number, body: string) {
    const detail = await getForumThread(id);
    if (!detail.opening_post) return;
    await updateForumPost(detail.opening_post.id, { body });
    await refreshThreads();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { kind, id } = pendingDelete;
    setPendingDelete(null);
    try {
      if (kind === "post") {
        await deleteForumPost(id);
        if (selectedThread) await loadThread(selectedThread.id);
        // Deleting a reply changes the thread's reply_count in the feed.
        await refreshThreads();
      } else {
        await deleteForumThread(id);
        setThreads((prev) => prev.filter((t) => t.id !== id));
        if (selectedThread?.id === id) setSelectedThread(null);
      }
    } catch (e) {
      setActionError(errorMessage(e, "Failed to delete"));
    }
  }

  return (
    <>
      <Head>
        <title>Forum — Wellbeing Course</title>
      </Head>

      <AppShell
        rightRail={
          !selectedThread ? (
            <ForumSidebar query={query} onQueryChange={setQuery} />
          ) : undefined
        }
      >
        <section aria-label="Forum" className="flex min-w-0 flex-col gap-4">
          {loading ? (
            <div className="flex justify-center py-20">
              <span className="text-sm text-gray-400">Loading…</span>
            </div>
          ) : !user ? (
            <Card className="mx-auto max-w-md p-8 text-center">
              <p className="font-semibold text-ink">Please log in to access the forum.</p>
              <p className="mt-2 text-sm text-gray-400">Log in from the home page to continue.</p>
            </Card>
          ) : error ? (
            <div className="mx-auto max-w-md rounded-[10px] border border-red-200 bg-red-50 p-8 text-center">
              <p className="font-semibold text-red-700">Something went wrong</p>
              <p className="mt-2 text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => (actionError ? setActionError(null) : setAttempt((n) => n + 1))}
                className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white"
              >
                {actionError ? "Dismiss" : "Try again"}
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-6">
              <div className="min-w-0 flex-1">
                {!isActive && (
                  <div className="mb-4 rounded-[10px] border border-amber-200 bg-amber-50 p-4 text-center text-sm font-semibold text-amber-700">
                    The program has ended — the forum is now read-only.
                  </div>
                )}
                {!selectedThread && (
                  <div className="mb-4">
                    <PageHeader
                      title="Forum"
                      description="Connect, share, and support each other on your wellness journeys"
                    />
                  </div>
                )}

                {selectedThread ? (
                  <ThreadDetailView
                    key={selectedThread.id}
                    thread={selectedThread}
                    onBack={async () => {
                      setSelectedThread(null);
                      await refreshThreads();
                    }}
                    onReply={handleReply}
                    onEditPost={handleEditPost}
                    onDeletePost={(id) => setPendingDelete({ kind: "post", id })}
                    onDeleteThread={() => setPendingDelete({ kind: "thread", id: selectedThread.id })}
                    onPinThread={handlePinThread}
                    isActive={isActive}
                    user={user}
                  />
                ) : (
                  <FeedView
                    threads={filteredThreads}
                    onSelect={loadThread}
                    onCreateThread={handleCreateThread}
                    onEditThread={handleEditThreadFromFeed}
                    onDeleteThread={(id) => setPendingDelete({ kind: "thread", id })}
                    onPinThread={handlePinThread}
                    isActive={isActive}
                    user={user}
                  />
                )}
              </div>
            </div>
          )}
        </section>
      </AppShell>

      {pendingDelete && (
        <ConfirmDialog
          title={DELETE_PROMPTS[pendingDelete.kind].title}
          message="This can't be undone."
          confirmLabel={DELETE_PROMPTS[pendingDelete.kind].confirmLabel}
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      <Footer />
    </>
  );
}

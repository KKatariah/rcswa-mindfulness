import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import AppShell from "@/components/main/AppShell";
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

import { UserAvatar } from "@/components/ui/UserAvatar";

// ── Icons ──────────────────────────────────────────────────────────────────────
// Small local icons so we don't need to touch the shared icon set for one page.

function SearchIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}

function BackIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
    >
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MessageIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
    >
      <path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

function TimestampWithEdit({
  createdAt,
  editedAt,
  className = "text-xs text-[#9CA3AF]",
}: {
  createdAt: string;
  editedAt?: string | null;
  className?: string;
}) {
  return (
    <span className={className}>
      {formatRelativeTime(createdAt)}
      {editedAt && <span className={className}> (edited)</span>}
    </span>
  );
}

function Avatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string | null;
}) {
  return (
    <UserAvatar
      avatarUrl={avatarUrl}
      fullName={name === "Deleted user" ? "Deleted user" : name}
      size={36}
      className="shrink-0"
    />
  );
}

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

type ForumUser = {
  full_name?: string | null;
  avatar_url?: string | null;
  is_staff?: boolean;
  role?: string;
};

function isAdminUser(user: ForumUser | null) {
  return Boolean(user?.is_staff) || user?.role === "admin";
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

// ── Composer ───────────────────────────────────────────────────────────────────

function Composer({
  onSubmit,
  user,
}: {
  onSubmit: (body: string) => Promise<void>;
  user: ForumUser | null;
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
      setError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-[10px] border border-gray-200 bg-white p-5 shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
      <form onSubmit={handleSubmit}>
        <div className="flex items-center gap-3">
          <Avatar
            name={user?.full_name || "User"}
            avatarUrl={user?.avatar_url}
          />
          <p className="text-sm font-bold text-ink">
            What&apos;s on your mind?
          </p>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Share your thoughts, ask a question, or start a discussion..."
          rows={3}
          className="mt-3 w-full resize-none rounded-xl border border-gray-200 bg-surface-muted p-3 text-sm text-ink placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-brand-blue"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-3 flex items-center justify-between">
          {remaining > 0 ? (
            <p className="text-xs text-[#9CA3AF]">
              You can post again in {remaining}s
            </p>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={submitting || !body.trim() || remaining > 0}
            className="rounded-xl bg-[#0F172A] px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {submitting
              ? "Posting…"
              : remaining > 0
                ? `Wait ${remaining}s`
                : "Post"}
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
    <div className="rounded-[10px] border border-gray-200 bg-white p-4 shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
      <div className="flex items-start gap-3">
        <Avatar name={post.author_name} avatarUrl={post.author_avatar_url} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-ink">
                {post.author_name}
              </span>
              <TimestampWithEdit
                createdAt={post.created_at}
                editedAt={post.edited_at}
              />
            </div>
            {post.can_edit && !editing && (
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(post.body);
                    setEditing(true);
                  }}
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
                className="w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-lg bg-[#0F172A] px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-semibold text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[#4B5563]">
                {post.body}
              </p>
            </>
          )}
        </div>
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
  user: ForumUser | null;
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
  const [replyBody, setReplyBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingOpening, setEditingOpening] = useState(false);
  const [draftOpening, setDraftOpening] = useState(
    thread.opening_post?.body ?? thread.body,
  );
  const [savingOpening, setSavingOpening] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const { remaining, markPosted } = useForumPostCooldown(isAdminUser(user));

  async function handlePinToggle() {
    setPinError(null);
    try {
      await onPinThread(thread.id, !thread.is_pinned);
    } catch (error) {
      setPinError(
        error instanceof Error ? error.message : "Failed to update pin",
      );
    }
  }

  async function handleReply(e: FormEvent) {
    e.preventDefault();
    if (!replyBody.trim() || remaining > 0) return;
    setSubmitting(true);
    try {
      await onReply(replyBody);
      markPosted();
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
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-ink shadow-[0_6px_9px_rgba(0,0,0,0.05)] transition-colors hover:bg-surface-muted"
      >
        <BackIcon className="h-4 w-4" />
        Back to forum
      </button>

      {/* Opening post */}
      <div
        className={`rounded-[10px] border bg-white p-6 shadow-[0_6px_9px_rgba(0,0,0,0.05)] ${thread.is_pinned ? "border-amber-200" : "border-gray-200"}`}
      >
        {thread.is_pinned && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-600">
            Pinned
          </p>
        )}

        <div className="flex items-start gap-3">
          <Avatar
            name={thread.author_name}
            avatarUrl={thread.author_avatar_url}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-ink">
                  {thread.author_name}
                </span>
                <TimestampWithEdit
                  createdAt={thread.created_at}
                  editedAt={
                    thread.edited_at ?? thread.opening_post?.edited_at ?? null
                  }
                />
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {thread.can_pin && !editingOpening && (
                  <button
                    type="button"
                    onClick={handlePinToggle}
                    className="text-xs font-semibold text-amber-600 hover:underline"
                  >
                    {thread.is_pinned ? "Unpin" : "Pin"}
                  </button>
                )}
                {thread.opening_post?.can_edit && !editingOpening && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftOpening(thread.opening_post!.body);
                      setEditingOpening(true);
                    }}
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
                  className="w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSaveOpeningPost}
                    disabled={savingOpening}
                    className="rounded-lg bg-[#0F172A] px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {savingOpening ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingOpening(false)}
                    className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-semibold text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="mt-2 whitespace-pre-wrap text-sm text-[#4B5563]">
                  {thread.body}
                </p>
                {pinError && (
                  <p className="mt-2 text-sm font-medium text-red-600">
                    {pinError}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Replies */}
      {thread.replies.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-white">
            {thread.replies.length}{" "}
            {thread.replies.length === 1 ? "Reply" : "Replies"}
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
        <form
          onSubmit={handleReply}
          className="rounded-[10px] border border-gray-200 bg-white p-5 shadow-[0_6px_9px_rgba(0,0,0,0.05)]"
        >
          <p className="text-sm font-bold text-ink">Reply</p>
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write your reply…"
            rows={3}
            required
            className="mt-3 w-full resize-none rounded-xl border border-gray-200 bg-surface-muted p-3 text-sm text-ink placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-brand-blue"
          />
          <div className="mt-3 flex items-center justify-between">
            {remaining > 0 ? (
              <p className="text-xs text-[#9CA3AF]">
                You can post again in {remaining}s
              </p>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={submitting || !replyBody.trim() || remaining > 0}
              className="rounded-xl bg-[#0F172A] px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting
                ? "Posting…"
                : remaining > 0
                  ? `Wait ${remaining}s`
                  : "Reply"}
            </button>
          </div>
        </form>
      ) : (
        <p className="rounded-[10px] border border-gray-200 bg-white p-5 text-sm text-muted">
          The forum is read-only — replies can&apos;t be posted right now.
        </p>
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
};

function ThreadRow({
  thread,
  isFirst,
  isLast,
  isOnly,
  isAdmin,
  onSelect,
  onEdit,
  onDelete,
}: ThreadRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.body);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await onEdit(thread.id, draft);
      setEditing(false);
    } finally {
      setSaving(false);
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
      {thread.is_pinned && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
          Pinned
        </p>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Avatar
            name={thread.author_name}
            avatarUrl={thread.author_avatar_url}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-ink">
                {thread.author_name}
              </span>
              <TimestampWithEdit
                createdAt={thread.created_at}
                editedAt={thread.edited_at}
              />
            </div>

            {editing ? (
              <div
                className="mt-2 space-y-2"
                onClick={(e) => e.stopPropagation()}
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-lg bg-[#0F172A] px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(thread.body);
                      setEditing(false);
                    }}
                    className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-semibold text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1 line-clamp-2 text-sm text-[#4B5563]">
                {thread.body}
              </p>
            )}

            <div className="mt-3 flex items-center gap-1 text-[#9CA3AF]">
              <MessageIcon className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">
                {thread.reply_count}{" "}
                {thread.reply_count === 1 ? "reply" : "replies"}
              </span>
            </div>
          </div>
        </div>

        {isAdmin && !editing && (
          <div
            className="flex shrink-0 items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setDraft(thread.body);
                setEditing(true);
              }}
              className="text-xs font-semibold text-brand-blue hover:underline"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(thread.id)}
              className="text-xs font-semibold text-red-500 hover:underline"
            >
              Delete
            </button>
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
  isActive: boolean;
  user: ForumUser | null;
};

function FeedView({
  threads,
  onSelect,
  onCreateThread,
  onEditThread,
  onDeleteThread,
  isActive,
  user,
}: FeedViewProps) {
  const isAdmin = isAdminUser(user);

  return (
    <div className="flex flex-col gap-4">
      {isActive ? (
        <Composer onSubmit={onCreateThread} user={user} />
      ) : (
        <p className="rounded-[10px] border border-gray-200 bg-white p-5 text-sm text-muted">
          The forum is read-only — new threads can&apos;t be started right now.
        </p>
      )}
      <div className="rounded-[10px] border border-gray-200 bg-white shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
        {threads.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#9CA3AF]">
            No threads yet. Be the first to start a conversation!
          </p>
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
            />
          ))
        )}
      </div>
    </div>
  );
}
// ── Right column ────────────────────────────────────────────────────────────

function ForumSidebar({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (v: string) => void;
}) {
  return (
    <div className="hidden min-w-0 space-y-4 xl:block">
      <div className="rounded-[10px] border border-gray-200 bg-white p-5 shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
        <p className="text-sm font-bold text-ink">Search</p>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-surface-muted px-3 py-2">
          <SearchIcon className="h-4 w-4 shrink-0 text-[#9CA3AF]" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search for keyword…"
            className="w-full bg-transparent text-sm text-ink placeholder:text-[#9CA3AF] focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ForumPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [threads, setThreads] = useState<ForumThread[]>([]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);
  const [selectedThread, setSelectedThread] =
    useState<ForumThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handleForumReset = () => {
      setSelectedThread(null);
    };

    window.addEventListener("forum:reset", handleForumReset);
    return () => window.removeEventListener("forum:reset", handleForumReset);
  }, []);

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
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load forum");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) =>
        t.body.toLowerCase().includes(q) ||
        t.author_name.toLowerCase().includes(q),
    );
  }, [threads, query]);

  async function refreshThreads() {
    const token = localStorage.getItem("token") ?? "";
    const updated = await listForumThreads(token);
    setThreads(updated);
    return updated;
  }

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
    await createForumThread({ body }, token);
    // Re-fetch rather than prepending the new thread locally: the server
    // sorts threads (pinned ones first), and a naive prepend would push
    // the new thread above a pinned one until the next full reload.
    const updated = await listForumThreads(token);
    setThreads(updated);
  }

  async function handleReply(body: string) {
    if (!selectedThread) return;
    const token = localStorage.getItem("token") ?? "";
    await createForumPost({ thread: selectedThread.id, body }, token);
    await loadThread(selectedThread.id);
    // The thread detail view has its own copy of the thread, but the feed's
    // `threads` list (with each thread's reply_count) is separate state and
    // won't reflect the new reply until re-fetched.
    const updated = await listForumThreads(token);
    setThreads(updated);
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
    // Same reasoning as handleReply: deleting a reply changes reply_count,
    // which only lives in the separate `threads` feed state.
    const updated = await listForumThreads(token);
    setThreads(updated);
  }

  async function handlePinThread(id: number, is_pinned: boolean) {
    const token = localStorage.getItem("token") ?? "";
    await pinForumThread(id, is_pinned, token);
    const updated = await listForumThreads(token);
    setThreads(updated);
    if (selectedThread && selectedThread.id === id) {
      const refreshedThread = await getForumThread(id, token);
      setSelectedThread(refreshedThread);
    }
  }

  async function handleDeleteThread() {
    if (!selectedThread) return;
    if (!confirm("Delete this thread and all its replies?")) return;
    const token = localStorage.getItem("token") ?? "";
    await deleteForumThread(selectedThread.id, token);
    setThreads((prev) => prev.filter((t) => t.id !== selectedThread.id));
    setSelectedThread(null);
  }

  // Admin-only edit/delete directly from the feed row, without opening the
  // thread. Editing a thread's body actually means editing its opening
  // post, whose id isn't part of the lightweight feed ForumThread — so this
  // quietly fetches the thread detail first just to get that id.
  async function handleEditThreadFromFeed(id: number, body: string) {
    const token = localStorage.getItem("token") ?? "";
    const detail = await getForumThread(id, token);
    if (!detail.opening_post) return;
    await updateForumPost(detail.opening_post.id, { body }, token);
    const updated = await listForumThreads(token);
    setThreads(updated);
  }

  async function handleDeleteThreadFromFeed(id: number) {
    if (!confirm("Delete this thread and all its replies?")) return;
    const token = localStorage.getItem("token") ?? "";
    await deleteForumThread(id, token);
    setThreads((prev) => prev.filter((t) => t.id !== id));
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
        <main aria-label="Forum" className="flex min-w-0 flex-col gap-4">
          {authLoading || loading ? (
            <div className="flex justify-center py-20">
              <span className="text-sm text-[#9CA3AF]">Loading…</span>
            </div>
          ) : !user ? (
            <div className="mx-auto max-w-md rounded-[10px] border border-gray-200 bg-white p-8 text-center shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
              <p className="font-semibold text-ink">
                Please log in to access the forum.
              </p>
              <p className="mt-2 text-sm text-[#9CA3AF]">
                Log in from the home page to continue.
              </p>
            </div>
          ) : error ? (
            <div className="mx-auto max-w-md rounded-[10px] border border-red-200 bg-red-50 p-8 text-center">
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
            <div className="flex items-start gap-6">
              <div className="min-w-0 flex-1">
                {!isActive && (
                  <div className="mb-4 rounded-[10px] border border-amber-200 bg-amber-50 p-4 text-center text-sm font-semibold text-amber-700">
                    The program has ended — the forum is now read-only.
                  </div>
                )}
                {!selectedThread && (
                  <div className="mb-4 rounded-[10px] border border-gray-200 bg-white p-6 shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
                    <h1 className="text-2xl font-extrabold text-ink">Forum</h1>
                    <p className="mt-1 text-sm text-[#9CA3AF]">
                      Connect, share, and support each other on your wellness
                      journeys.
                    </p>
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
                    onDeletePost={handleDeletePost}
                    onDeleteThread={handleDeleteThread}
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
                    onDeleteThread={handleDeleteThreadFromFeed}
                    isActive={isActive}
                    user={user}
                  />
                )}
              </div>
            </div>
          )}
        </main>
      </AppShell>

      <Footer />
    </>
  );
}

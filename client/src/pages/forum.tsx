import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import ForumRulesModal, { ForumRulesSummary } from "@/components/forum/ForumRulesModal";
import AppShell from "@/components/main/AppShell";
import Footer from "@/components/main/Footer";
import UpcomingSession from "@/components/modules/UpcomingSession";
import NotificationsPanel from "@/components/notifications/NotificationsPanel";
import Card from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  ChevronLeftIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/ui/icons";
import PageHeader from "@/components/ui/PageHeader";
import { LoadMore } from "@/components/ui/paging";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAsync } from "@/hooks/useAsync";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagedList } from "@/hooks/usePagedList";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  acceptForumRules,
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

function formatFullDate(iso: string) {
  return new Date(iso).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

function isAdminUser(user: AuthUser | null) {
  return user?.role === "admin";
}

// Matches FORUM_POST_MAX_CHARS in app/serializers/forum.py.
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

function Avatar({ name, avatarUrl, size = 36 }: { name: string; avatarUrl?: string | null; size?: number }) {
  return <UserAvatar avatarUrl={avatarUrl} fullName={name} size={size} className="shrink-0" />;
}

const TAG_TONES = {
  author: "bg-brand-blue/10 text-brand-blue-dark",
  you: "bg-gray-100 text-gray-600",
} as const;

/** Small pill after an author's name, e.g. "Author" or "You". */
function AuthorTag({ tone, children }: { tone: keyof typeof TAG_TONES; children: ReactNode }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TAG_TONES[tone]}`}>{children}</span>
  );
}

/** Author name with any tags, "2h ago" (full date on hover) and "(edited)". */
function AuthorLine({
  name,
  createdAt,
  editedAt,
  tags,
}: {
  name: string;
  createdAt: string;
  editedAt?: string | null;
  tags?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 truncate text-sm font-semibold text-ink">{name}</span>
      {tags}
      <span className="text-xs text-muted">
        <time dateTime={createdAt} title={formatFullDate(createdAt)}>
          {formatRelativeTime(createdAt)}
        </time>
        {editedAt && " (edited)"}
      </span>
    </div>
  );
}

function PinnedLabel({ className }: { className: string }) {
  return <p className={`text-xs font-semibold uppercase tracking-wide text-amber-600 ${className}`}>Pinned</p>;
}

type MenuAction = { label: string; onSelect: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean };

const MENU_ITEMS = '[role="menuitem"]:not(:disabled)';

/** "⋯" button opening a small menu of actions (Pin / Edit / Delete) for a thread or reply. */
function PostMenu({ label, actions, className = "" }: { label: string; actions: MenuAction[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>(MENU_ITEMS)?.focus();
    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  if (actions.length === 0) return null;

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Inside a clickable thread row: Enter / Space here mustn't open the thread.
    e.stopPropagation();
    if (!open) return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`relative shrink-0 ${className}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
      >
        <MoreHorizontalIcon className="size-5" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-20 mt-1 min-w-40 rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-surface-muted focus:bg-surface-muted focus:outline-none disabled:opacity-50 ${action.danger ? "text-red-600" : "text-ink"}`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const editAction = (onSelect: () => void): MenuAction => ({
  label: "Edit",
  icon: <PencilIcon className="size-4" />,
  onSelect,
});

const deleteAction = (label: string, onSelect: () => void): MenuAction => ({
  label,
  icon: <TrashIcon className="size-4" />,
  danger: true,
  onSelect,
});

/** Grows a textarea to fit its text as it changes. */
function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}

const isSubmitShortcut = (e: KeyboardEvent) => e.key === "Enter" && (e.metaKey || e.ctrlKey);

/** Textarea with Save / Cancel for editing a post in place. */
function InlineEditor({
  initial,
  onSave,
  onDone,
}: {
  initial: string;
  onSave: (body: string) => Promise<void>;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useAutosize(draft);

  async function handleSave() {
    if (!draft.trim() || saving) return;
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
    <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitShortcut(e)) {
            e.preventDefault();
            handleSave();
          } else if (e.key === "Escape") {
            onDone();
          }
        }}
        aria-label="Edit post"
        aria-keyshortcuts="Control+Enter Meta+Enter"
        autoFocus
        rows={3}
        maxLength={POST_MAX_CHARS}
        className="max-h-96 w-full resize-none rounded-xl border border-gray-200 bg-white p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
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
          className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-xs font-semibold text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Composer ───────────────────────────────────────────────────────────────────

// Show a character count once a post is this close to the limit.
const COUNTER_FROM = Math.floor(POST_MAX_CHARS * 0.8);

/** Form for starting a thread or replying, with the client-side posting cooldown. */
function Composer({
  heading,
  label,
  placeholder,
  submitLabel,
  onSubmit,
  user,
  bare = false,
}: {
  heading: ReactNode;
  label: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  user: AuthUser | null;
  /** Leave off the card, for a composer that sits inside another card. */
  bare?: boolean;
}) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { remaining, markPosted } = useForumPostCooldown(isAdminUser(user));
  const textareaRef = useAutosize(body);

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!body.trim() || remaining > 0 || submitting) return;
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

  const fields = (
    <>
      {heading}
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitShortcut(e)) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        aria-label={label}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        placeholder={placeholder}
        rows={3}
        maxLength={POST_MAX_CHARS}
        className={`mt-3 max-h-96 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-ink placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-blue ${bare ? "bg-white" : "bg-surface-muted"}`}
      />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted" aria-live="polite">
          {remaining > 0
            ? `You can post again in ${remaining}s`
            : body.length >= COUNTER_FROM
              ? `${body.length} / ${POST_MAX_CHARS} characters`
              : ""}
        </p>
        <button
          type="submit"
          disabled={submitting || !body.trim() || remaining > 0}
          className="shrink-0 rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {submitting ? "Posting…" : remaining > 0 ? `Wait ${remaining}s` : submitLabel}
        </button>
      </div>
    </>
  );

  return bare ? (
    <form onSubmit={handleSubmit} className="p-5">
      {fields}
    </form>
  ) : (
    <Card as="form" onSubmit={handleSubmit} className="p-5">
      {fields}
    </Card>
  );
}

function ReadOnlyNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[10px] border border-gray-200 bg-white p-5 text-sm text-muted">{children}</p>
  );
}

// ── Reply ──────────────────────────────────────────────────────────────────────

function ReplyItem({
  post,
  highlighted,
  onEdit,
  onDelete,
}: {
  post: ForumPost;
  highlighted: boolean;
  onEdit: (id: number, body: string) => Promise<void>;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLLIElement>(null);

  // A reply you just posted scrolls into view and is briefly tinted.
  useEffect(() => {
    if (!highlighted) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [highlighted]);

  return (
    <li
      ref={ref}
      className={`flex gap-3 px-6 py-4 transition-[background-color] duration-1000 ${highlighted ? "bg-brand-blue/10" : ""}`}
    >
      <Avatar name={post.author_name} avatarUrl={post.author_avatar_url} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <AuthorLine
            name={post.author_name}
            createdAt={post.created_at}
            editedAt={post.edited_at}
            tags={
              <>
                {post.is_thread_author && <AuthorTag tone="author">Author</AuthorTag>}
                {post.is_own && <AuthorTag tone="you">You</AuthorTag>}
              </>
            }
          />
          {post.can_edit && !editing && (
            <PostMenu
              className="-my-1.5 -mr-2"
              label={`Actions for reply by ${post.author_name}`}
              actions={[editAction(() => setEditing(true)), deleteAction("Delete reply", () => onDelete(post.id))]}
            />
          )}
        </div>

        {editing ? (
          <InlineEditor initial={post.body} onSave={(body) => onEdit(post.id, body)} onDone={() => setEditing(false)} />
        ) : (
          <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-ink-soft">{post.body}</p>
        )}
      </div>
    </li>
  );
}

// ── Thread detail ──────────────────────────────────────────────────────────────

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-ink shadow-[0_6px_9px_rgba(0,0,0,0.05)] transition-colors hover:bg-surface-muted"
    >
      <ChevronLeftIcon className="size-4" />
      Back to forum
    </button>
  );
}

/** Placeholder while a thread loads. */
function ThreadSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <BackButton onClick={onBack} />
      <Card className="p-6">
        <p role="status" className="sr-only">Loading thread…</p>
        <div aria-hidden="true" className="flex gap-3 motion-safe:animate-pulse">
          <div className="size-11 shrink-0 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-3 pt-1">
            <div className="h-3 w-32 rounded bg-gray-200" />
            <div className="h-3 w-full rounded bg-gray-100" />
            <div className="h-3 w-4/5 rounded bg-gray-100" />
          </div>
        </div>
      </Card>
    </div>
  );
}

type ThreadDetailViewProps = {
  thread: ForumThreadDetail;
  highlightPostId: number | null;
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
  highlightPostId,
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const repliesHeadingId = useId();
  const openingPost = thread.opening_post;
  const replyCount = thread.replies.length;

  // Opening a thread swaps the whole view, so move focus to it for screen readers.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  async function handlePinToggle() {
    setPinError(null);
    try {
      await onPinThread(thread.id, !thread.is_pinned);
    } catch (error) {
      setPinError(errorMessage(error, "Failed to update pin"));
    }
  }

  const threadActions: MenuAction[] = [];
  if (thread.can_pin) {
    threadActions.push({ label: thread.is_pinned ? "Unpin thread" : "Pin thread", onSelect: handlePinToggle });
  }
  if (openingPost?.can_edit) threadActions.push(editAction(() => setEditingOpening(true)));
  if (thread.can_edit) threadActions.push(deleteAction("Delete thread", onDeleteThread));

  return (
    <div className="space-y-4">
      <BackButton onClick={onBack} />

      <Card as="section" aria-labelledby={headingId}>
        <h1 ref={headingRef} id={headingId} tabIndex={-1} className="sr-only">
          {thread.title || "Forum thread"}
        </h1>

        {/* Opening post */}
        <div className="p-6">
          {thread.is_pinned && <PinnedLabel className="mb-3" />}

          <div className="flex items-start gap-3">
            <Avatar name={thread.author_name} avatarUrl={thread.author_avatar_url} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <AuthorLine
                  name={thread.author_name}
                  createdAt={thread.created_at}
                  editedAt={thread.edited_at ?? openingPost?.edited_at ?? null}
                  tags={thread.is_own && <AuthorTag tone="you">You</AuthorTag>}
                />
                {!editingOpening && (
                  <PostMenu className="-my-1.5 -mr-2" label="Thread actions" actions={threadActions} />
                )}
              </div>

              {editingOpening && openingPost ? (
                <InlineEditor
                  initial={openingPost.body}
                  onSave={(body) => onEditPost(openingPost.id, body)}
                  onDone={() => setEditingOpening(false)}
                />
              ) : (
                <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-[15px] leading-relaxed text-ink">{thread.body}</p>
              )}
              {pinError && <p className="mt-2 text-sm font-medium text-red-600">{pinError}</p>}
            </div>
          </div>
        </div>

        {/* Replies */}
        <section aria-labelledby={repliesHeadingId} className="border-t border-gray-200">
          <h2 id={repliesHeadingId} className="px-6 pt-5 text-xs font-semibold uppercase tracking-wide text-muted">
            {replyCount} {replyCount === 1 ? "Reply" : "Replies"}
          </h2>
          {replyCount === 0 ? (
            <p className="px-6 pb-6 pt-2 text-sm text-muted">
              No replies yet{isActive ? " — start the conversation below." : "."}
            </p>
          ) : (
            <ol className="divide-y divide-gray-100 pb-2 pt-1">
              {thread.replies.map((post) => (
                <ReplyItem
                  key={post.id}
                  post={post}
                  highlighted={post.id === highlightPostId}
                  onEdit={onEditPost}
                  onDelete={onDeletePost}
                />
              ))}
            </ol>
          )}
        </section>

        {isActive ? (
          <div className="rounded-b-[10px] border-t border-gray-200 bg-surface-muted">
            <Composer
              bare
              heading={<p className="text-sm font-bold text-ink">Add a reply</p>}
              label="Write a reply"
              placeholder="Write your reply…"
              submitLabel="Reply"
              onSubmit={onReply}
              user={user}
            />
          </div>
        ) : (
          <p className="rounded-b-[10px] border-t border-gray-200 bg-surface-muted px-6 py-4 text-sm text-muted">
            The forum is read-only — replies can&apos;t be posted right now.
          </p>
        )}
      </Card>
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
            <AuthorLine
              name={thread.author_name}
              createdAt={thread.created_at}
              editedAt={thread.edited_at}
              tags={thread.is_own && <AuthorTag tone="you">You</AuthorTag>}
            />

            {editing ? (
              <InlineEditor initial={thread.body} onSave={(body) => onEdit(thread.id, body)} onDone={() => setEditing(false)} />
            ) : (
              <p className="mt-1 line-clamp-2 wrap-anywhere text-sm text-gray-600">{thread.body}</p>
            )}

            {pinError && <p className="mt-2 text-xs font-medium text-red-600">{pinError}</p>}

            <div className="mt-3 flex items-center gap-1 text-muted">
              <MessageCircleIcon className="size-3.5" />
              <span className="text-xs font-medium">
                {thread.reply_count} {thread.reply_count === 1 ? "reply" : "replies"}
              </span>
            </div>
          </div>
        </div>

        {isAdmin && !editing && (
          <PostMenu
            className="-my-1.5 -mr-2"
            label={`Actions for thread by ${thread.author_name}`}
            actions={[
              { label: thread.is_pinned ? "Unpin thread" : "Pin thread", onSelect: handlePin, disabled: pinning },
              editAction(() => setEditing(true)),
              deleteAction("Delete thread", () => onDelete(thread.id)),
            ]}
          />
        )}
      </div>
    </div>
  );
}

// ── Feed view ──────────────────────────────────────────────────────────────────

type FeedViewProps = {
  threads: ForumThread[];
  searching: boolean;
  more: ReactNode;
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
  searching,
  more,
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
          label="Start a new thread"
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
          <p className="py-12 text-center text-sm text-muted">
            {searching ? "No threads match your search." : "No threads yet. Be the first to start a conversation!"}
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
              onPin={onPinThread}
            />
          ))
        )}
      </Card>
      {more}
    </div>
  );
}

// ── Right column ────────────────────────────────────────────────────────────

type SearchProps = { query: string; onQueryChange: (v: string) => void };

function ForumSearchField({ query, onQueryChange, className = "" }: SearchProps & { className?: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl border border-gray-200 bg-surface-muted px-3 py-2 focus-within:ring-2 focus-within:ring-brand-blue ${className}`}>
      <SearchIcon className="size-4 shrink-0 text-gray-400" />
      <input
        type="search"
        aria-label="Search forum threads"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search for keyword…"
        className="w-full bg-transparent text-sm text-ink placeholder:text-gray-400 focus:outline-none"
      />
    </div>
  );
}

function ForumSidebar({ query, onQueryChange }: SearchProps) {
  return (
    <div className="hidden min-w-0 space-y-4 xl:block">
      <UpcomingSession />
      <Card className="p-5">
        <p className="text-sm font-bold text-ink">Search</p>
        <ForumSearchField query={query} onQueryChange={onQueryChange} className="mt-3" />
      </Card>
      <Card className="p-5">
        <p className="mb-3 text-sm font-bold text-ink">Forum rules</p>
        <ForumRulesSummary />
      </Card>
      <NotificationsPanel />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function parseThreadId(value: string | string[] | undefined) {
  return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
}

type PendingDelete = { kind: "post" | "thread"; id: number };

const DELETE_PROMPTS = {
  post: { title: "Delete this reply?", confirmLabel: "Delete reply" },
  thread: { title: "Delete this thread and all its replies?", confirmLabel: "Delete thread" },
} as const;

export default function ForumPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, updateUser } = useRequireAuth();
  // Students must agree to the rules once (saved server-side) before the
  // forum loads; the API rejects forum requests until they have.
  const needsRules = !!user && !isAdminUser(user) && !user.forum_rules_accepted;
  // Bumped by "Try again" to re-run the initial load.
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim());
  const canLoad = !authLoading && !!user && !needsRules;
  // Threads come a page at a time, and the search runs on the server so it covers every thread.
  const threadList = usePagedList((page) => listForumThreads({ search, ...page }), [user, attempt, needsRules, search], {
    enabled: canLoad,
    errorFallback: "Failed to load forum",
  });
  const programStatus = useAsync(getProgramStatus, [user, attempt, needsRules], { is_active: true }, {
    enabled: canLoad,
    errorFallback: "Failed to load forum",
  });
  const threads = threadList.items;
  const isActive = programStatus.data.is_active;
  // The open thread lives in the URL (/forum?thread=12), so back, refresh and links work.
  const threadId = parseThreadId(router.query.thread);
  const threadDetail = useAsync<ForumThreadDetail | null>(
    () => getForumThread(threadId!),
    [user, attempt, needsRules, threadId],
    null,
    { enabled: canLoad && threadId !== null, errorFallback: "Failed to load thread" },
  );
  // Until the new thread arrives, the last one opened may still be in threadDetail.data.
  const selectedThread = threadDetail.data && threadDetail.data.id === threadId ? threadDetail.data : null;
  const [highlightPostId, setHighlightPostId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  // A new search keeps the current list on screen until its results arrive.
  const firstLoad = threadList.loading && threads.length === 0 && !search;
  const loading = authLoading || (!!user && !needsRules && (programStatus.loading || firstLoad));
  const threadError = threadId !== null ? threadDetail.error : null;
  const error = actionError ?? threadError ?? threadList.error ?? programStatus.error;

  // The tint on a reply you just posted fades after a moment.
  useEffect(() => {
    if (highlightPostId === null) return;
    const id = setTimeout(() => setHighlightPostId(null), 2500);
    return () => clearTimeout(id);
  }, [highlightPostId]);

  function openThread(id: number) {
    router.push({ pathname: "/forum", query: { thread: id } }, undefined, { shallow: true });
  }

  function closeThread() {
    router.push("/forum", undefined, { shallow: true });
  }

  // Re-fetch rather than patching the list locally: the server sorts threads
  // (pinned ones first) and owns each thread's reply_count.
  async function refreshThreads() {
    await threadList.reload();
  }

  async function handleAcceptRules() {
    const { user: updated } = await acceptForumRules();
    updateUser({ forum_rules_accepted: updated.forum_rules_accepted });
  }

  async function reloadThread() {
    if (threadId === null) return;
    try {
      threadDetail.setData(await getForumThread(threadId));
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
    const post = await createForumPost({ thread: selectedThread.id, body });
    await reloadThread();
    setHighlightPostId(post.id);
    await refreshThreads();
  }

  async function handleEditPost(id: number, body: string) {
    await updateForumPost(id, { body });
    await reloadThread();
  }

  async function handlePinThread(id: number, is_pinned: boolean) {
    await pinForumThread(id, is_pinned);
    await refreshThreads();
    if (threadId === id) await reloadThread();
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
        await reloadThread();
        // Deleting a reply changes the thread's reply_count in the feed.
        await refreshThreads();
      } else {
        await deleteForumThread(id);
        threadList.removeItem(id);
        if (threadId === id) router.replace("/forum", undefined, { shallow: true });
      }
    } catch (e) {
      setActionError(errorMessage(e, "Failed to delete"));
    }
  }

  return (
    <>
      <Head>
        <title>Forum — RCSWA Wellbeing</title>
      </Head>

      <AppShell
        rightRail={
          <ForumSidebar
            query={query}
            onQueryChange={(value) => {
              setQuery(value);
              // Search filters the thread list, so leave an open thread to show results.
              if (threadId !== null) closeThread();
            }}
          />
        }
      >
        <section aria-label="Forum" className="flex min-w-0 flex-col gap-4">
          {loading ? (
            <div className="flex justify-center py-20">
              <span className="text-sm text-muted">Loading…</span>
            </div>
          ) : !user ? (
            <Card className="mx-auto max-w-md p-8 text-center">
              <p className="font-semibold text-ink">Please log in to access the forum.</p>
              <p className="mt-2 text-sm text-muted">Log in from the home page to continue.</p>
            </Card>
          ) : needsRules ? (
            <Card className="mx-auto max-w-md p-8 text-center">
              <p className="font-semibold text-ink">Please agree to the forum rules to continue.</p>
              <ForumRulesModal isOpen onAccept={handleAcceptRules} onClose={() => router.push("/modules")} />
            </Card>
          ) : error ? (
            <div className="mx-auto max-w-md rounded-[10px] border border-red-200 bg-red-50 p-8 text-center">
              <p className="font-semibold text-red-700">Something went wrong</p>
              <p className="mt-2 text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={() =>
                  actionError ? setActionError(null) : threadError ? closeThread() : setAttempt((n) => n + 1)
                }
                className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white"
              >
                {actionError ? "Dismiss" : threadError ? "Back to forum" : "Try again"}
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
                {threadId === null && (
                  <div className="mb-4">
                    <PageHeader
                      title="Forum"
                      description="Connect, share, and support each other on your wellness journeys"
                    />
                    {/* The sidebar (with its search box) only shows on wide screens. */}
                    <ForumSearchField query={query} onQueryChange={setQuery} className="mt-4 xl:hidden" />
                  </div>
                )}

                {threadId !== null && !selectedThread ? (
                  <ThreadSkeleton onBack={closeThread} />
                ) : selectedThread ? (
                  <ThreadDetailView
                    key={selectedThread.id}
                    thread={selectedThread}
                    highlightPostId={highlightPostId}
                    onBack={async () => {
                      closeThread();
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
                    threads={threads}
                    searching={!!search}
                    more={
                      <LoadMore
                        hasMore={threadList.hasMore}
                        loading={threadList.loadingMore}
                        error={threadList.loadMoreError}
                        onLoadMore={threadList.loadMore}
                      />
                    }
                    onSelect={openThread}
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

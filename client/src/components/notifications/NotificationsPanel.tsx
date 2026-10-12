import Link from "next/link";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/router";
import {
  BellIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardIcon,
  HeadphonesIcon,
  XIcon,
} from "@/components/ui/icons";
import {
  getNotificationHistory,
  getToken,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationType,
  type ReceivedNotification,
} from "@/lib/api";

const TYPE_STYLES: Record<
  NotificationType,
  { icon: typeof BellIcon; iconBg: string }
> = {
  content_reminder: { icon: HeadphonesIcon, iconBg: "bg-purple-500" },
  survey_prompt: { icon: ClipboardIcon, iconBg: "bg-green-600" },
  content_update: { icon: BookOpenIcon, iconBg: "bg-brand-blue" },
  module_added: { icon: BookOpenIcon, iconBg: "bg-brand-blue" },
};

const PERTH_TZ = "Australia/Perth";

function dayKey(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: PERTH_TZ });
}

function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (dayKey(date) === dayKey(today)) return "Today";
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-AU", {
    timeZone: PERTH_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function timeLabel(date: Date) {
  return date.toLocaleTimeString("en-AU", {
    timeZone: PERTH_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupByDay(notifications: ReceivedNotification[]) {
  const groups: { label: string; items: ReceivedNotification[] }[] = [];
  let lastKey: string | null = null;
  for (const n of notifications) {
    const date = new Date(n.sent_at);
    const key = dayKey(date);
    if (key !== lastKey) {
      groups.push({ label: dayLabel(date), items: [] });
      lastKey = key;
    }
    groups[groups.length - 1].items.push(n);
  }
  return groups;
}

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: ReceivedNotification;
  onMarkRead: (id: number) => void;
}) {
  const { icon: Icon, iconBg } = TYPE_STYLES[notification.type] ?? {
    icon: BellIcon,
    iconBg: "bg-gray-500",
  };
  const unread = notification.read_at === null;

  const content = (
    <>
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-white ${iconBg}`}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`wrap-anywhere text-sm leading-5 ${unread ? "font-bold text-ink" : "font-medium text-ink-soft"}`}>
          {unread && <span className="sr-only">Unread: </span>}
          {notification.title}
        </p>
        {notification.body && (
          <p className="wrap-anywhere text-xs leading-5 text-muted">{notification.body}</p>
        )}
        <time dateTime={notification.sent_at} className="text-xs leading-5 text-muted">
          {timeLabel(new Date(notification.sent_at))}
        </time>
      </div>
    </>
  );

  // pr-8 leaves room for the unread dot in the top-right corner.
  const bodyClass = "flex items-start gap-3 rounded-lg px-2 py-2.5 pr-8";

  return (
    <div
      className={`relative rounded-lg transition-colors hover:bg-surface-muted ${unread ? "bg-brand-blue/5" : ""}`}
    >
      {notification.url ? (
        <Link
          href={notification.url}
          onClick={() => unread && onMarkRead(notification.id)}
          className={`${bodyClass} focus-visible:outline-2 focus-visible:outline-brand-blue-dark`}
        >
          {content}
        </Link>
      ) : (
        <div className={bodyClass}>{content}</div>
      )}
      {unread && (
        <>
          <span className="absolute right-3 top-4 size-2.5 rounded-full bg-brand-blue" aria-hidden="true" />
          {/* ml-[52px] lines the button up with the text: px-2 + icon + gap-3. */}
          <button
            type="button"
            onClick={() => onMarkRead(notification.id)}
            aria-label={`Mark as read: ${notification.title}`}
            className="mb-2 ml-[52px] flex items-center gap-1 rounded-md px-1.5 py-0.5 -translate-x-1.5 text-xs font-semibold text-brand-blue-dark hover:bg-brand-blue/10 focus-visible:outline-2 focus-visible:outline-brand-blue-dark"
          >
            <CheckIcon className="size-3.5" aria-hidden="true" />
            Mark as read
          </button>
        </>
      )}
    </div>
  );
}

type NotificationsState = {
  notifications: ReceivedNotification[] | null;
  error: string | null;
  unreadCount: number;
  markRead: (id: number) => void;
  markAllRead: () => void;
};

function useNotificationsState(enabled: boolean): NotificationsState {
  const [notifications, setNotifications] = useState<ReceivedNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Loaded up front so the unread count shows while the list is closed.
  useEffect(() => {
    if (!enabled || !getToken()) return;
    let cancelled = false;
    getNotificationHistory()
      .then((data) => { if (!cancelled) setNotifications(data); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [enabled]);

  const unreadCount = notifications?.filter((n) => n.read_at === null).length ?? 0;

  // Optimistic: flip the rows now, put them back if the server refuses.
  function setReadAt(ids: Set<number>, readAt: string | null) {
    setNotifications((prev) =>
      prev?.map((n) => (ids.has(n.id) ? { ...n, read_at: readAt } : n)) ?? prev,
    );
  }

  function markRead(id: number) {
    const ids = new Set([id]);
    setReadAt(ids, new Date().toISOString());
    markNotificationRead(id).catch((err: Error) => {
      setReadAt(ids, null);
      setError(err.message);
    });
  }

  function markAllRead() {
    if (!notifications) return;
    const ids = new Set(notifications.filter((n) => n.read_at === null).map((n) => n.id));
    setReadAt(ids, new Date().toISOString());
    markAllNotificationsRead().catch((err: Error) => {
      setReadAt(ids, null);
      setError(err.message);
    });
  }

  return { notifications, error, unreadCount, markRead, markAllRead };
}

const NotificationsContext = createContext<NotificationsState | null>(null);

/** One copy of the user's notifications for a page, shared by the rail card and the header bell,
 *  so reading one in either place updates both. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const state = useNotificationsState(true);
  return <NotificationsContext.Provider value={state}>{children}</NotificationsContext.Provider>;
}

/** The shared state when inside a provider; otherwise this component loads its own. */
function useNotifications(): NotificationsState {
  const shared = useContext(NotificationsContext);
  const own = useNotificationsState(shared === null);
  return shared ?? own;
}

/** The list itself: empty state, "Mark all as read", and the scrolling day groups. */
function NotificationList({ state, listClassName }: { state: NotificationsState; listClassName: string }) {
  const { notifications, error, unreadCount, markRead, markAllRead } = state;
  return (
    <>
      {error && (
        <p role="alert" className="px-2 py-2 text-sm text-red-600">{error}</p>
      )}
      {notifications === null ? (
        !error && <p className="px-2 py-2 text-sm text-muted">Loading…</p>
      ) : notifications.length === 0 ? (
        <div className="px-2 py-3 text-sm">
          <p className="font-semibold text-ink">No notifications yet</p>
          <p className="mt-1 text-muted">
            Meditation reminders, new weeks and survey prompts will appear here.
          </p>
          <Link href="/profile" className="mt-2 inline-block font-semibold text-brand-blue-dark hover:underline">
            Notification settings
          </Link>
        </div>
      ) : (
        <>
          <div className="flex justify-end px-2 pb-1">
            <button
              type="button"
              onClick={markAllRead}
              disabled={unreadCount === 0}
              className="text-xs font-semibold text-brand-blue-dark hover:underline disabled:cursor-default disabled:text-muted disabled:no-underline"
            >
              Mark all as read
            </button>
          </div>
          <div
            tabIndex={0}
            aria-label="Notification list"
            role="region"
            className={`space-y-3 overflow-y-auto overscroll-contain rounded-lg focus-visible:outline-2 focus-visible:outline-brand-blue-dark ${listClassName}`}
          >
            {groupByDay(notifications).map((group) => (
              <div key={group.label}>
                <h3 className="px-2 pt-1 text-2xs font-extrabold uppercase tracking-wide text-muted">{group.label}</h3>
                <ul className="mt-1 space-y-1">
                  {group.items.map((n) => (
                    <li key={n.id}>
                      <NotificationRow notification={n} onMarkRead={markRead} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** `className` replaces the default size and position (the bell uses a smaller badge in its corner). */
function UnreadBadge({ count, className = "px-2 py-0.5 text-xs" }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span className={`rounded-full bg-brand-blue font-bold text-white ${className}`}>
      {count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

/** Collapsible list of notifications the user has received, for a page's right rail. */
export default function NotificationsPanel() {
  const listId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const state = useNotifications();

  return (
    <section className="w-full min-w-0 rounded-xl border border-gray-200 bg-white text-ink shadow-card">
      <h2>
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls={listId}
          className="flex w-full items-center gap-2.5 rounded-xl p-5 text-left cursor-pointer hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-brand-blue-dark"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-blue text-white">
            <BellIcon className="size-5" aria-hidden="true" />
          </span>
          <span className="flex-1 text-base font-extrabold leading-6">Notifications</span>
          <UnreadBadge count={state.unreadCount} />
          <ChevronDownIcon
            className={`size-5 shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </h2>

      {/* Rendered only while open, like the bell's panel, so the page holds one copy of the list. */}
      {isOpen && (
        <div id={listId} className="border-t border-gray-100 px-3 pb-3 pt-2">
          <NotificationList state={state} listClassName="max-h-[min(360px,50dvh)]" />
        </div>
      )}
    </section>
  );
}

/**
 * Bell for the top bar on screens without the right rail (phones and tablets): shows the unread
 * count and opens the same list in a panel under the header, instead of a card below the page.
 */
export function NotificationsBell() {
  const listId = useId();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const state = useNotifications();

  // Close on a tap outside, Escape, or moving to another page.
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    router.events?.on("routeChangeStart", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      router.events?.off("routeChangeStart", close);
    };
  }, [isOpen, router.events]);

  return (
    <div ref={rootRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={listId}
        className="relative flex size-10 items-center justify-center rounded-lg text-white cursor-pointer hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
      >
        <span className="sr-only">Notifications</span>
        <BellIcon className="size-6" aria-hidden="true" />
        <UnreadBadge count={state.unreadCount} className="absolute -right-0.5 -top-0.5 min-w-[18px] px-1 py-0 text-center text-2xs leading-[18px]" />
      </button>

      {/* Fixed under the header: full width on phones, a 24rem panel at the right on tablets.
          z-[55] keeps it above the phone's bottom nav (z-50). Rendered only while open, so the
          page never holds a second copy of the list next to the rail card's. */}
      {isOpen && (
        <div
          id={listId}
          className="fixed inset-x-4 top-22 z-[55] rounded-xl border border-gray-200 bg-white text-ink shadow-pop sm:left-auto sm:w-96 lg:top-26"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2 className="text-base font-extrabold">Notifications</h2>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close notifications"
              className="flex size-8 items-center justify-center rounded-lg text-ink hover:bg-surface-muted"
            >
              <XIcon className="size-5" />
            </button>
          </div>
          <div className="px-3 pb-3 pt-2">
            <NotificationList state={state} listClassName="max-h-[min(420px,calc(100dvh-14rem))]" />
          </div>
        </div>
      )}
    </div>
  );
}

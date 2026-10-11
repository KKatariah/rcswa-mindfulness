import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  BellIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardIcon,
  HeadphonesIcon,
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

/** Collapsible list of notifications the user has received, for a page's right rail. */
export default function NotificationsPanel() {
  const listId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<ReceivedNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Loaded up front so the unread count shows while the panel is closed.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    getNotificationHistory()
      .then((data) => { if (!cancelled) setNotifications(data); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

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

  return (
    <section className="w-full min-w-0 rounded-[10px] border border-gray-200 bg-white text-ink shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
      <h2>
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls={listId}
          className="flex w-full items-center gap-2.5 rounded-[10px] p-5 text-left focus-visible:outline-2 focus-visible:outline-brand-blue-dark"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-blue text-white">
            <BellIcon className="size-5" aria-hidden="true" />
          </span>
          <span className="flex-1 text-base font-extrabold leading-6">Notifications</span>
          {unreadCount > 0 && (
            <span className="rounded-full bg-brand-blue px-2 py-0.5 text-xs font-bold text-white">
              {unreadCount}
              <span className="sr-only"> unread</span>
            </span>
          )}
          <ChevronDownIcon
            className={`size-5 shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </h2>

      <div id={listId} hidden={!isOpen} className="border-t border-gray-100 px-3 pb-3 pt-2">
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
              className="max-h-[min(360px,50dvh)] space-y-3 overflow-y-auto overscroll-contain rounded-lg focus-visible:outline-2 focus-visible:outline-brand-blue-dark"
            >
              {groupByDay(notifications).map((group) => (
                <div key={group.label}>
                  <h3 className="px-2 pt-1 text-[11px] font-extrabold uppercase tracking-wide text-muted">{group.label}</h3>
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
      </div>
    </section>
  );
}

import type { ComponentType, MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type IconProps,
  BookOpenIcon,
  MessageCircleIcon,
  FolderIcon,
  CalendarIcon,
} from "@/components/ui/icons";
import { useAuth } from "@/context/AuthContext";
import { UserAvatar } from "@/components/ui/UserAvatar";

export type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<IconProps>;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Modules", href: "/modules", icon: BookOpenIcon },
  { label: "Surveys", href: "/surveys", icon: CalendarIcon },
  { label: "Forum", href: "/forum", icon: MessageCircleIcon },
  { label: "Resources", href: "/resources", icon: FolderIcon },
];

/** True when `href` is the current page or one below it; `exact` matches only the page itself. */
export function isNavActive(pathname: string | null, href: string, exact = false) {
  if (exact) return pathname === href;
  return pathname === href || !!pathname?.startsWith(`${href}/`);
}

/** A row in the student or admin sidebar. */
export function SidebarLink({
  item: { label, href, icon: Icon },
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`flex h-[44px] w-full items-center gap-3 rounded-lg px-3 transition-colors hover:underline ${
        active ? "bg-brand-blue text-white shadow-[0_4px_2px_rgba(0,0,0,0.1)]" : ""
      }`}
    >
      <Icon className="size-5 shrink-0" />
      <span className={`text-sm leading-none ${active ? "font-bold text-white" : "font-semibold text-gray-700"}`}>
        {label}
      </span>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const fullName = user?.full_name?.trim() || "Username";
  const onProfile = pathname === "/profile";

  return (
    <>
      <aside className="hidden w-full flex-col overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white p-4 shadow-card md:sticky md:top-24 md:bottom-4 md:flex md:h-[calc(100dvh-7rem)] md:max-h-[1032px] lg:top-[7.5rem] lg:bottom-6 lg:h-[calc(100dvh-9rem)]">
        <nav aria-label="Main navigation" className="grid grid-cols-2 gap-2 md:block md:shrink-0 md:space-y-2">
          {NAV_ITEMS.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              active={isNavActive(pathname, item.href)}
            />
          ))}
        </nav>

        <div className="mt-auto pt-6" />

        <Link
          href="/profile"
          aria-current={onProfile ? "page" : undefined}
          className={`flex w-full shrink-0 items-center gap-3 rounded-xl border px-3 py-[10px] transition-colors ${
            onProfile ? "border-brand-blue bg-brand-blue/5" : "border-gray-200 bg-gray-50 hover:bg-gray-100"
          }`}
        >
          <UserAvatar avatarUrl={user?.avatar_url} fullName={fullName} size={32} className="shrink-0" />
          <span className="min-w-0 truncate text-sm font-semibold text-ink">{fullName}</span>
        </Link>
      </aside>

      <nav aria-label="Bottom navigation" className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 md:hidden">
        <div className="flex w-full max-w-[390px] items-center justify-between rounded-t-[18px] border border-b-0 border-gray-200 bg-white px-3 pb-[6px] pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
            const active = isNavActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-center"
              >
                <Icon className={`size-[18px] shrink-0 transition-colors ${active ? "text-brand-blue" : "text-gray-700"}`} />
                <span className={`text-2xs leading-none ${active ? "font-bold text-brand-blue" : "font-medium text-gray-700"}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavActive, SidebarLink, type NavItem } from "@/components/main/Sidebar";
import { BarChart2Icon, CalendarIcon, BookOpenIcon, UsersIcon, CheckIcon, FolderIcon, ClipboardIcon, FlagIcon } from "@/components/ui/icons";

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: BarChart2Icon },
  { label: "Cohorts", href: "/admin/cohorts", icon: CalendarIcon },
  { label: "Modules", href: "/admin/modules", icon: BookOpenIcon },
  { label: "Surveys", href: "/admin/surveys", icon: ClipboardIcon },
  { label: "Resources", href: "/admin/resources", icon: FolderIcon },
  { label: "Users", href: "/admin/users", icon: UsersIcon },
  { label: "Approvals", href: "/admin/approvals", icon: CheckIcon },
  { label: "Moderation", href: "/admin/moderation", icon: FlagIcon },
];

// The dashboard is /admin itself; every other section owns its sub-pages.
const isActive = (pathname: string | null, href: string) => isNavActive(pathname, href, href === "/admin");

export default function AdminSidebar() {
  const pathname = usePathname();
  const activeTabRef = useRef<HTMLAnchorElement>(null);

  // On phones the sections are a scrolling strip; bring the current one into view.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <>
      {/* Sticky below the sticky header, filling the space under it like the student sidebar. */}
      <aside className="hidden flex-col overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white p-5 shadow-card md:sticky md:top-24 md:flex md:h-[calc(100dvh-7rem)] md:max-h-[1032px] lg:top-30 lg:h-[calc(100dvh-9rem)]">
        <Link href="/" className="flex items-center gap-3">
          <img src="/assets/branding/rcswa-logo-navy.png" alt="RCSWA logo" width={803} height={730} className="h-9 w-auto shrink-0" />
          <span className="text-lg font-bold text-ink">Admin</span>
        </Link>

        <div className="my-4 h-px w-full bg-gray-200" />

        <nav aria-label="Admin navigation" className="space-y-2">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </nav>

        {/* Directly under the nav, not pinned to the bottom: the sidebar is taller than the
            viewport below the page header, so a bottom-pinned link needed a scroll to reach. */}
        <div className="my-4 h-px w-full bg-[#E5E7EB]" />

        <Link
          href="/"
          className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-[10px] text-sm font-semibold text-gray-700"
        >
          ← Back to site
        </Link>
      </aside>

      {/* Phones: a horizontal strip instead of the full sidebar, so pages don't open on a screen of links. */}
      <nav aria-label="Admin navigation" className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:hidden">
        <ul className="flex w-max gap-2">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  ref={active ? activeTabRef : undefined}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold ${
                    active ? "border-brand-blue bg-brand-blue text-white" : "border-gray-200 bg-white text-gray-700"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

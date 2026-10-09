import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavActive, SidebarLink, type NavItem } from "@/components/main/Sidebar";
import { BarChart2Icon, CalendarIcon, BookOpenIcon, UsersIcon, CheckIcon, FolderIcon, ClipboardIcon } from "@/components/ui/icons";

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: BarChart2Icon },
  { label: "Cohorts", href: "/admin/cohorts", icon: CalendarIcon },
  { label: "Modules", href: "/admin/modules", icon: BookOpenIcon },
  { label: "Surveys", href: "/admin/surveys", icon: ClipboardIcon },
  { label: "Resources", href: "/admin/resources", icon: FolderIcon },
  { label: "Users", href: "/admin/users", icon: UsersIcon },
  { label: "Approvals", href: "/admin/approvals", icon: CheckIcon },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col rounded-[10px] border border-gray-200 bg-white p-5 shadow-[0_6px_9px_rgba(0,0,0,0.05)] md:sticky md:top-6 md:h-[calc(100dvh-3rem)] md:overflow-y-auto">
      <Link href="/" className="flex items-center gap-3">
        <img src="/assets/branding/rcswa-logo-navy.png" alt="RCSWA logo" width={803} height={730} className="h-9 w-auto shrink-0" />
        <span className="text-[18px] font-bold text-ink">Admin</span>
      </Link>

      <div className="my-4 h-px w-full bg-gray-200" />

      <nav aria-label="Admin navigation" className="space-y-2">
        {NAV_ITEMS.map((item) => (
          // The dashboard is /admin itself; every other section owns its sub-pages.
          <SidebarLink key={item.href} item={item} active={isNavActive(pathname, item.href, item.href === "/admin")} />
        ))}
      </nav>

      {/* Directly under the nav, not pinned to the bottom: the sidebar is taller than the
          viewport below the page header, so a bottom-pinned link needed a scroll to reach. */}
      <div className="my-4 h-px w-full bg-[#E5E7EB]" />

      <Link
        href="/"
        className="flex w-full items-center gap-3 rounded-[10px] border border-gray-200 bg-gray-50 px-3 py-[10px] text-[14px] font-semibold text-gray-700"
      >
        ← Back to site
      </Link>
    </aside>
  );
}

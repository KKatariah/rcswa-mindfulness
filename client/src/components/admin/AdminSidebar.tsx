import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconProps, BarChart2Icon, CalendarIcon, BookOpenIcon, UsersIcon, CheckIcon, FolderIcon, ClipboardIcon } from "@/components/ui/icons";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<IconProps>;
};

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
    <aside className="flex flex-col rounded-[10px] border border-[#E5E7EB] bg-white p-5 shadow-[0_6px_9px_rgba(0,0,0,0.05)] md:sticky md:top-6 md:h-[calc(100dvh-3rem)] md:overflow-y-auto">
      <Link href="/" className="flex items-center gap-3">
        <img src="/assets/branding/rcswa-logo-navy.png" alt="RCSWA logo" width={803} height={730} className="h-9 w-auto shrink-0" />
        <span className="text-[18px] font-bold text-[#111827]">Admin</span>
      </Link>

      <div className="my-4 h-px w-full bg-[#E5E7EB]" />

      <nav aria-label="Admin navigation" className="space-y-2">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          const isActive =
            href === "/admin"
              ? pathname === "/admin"
              : pathname === href || pathname?.startsWith(`${href}/`);

          return (
            <Link
              key={href}
              aria-current={isActive ? "page" : undefined}
              href={href}
              className={[
                "flex h-[44px] w-full items-center gap-3 rounded-[5px] px-3 transition-colors",
                isActive ? "bg-brand-blue text-white shadow-[0_4px_2px_rgba(0,0,0,0.1)]" : "",
              ].join(" ")}
            >
              <Icon className="h-[20px] w-[20px] shrink-0" />
              <span
                className={[
                  "text-[14px] leading-none",
                  isActive ? "text-white font-bold" : "text-[#374151] font-semibold",
                ].join(" ")}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Directly under the nav, not pinned to the bottom: the sidebar is taller than the
          viewport below the page header, so a bottom-pinned link needed a scroll to reach. */}
      <div className="my-4 h-px w-full bg-[#E5E7EB]" />

      <Link
        href="/"
        className="flex w-full items-center gap-3 rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-[10px] text-[14px] font-semibold text-[#374151]"
      >
        ← Back to site
      </Link>
    </aside>
  );
}

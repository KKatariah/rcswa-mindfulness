import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconProps, BookOpenIcon, MessageCircleIcon, FolderIcon, CalendarIcon } from "@/components/ui/icons";
import { useAuth } from "@/context/AuthContext";
import { UserAvatar } from "@/components/ui/UserAvatar";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<IconProps>;
  isBold?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Modules", href: "/modules", icon: BookOpenIcon },
  { label: "Surveys", href: "/surveys", icon: CalendarIcon},
  { label: "Forum", href: "/forum", icon: MessageCircleIcon },
  { label: "Resources", href: "/resources", icon: FolderIcon },
];

function isNavActive(pathname: string | null, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname?.startsWith(`${href}/`);
}

export default function Sidebar({ responsive = false }: { responsive?: boolean }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const fullName = user?.full_name?.trim() || "Username";
  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";

  return (
    <>
      <aside className={`hidden md:flex flex-col rounded-[10px] border border-[#E5E7EB] bg-white p-4 shadow-[0_6px_9px_rgba(0,0,0,0.05)] ${responsive ? "w-full md:sticky md:top-4 md:bottom-4 md:min-h-[calc(100dvh-2rem)] lg:top-6 lg:bottom-6 lg:min-h-[calc(100dvh-3rem)]" : "h-screen w-[280px] overflow-y-auto"}`}>
        <Link href="/" className="flex items-center gap-3">
          <span className="size-9 shrink-0 rounded-[10px] bg-brand-blue" />
          <span className="text-[18px] font-bold text-[#111827]">logo</span>
        </Link>

        <div className="my-3 h-px w-full bg-[#E5E7EB]" />

        <nav aria-label="Main navigation" className={responsive ? "grid grid-cols-2 gap-2 md:block md:space-y-2" : "space-y-2"}>
          {NAV_ITEMS.map(({ label, href, icon: Icon, isBold }) => {
            const isActive = isNavActive(pathname, href);

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
                    isActive ? "text-white" : "text-[#374151]",
                    isBold || isActive ? "font-bold" : "font-semibold",
                  ].join(" ")}
                >
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-6" />

        <Link
          href="/profile"
          aria-current={pathname === "/profile" ? "page" : undefined}
          className={[
            "flex w-full items-center gap-3 rounded-[10px] border px-3 py-[10px] transition-colors",
            pathname === "/profile"
              ? "border-brand-blue bg-brand-blue/5"
              : "border-[#E5E7EB] bg-[#F9FAFB] hover:bg-[#F3F4F6]",
          ].join(" ")}
        >
          <UserAvatar email={user?.email} fullName={fullName} size={32} className="shrink-0" />
          <span className="text-[14px] font-semibold text-[#111827]">{fullName}</span>
        </Link>
      </aside>

      <nav
        aria-label="Bottom navigation"
        className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 md:hidden"
      >
        <div className="flex w-full max-w-[390px] items-center justify-between rounded-t-[18px] border border-[#E5E7EB] border-b-0 bg-white px-3 pb-[6px] pt-3 shadow-none">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
            const isActive = isNavActive(pathname, href);

            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-center"
              >
                <Icon
                  className={[
                    "h-[18px] w-[18px] shrink-0 transition-colors",
                    isActive ? "text-[#5096CF]" : "text-[#374151]",
                  ].join(" ")}
                />
                <span
                  className={[
                    "text-[11px] leading-none",
                    isActive ? "font-bold text-[#5096CF]" : "font-medium text-[#374151]",
                  ].join(" ")}
                >
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

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  BookOpenIcon,
  CalendarIcon,
  FolderIcon,
  MessageCircleIcon,
  type IconProps,
} from "@/components/ui/icons";

type NavItem = {
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

export default function BottomNavbar({ className = "" }: { className?: string }) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  return (
    <nav
      aria-label="Bottom navigation"
      className={[
        "fixed inset-x-0 bottom-0 z-50 flex justify-center px-4",
        className,
      ].join(" ")}
    >
      <div className="flex w-full max-w-[390px] items-center justify-between rounded-t-[18px] border border-[#E5E7EB] border-b-0 bg-white px-3 pb-[6px] pt-3 shadow-none">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          const active = isActive(href);

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-center"
            >
              <Icon
                className={[
                  "h-[18px] w-[18px] shrink-0 transition-colors",
                  active ? "text-[#5096CF]" : "text-[#374151]",
                ].join(" ")}
              />
              <span
                className={[
                  "text-[11px] leading-none",
                  active ? "font-bold text-[#5096CF]" : "font-medium text-[#374151]",
                ].join(" ")}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

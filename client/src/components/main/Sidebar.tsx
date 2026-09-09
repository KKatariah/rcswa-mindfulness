import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconProps, HomeIcon, BookOpenIcon, BarChart2Icon, MessageCircleIcon, FolderIcon } from "@/components/ui/icons";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<IconProps>;
  isBold?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/", icon: HomeIcon },
  { label: "Modules", href: "/modules", icon: BookOpenIcon },
  { label: "Progress", href: "/progress", icon: BarChart2Icon },
  { label: "Forum", href: "/forum", icon: MessageCircleIcon },
  { label: "Resources", href: "/resources", icon: FolderIcon },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen overflow-y-auto w-[280px] flex-col rounded-[10px] border border-[#E5E7EB] bg-white p-5 shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
      <Link href="/" className="flex items-center gap-3">
        <span className="size-9 shrink-0 rounded-[10px] bg-brand-blue" />
        <span className="text-[18px] font-bold text-[#111827]">logo</span>
      </Link>

      <div className="my-4 h-px w-full bg-[#E5E7EB]" />

      <nav className="space-y-2">
        {NAV_ITEMS.map(({ label, href, icon: Icon, isBold }) => {
          const isActive =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={href}
              href={href}
              className={[
                "flex h-[44px] w-full items-center gap-3 rounded-[5px] px-3 transition-colors",
                isActive ? "bg-brand-blue shadow-[0_4px_2px_rgba(0,0,0,0.1)]" : "",
              ].join(" ")}
            >
              <Icon
                className="h-[20px] w-[20px] shrink-0"
              />

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

      <div className="flex w-full items-center gap-3 rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-[10px]">
        <div className="flex size-8 items-center justify-center rounded-full bg-[#E5E7EB]">
          <span className="text-[12px] font-bold text-[#6B7280]">U</span>
        </div>
        <span className="text-[14px] font-semibold text-[#111827]">Username</span>
      </div>
    </aside>
  );
}
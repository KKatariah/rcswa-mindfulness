import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function HomeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base} {...props}>
      <path d="M12.5 17.5V10.83a.83.83 0 0 0-.83-.83H8.33a.83.83 0 0 0-.83.83V17.5M2.5 8.33c0-.47.21-.92.59-1.27l5.83-5c.6-.51 1.48-.51 2.08 0l5.83 5c.38.35.6.8.59 1.27v7.5c0 .88-.71 1.6-1.6 1.6H4.17c-.88 0-1.6-.72-1.6-1.6z" />
    </svg>
  );
}

export function BookOpenIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base} {...props}>
      <path d="M10 5.83v11.67M10 5.83a3.33 3.33 0 0 0-3.33-3.33H2.5a.83.83 0 0 0-.83.83v10.83c0 .46.37.84.83.84h5a2.5 2.5 0 0 1 2.5 2.5m0-11.67a3.33 3.33 0 0 1 3.33-3.33h4.17c.46 0 .83.37.83.83v10.83a.83.83 0 0 1-.83.84h-5a2.5 2.5 0 0 0-2.5 2.5" />
    </svg>
  );
}

export function BarChart2Icon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base} {...props}>
      <path d="M4.17 17.5v-5M10 17.5v-15M15.83 17.5v-10" />
    </svg>
  );
}

export function MessageCircleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base} {...props}>
      <path d="M2.57 14.59c.07-.32.05-.66-.08-.97a8.33 8.33 0 1 1 3.98 3.93 2.08 2.08 0 0 0-1.11-.06l-2.85.83a.83.83 0 0 1-1.02-1.02z" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base} {...props}>
      <path d="M17.85 16.18a1.66 1.66 0 0 1-1.18.48H3.33a1.67 1.67 0 0 1-1.67-1.67V4.17c0-.92.75-1.67 1.67-1.67h3.27c.55 0 1.07.27 1.4.72l.67 1a1.67 1.67 0 0 0 1.4.78h6.58c.92 0 1.67.76 1.67 1.67v8.33c0 .44-.18.87-.49 1.18z" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 18 18" {...base} {...props}>
      <path d="M15 4.5 6.75 12.75 3 9" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 18 18" {...base} {...props}>
      <path d="M3.95 3a1.5 1.5 0 0 1 1.55-.05l9 5.25a1.5 1.5 0 0 1 0 2.6l-9 5.25A1.5 1.5 0 0 1 3.75 15V3.75c0-.28.07-.53.2-.75z" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 18 18" {...base} {...props}>
      <path d="M5.25 8.25v-3a3.75 3.75 0 1 1 7.5 0v3M3.75 8.25h10.5c.83 0 1.5.67 1.5 1.5v5.25c0 .83-.67 1.5-1.5 1.5H3.75c-.83 0-1.5-.67-1.5-1.5V9.75c0-.83.67-1.5 1.5-1.5" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 18 18" {...base} {...props}>
      <path d="M6 1.5v3M12 1.5v3M2.25 7.5h13.5M3.75 3h10.5c.83 0 1.5.67 1.5 1.5v10.5c0 .83-.67 1.5-1.5 1.5H3.75c-.83 0-1.5-.67-1.5-1.5V4.5c0-.83.67-1.5 1.5-1.5" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base} {...props}>
      <path d="M2.5 5h15M2.5 10h15M2.5 15h15" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base} {...props}>
      <path d="M15 5 5 15M5 5l10 10" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base} {...props}>
      <path d="M12.5 15 7.5 10l5-5" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base} {...props}>
      <path d="M7.5 15l5-5-5-5" />
    </svg>
  );
}

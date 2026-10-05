import type { ButtonHTMLAttributes, ReactNode } from "react";
import { PlusIcon } from "@/components/ui/icons";

/** Page title with optional content (a count, a "New" button) on the right. */
export default function AdminPageHeader({ title, children }: { title: string; children?: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<h1 className="text-2xl font-extrabold text-ink">{title}</h1>
			{children}
		</div>
	);
}

export function CreateButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			type="button"
			className="flex h-11 items-center gap-2 rounded-xl bg-brand-blue px-4 text-[14px] font-bold text-white disabled:opacity-50"
			{...props}
		>
			<PlusIcon className="size-4" />
			{children}
		</button>
	);
}

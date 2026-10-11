import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/icons";

type PageHeaderProps = {
	title: string;
	description?: ReactNode;
	/** Extra content rendered between the title and description (e.g. module duration). */
	children?: ReactNode;
	/** Content on the right of the title, such as a count or a "New" button. */
	actions?: ReactNode;
	/** A link back to the parent page, shown above the title. */
	back?: { href: string; label: string };
	/** Small label above the title, such as the module's week. */
	eyebrow?: string;
	/** Drop the card styling when the header sits inside another card. */
	embedded?: boolean;
};

/** Standard title card shown at the top of every page, student and admin alike. */
export default function PageHeader({ title, description, children, actions, back, eyebrow, embedded = false }: PageHeaderProps) {
	return (
		<header
			className={
				embedded
					? "px-6 pt-6 sm:px-8 sm:pt-8"
					: "rounded-xl border border-gray-200 bg-white p-6 shadow-card"
			}
		>
			{back && (
				<Link
					href={back.href}
					className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-brand-blue"
				>
					<ChevronLeftIcon className="size-4" />
					{back.label}
				</Link>
			)}
			{eyebrow && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-blue-dark">{eyebrow}</p>}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="min-w-0 text-2xl font-extrabold wrap-anywhere text-ink sm:text-3xl">{title}</h1>
				{actions}
			</div>
			{children}
			{description && <p className="mt-2 text-sm text-muted sm:text-base">{description}</p>}
		</header>
	);
}

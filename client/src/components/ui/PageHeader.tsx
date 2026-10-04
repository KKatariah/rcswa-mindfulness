import type { ReactNode } from "react";

type PageHeaderProps = {
	title: string;
	description?: string;
	/** Extra content rendered between the title and description (e.g. module duration). */
	children?: ReactNode;
	/** Drop the card styling when the header sits inside another card. */
	embedded?: boolean;
};

/** Standard title card shown at the top of every student-facing page. */
export default function PageHeader({ title, description, children, embedded = false }: PageHeaderProps) {
	return (
		<header
			className={
				embedded
					? "px-6 pt-6 sm:px-10 sm:pt-10 lg:px-12 lg:pt-12"
					: "rounded-[10px] border border-gray-200 bg-white p-6 shadow-[0_6px_9px_rgba(0,0,0,0.05)]"
			}
		>
			<h1 className="text-2xl font-extrabold wrap-anywhere text-ink sm:text-3xl">{title}</h1>
			{children}
			{description && <p className="mt-2 text-sm text-muted sm:text-base">{description}</p>}
		</header>
	);
}

import type { ReactNode } from "react";

const STYLES = {
	underline: {
		// Scrolls sideways when the tabs don't fit (phones). The grey rule is an inset shadow, not a
		// border, so the active tab's underline can sit on it without being clipped by the scroll box.
		list: "flex gap-2 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-gray-200)] [scrollbar-width:none]",
		tab: "shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-bold",
		active: "border-brand-blue text-brand-blue",
		inactive: "border-transparent text-muted hover:text-ink",
	},
	pills: {
		list: "flex gap-1 rounded-xl bg-gray-100 p-1",
		tab: "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
		active: "bg-white text-ink shadow-sm",
		inactive: "text-muted hover:text-ink",
	},
} as const;

/** Tab buttons; the caller renders the matching role="tabpanel". */
export default function Tabs<K extends string>({
	tabs,
	active,
	onChange,
	label,
	variant = "underline",
	className = "",
}: {
	tabs: { id: K; label: ReactNode }[];
	active: K;
	onChange: (id: K) => void;
	label: string;
	variant?: keyof typeof STYLES;
	className?: string;
}) {
	const style = STYLES[variant];
	return (
		<div role="tablist" aria-label={label} className={`${style.list} ${className}`}>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					type="button"
					role="tab"
					aria-selected={tab.id === active}
					onClick={(e) => {
						// A tab half off the edge of a scrolling bar slides fully into view.
						e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
						onChange(tab.id);
					}}
					className={`${style.tab} ${tab.id === active ? style.active : style.inactive}`}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}

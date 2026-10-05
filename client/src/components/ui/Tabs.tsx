import type { ReactNode } from "react";

const STYLES = {
	underline: {
		list: "flex gap-2 border-b border-gray-200",
		tab: "-mb-px border-b-2 px-4 py-2 text-sm font-bold",
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
					onClick={() => onChange(tab.id)}
					className={`${style.tab} ${tab.id === active ? style.active : style.inactive}`}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}

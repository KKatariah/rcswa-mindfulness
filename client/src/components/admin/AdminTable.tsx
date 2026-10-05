import type { ReactNode } from "react";
import { LoadingState } from "@/components/ui/feedback";

type AdminTableColumn = string | { label: ReactNode; className?: string };

/** Header cell for a column of drag handles. */
export const REORDER_COLUMN: AdminTableColumn = {
	label: <span className="sr-only">Reorder</span>,
	className: "w-10 px-3 py-3",
};

/**
 * Admin list table in a bordered card. Shows the loading, error or empty message
 * in place of the table; `children` are the body rows.
 */
export default function AdminTable({
	columns,
	loading = false,
	error = null,
	empty = false,
	emptyMessage,
	className = "mt-6",
	scrollLabel,
	children,
}: {
	columns: AdminTableColumn[];
	loading?: boolean;
	error?: string | null;
	empty?: boolean;
	emptyMessage?: string;
	className?: string;
	/** Names the table and lets keyboard users focus it to scroll sideways; needed when its rows hold no buttons or links. */
	scrollLabel?: string;
	children?: ReactNode;
}) {
	const scrollable = scrollLabel
		? ({ role: "region", "aria-label": scrollLabel, tabIndex: 0 } as const)
		: {};
	return (
		<div
			{...scrollable}
			className={`relative overflow-x-auto rounded-2xl border border-gray-200 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue ${className}`}
		>
			{loading ? (
				<LoadingState />
			) : error ? (
				<p className="p-6 text-sm text-red-600">{error}</p>
			) : empty ? (
				<p className="p-6 text-sm text-muted">{emptyMessage}</p>
			) : (
				<table className="w-full text-left text-sm">
					<thead>
						<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
							{columns.map((column, index) =>
								typeof column === "string" ? (
									<th key={index} className="px-5 py-3">
										{column || <span className="sr-only">Actions</span>}
									</th>
								) : (
									<th key={index} className={column.className ?? "px-5 py-3"}>
										{column.label}
									</th>
								),
							)}
						</tr>
					</thead>
					<tbody>{children}</tbody>
				</table>
			)}
		</div>
	);
}

import { ErrorBanner } from "@/components/ui/feedback";

/** "Load more" under a list that grows (usePagedList). Renders nothing once everything is shown. */
export function LoadMore({
	hasMore,
	loading,
	error,
	onLoadMore,
	className = "",
}: {
	hasMore: boolean;
	loading: boolean;
	error: string | null;
	onLoadMore: () => void;
	className?: string;
}) {
	if (!hasMore) return null;
	return (
		<div className={`flex flex-col items-center gap-3 ${className}`}>
			{error && <ErrorBanner>{error}</ErrorBanner>}
			<button
				type="button"
				onClick={onLoadMore}
				disabled={loading}
				className="h-10 rounded-lg border border-gray-200 bg-white px-5 text-sm font-semibold text-ink-soft hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
			>
				{loading ? "Loading…" : "Load more"}
			</button>
		</div>
	);
}

/** "Previous · Page 2 of 6 · Next", for a table shown one page at a time. */
export function Pager({
	offset,
	pageSize,
	count,
	onChange,
	className = "",
}: {
	offset: number;
	pageSize: number;
	count: number;
	onChange: (offset: number) => void;
	className?: string;
}) {
	if (count <= pageSize) return null;
	const page = Math.floor(offset / pageSize) + 1;
	const pages = Math.ceil(count / pageSize);
	const button =
		"h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-ink-soft hover:border-brand-blue hover:text-brand-blue disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:text-ink-soft";
	return (
		<nav aria-label="Pages" className={`flex items-center justify-center gap-4 ${className}`}>
			<button type="button" className={button} disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - pageSize))}>
				Previous
			</button>
			<span className="flex h-9 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-ink-soft">
				Page {page} of {pages}
			</span>
			<button type="button" className={button} disabled={page >= pages} onClick={() => onChange(offset + pageSize)}>
				Next
			</button>
		</nav>
	);
}

import { useEffect, useRef, useState, type DependencyList } from "react";
import { useAsync } from "@/hooks/useAsync";
import type { Page } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

const PAGE_SIZE = 25;
// The server's largest page (app/pagination.py).
const MAX_PAGE_SIZE = 100;

type Fetch<T> = (page: { limit: number; offset: number }) => Promise<Page<T>>;

/**
 * A long server list shown a page at a time, growing with `loadMore`.
 *
 * Changing `deps` (e.g. a new search) starts again from the first page. `reload` re-fetches
 * what is already shown, for after a change the server orders or counts (such as pinning).
 */
export function usePagedList<T extends { id: number }>(
	fetchPage: Fetch<T>,
	deps: DependencyList,
	options: { enabled?: boolean; errorFallback?: string } = {},
) {
	const list = useAsync(() => fetchPage({ limit: PAGE_SIZE, offset: 0 }), deps, { count: 0, results: [] } as Page<T>, options);
	const [loadingMore, setLoadingMore] = useState(false);
	const [moreError, setMoreError] = useState<string | null>(null);

	// Bumped whenever deps change, so a page that arrives for an old search is dropped.
	const generation = useRef(0);
	useEffect(() => {
		generation.current += 1;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);

	// A "Load more" failure belongs to the list it was loading; forget it when deps change.
	const [errorDeps, setErrorDeps] = useState(deps);
	if (errorDeps.length !== deps.length || errorDeps.some((dep, i) => !Object.is(dep, deps[i]))) {
		setErrorDeps(deps);
		setMoreError(null);
	}

	const { results: items, count } = list.data;

	async function loadMore() {
		const started = generation.current;
		setLoadingMore(true);
		setMoreError(null);
		try {
			const next = await fetchPage({ limit: PAGE_SIZE, offset: items.length });
			if (started !== generation.current) return;
			list.setData((prev) => {
				// Something added since the first page shifts the rest along; skip anything already shown.
				const shown = new Set(prev.results.map((item) => item.id));
				return { count: next.count, results: [...prev.results, ...next.results.filter((item) => !shown.has(item.id))] };
			});
		} catch (e) {
			if (started === generation.current) setMoreError(errorMessage(e, options.errorFallback ?? "Failed to load more"));
		} finally {
			setLoadingMore(false);
		}
	}

	async function reload() {
		const started = generation.current;
		const page = await fetchPage({ limit: Math.min(Math.max(items.length, PAGE_SIZE), MAX_PAGE_SIZE), offset: 0 });
		if (started === generation.current) list.setData(page);
	}

	function removeItem(id: number) {
		list.setData((prev) => ({ count: prev.count - 1, results: prev.results.filter((item) => item.id !== id) }));
	}

	return {
		items,
		count,
		hasMore: items.length < count,
		loading: list.loading,
		error: list.error,
		loadingMore,
		loadMoreError: moreError,
		loadMore,
		reload,
		removeItem,
	};
}

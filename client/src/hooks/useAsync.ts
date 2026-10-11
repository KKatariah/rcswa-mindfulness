import { useCallback, useEffect, useState, type DependencyList, type Dispatch, type SetStateAction } from "react";
import { errorMessage } from "@/lib/errors";

type AsyncState<T> = { data: T; loading: boolean; error: string | null };

/**
 * Runs `load` on mount and whenever `deps` change, and tracks its result.
 *
 * `data` starts as `initialData` and can be updated locally with `setData` (e.g. after a
 * save). A response that arrives after `deps` changed or the component unmounted is
 * ignored. Nothing runs while `enabled` is false; `loading` stays true until it does.
 */
export function useAsync<T>(
	load: () => Promise<T>,
	deps: DependencyList,
	initialData: T,
	{ enabled = true, errorFallback = "Something went wrong" }: { enabled?: boolean; errorFallback?: string } = {},
) {
	const [state, setState] = useState<AsyncState<T>>({ data: initialData, loading: true, error: null });

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		load().then(
			(data) => {
				if (!cancelled) setState({ data, loading: false, error: null });
			},
			(err: unknown) => {
				if (!cancelled) setState((s) => ({ ...s, loading: false, error: errorMessage(err, errorFallback) }));
			},
		);
		return () => {
			cancelled = true;
			// The run for the next deps starts out loading again.
			setState((s) => (s.loading ? s : { ...s, loading: true, error: null }));
		};
		// `load` is a new function every render; callers list what it reads in `deps`.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, ...deps]);

	const setData: Dispatch<SetStateAction<T>> = useCallback((value) => {
		setState((s) => ({ ...s, data: typeof value === "function" ? (value as (prev: T) => T)(s.data) : value }));
	}, []);

	return { ...state, setData };
}

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsync } from "@/hooks/useAsync";

/** A promise the test resolves or rejects by hand. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("useAsync", () => {
	it("starts loading with the initial data, then shows the result", async () => {
		const { result } = renderHook(() => useAsync(() => Promise.resolve(["a", "b"]), [], [] as string[]));

		expect(result.current).toMatchObject({ data: [], loading: true, error: null });
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current).toMatchObject({ data: ["a", "b"], error: null });
	});

	it("shows a thrown Error's message and keeps the previous data", async () => {
		const { result } = renderHook(() => useAsync(() => Promise.reject(new Error("Server down")), [], "initial"));

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current).toMatchObject({ data: "initial", error: "Server down" });
	});

	it("uses the fallback message for anything that isn't an Error", async () => {
		const { result } = renderHook(() =>
			useAsync(() => Promise.reject("nope"), [], null, { errorFallback: "Failed to load users" }),
		);

		await waitFor(() => expect(result.current.error).toBe("Failed to load users"));
	});

	it("doesn't run while disabled, and stays loading", () => {
		const load = vi.fn(() => Promise.resolve(1));
		const { result } = renderHook(() => useAsync(load, [], 0, { enabled: false }));

		expect(load).not.toHaveBeenCalled();
		expect(result.current.loading).toBe(true);
	});

	it("runs once enabled", async () => {
		const load = vi.fn(() => Promise.resolve(1));
		const { result, rerender } = renderHook(({ enabled }) => useAsync(load, [], 0, { enabled }), {
			initialProps: { enabled: false },
		});

		rerender({ enabled: true });

		await waitFor(() => expect(result.current.data).toBe(1));
		expect(load).toHaveBeenCalledOnce();
	});

	it("reloads when deps change, ignoring the response for the old deps", async () => {
		const pending: Record<string, ReturnType<typeof deferred<string>>> = {
			old: deferred<string>(),
			new: deferred<string>(),
		};
		const { result, rerender } = renderHook(({ q }) => useAsync(() => pending[q].promise, [q], ""), {
			initialProps: { q: "old" },
		});

		rerender({ q: "new" });
		await act(async () => pending.new.resolve("results for new"));
		await act(async () => pending.old.resolve("results for old"));

		expect(result.current.data).toBe("results for new");
	});

	it("goes back to loading (and clears the error) when deps change", async () => {
		let fail = true;
		const { result, rerender } = renderHook(
			({ q }) => useAsync(() => (fail ? Promise.reject(new Error("bad")) : new Promise<string>(() => {})), [q], ""),
			{ initialProps: { q: "a" } },
		);
		await waitFor(() => expect(result.current.error).toBe("bad"));

		fail = false;
		rerender({ q: "b" });

		expect(result.current).toMatchObject({ loading: true, error: null });
	});

	it("ignores a response that arrives after unmounting", async () => {
		const pending = deferred<number>();
		const errors = vi.spyOn(console, "error");
		const { result, unmount } = renderHook(() => useAsync(() => pending.promise, [], 0));

		unmount();
		await act(async () => pending.resolve(5));

		expect(result.current.data).toBe(0);
		expect(errors).not.toHaveBeenCalled();
	});

	it("lets the caller update the data locally, by value or from the previous value", async () => {
		const { result } = renderHook(() => useAsync(() => Promise.resolve([1, 2]), [], [] as number[]));
		await waitFor(() => expect(result.current.loading).toBe(false));

		act(() => result.current.setData((prev) => [...prev, 3]));
		expect(result.current.data).toEqual([1, 2, 3]);

		act(() => result.current.setData([9]));
		expect(result.current.data).toEqual([9]);
	});
});

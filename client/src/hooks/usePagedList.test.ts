import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Page } from "@/lib/api";
import { usePagedList } from "@/hooks/usePagedList";

type Item = { id: number };

const items = (...ids: number[]): Item[] => ids.map((id) => ({ id }));
const page = (count: number, ...ids: number[]): Page<Item> => ({ count, results: items(...ids) });

async function renderList(fetchPage: (p: { limit: number; offset: number }) => Promise<Page<Item>>, deps: unknown[] = []) {
	const hook = renderHook(({ deps }) => usePagedList(fetchPage, deps), { initialProps: { deps } });
	await waitFor(() => expect(hook.result.current.loading).toBe(false));
	return hook;
}

describe("usePagedList", () => {
	it("loads the first 25 items", async () => {
		const fetchPage = vi.fn().mockResolvedValue(page(60, 1, 2));
		const { result } = await renderList(fetchPage);

		expect(fetchPage).toHaveBeenCalledWith({ limit: 25, offset: 0 });
		expect(result.current).toMatchObject({ items: items(1, 2), count: 60, hasMore: true });
	});

	it("has no more once everything is shown", async () => {
		const { result } = await renderList(vi.fn().mockResolvedValue(page(2, 1, 2)));
		expect(result.current.hasMore).toBe(false);
	});

	it("appends the next page from where the list ends", async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce(page(4, 1, 2)).mockResolvedValueOnce(page(4, 3, 4));
		const { result } = await renderList(fetchPage);

		await act(() => result.current.loadMore());

		expect(fetchPage).toHaveBeenLastCalledWith({ limit: 25, offset: 2 });
		expect(result.current).toMatchObject({ items: items(1, 2, 3, 4), hasMore: false, loadingMore: false });
	});

	it("skips items already shown when something new shifted the next page along", async () => {
		// A new thread was posted after page one loaded, pushing item 2 onto page two.
		const fetchPage = vi.fn().mockResolvedValueOnce(page(3, 1, 2)).mockResolvedValueOnce(page(4, 2, 3));
		const { result } = await renderList(fetchPage);

		await act(() => result.current.loadMore());

		expect(result.current.items).toEqual(items(1, 2, 3));
		expect(result.current.count).toBe(4);
	});

	it("reports a failed 'load more' and keeps what was shown", async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce(page(4, 1, 2)).mockRejectedValueOnce(new Error("Network error"));
		const { result } = await renderList(fetchPage);

		await act(() => result.current.loadMore());

		expect(result.current).toMatchObject({ items: items(1, 2), loadMoreError: "Network error", loadingMore: false });
	});

	it("drops a page that arrives after the search changed", async () => {
		let finishOldPage!: (p: Page<Item>) => void;
		const fetchPage = vi.fn().mockResolvedValueOnce(page(4, 1, 2));
		const { result, rerender } = await renderList(fetchPage, ["old"]);
		fetchPage.mockImplementationOnce(() => new Promise((resolve) => (finishOldPage = resolve)));

		let loading!: Promise<void>;
		act(() => {
			loading = result.current.loadMore();
		});
		fetchPage.mockResolvedValue(page(1, 9));
		rerender({ deps: ["new"] });
		await waitFor(() => expect(result.current.items).toEqual(items(9)));

		await act(async () => {
			finishOldPage(page(4, 3, 4));
			await loading;
		});

		expect(result.current.items).toEqual(items(9));
	});

	it("forgets a 'load more' error when the search changes", async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce(page(4, 1, 2)).mockRejectedValueOnce(new Error("Network error"));
		const { result, rerender } = await renderList(fetchPage, ["a"]);
		await act(() => result.current.loadMore());
		expect(result.current.loadMoreError).toBe("Network error");

		fetchPage.mockResolvedValue(page(1, 5));
		rerender({ deps: ["b"] });

		expect(result.current.loadMoreError).toBeNull();
	});

	it("reloads everything already shown in one request", async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce(page(60, ...Array.from({ length: 25 }, (_, i) => i + 1)))
			.mockResolvedValueOnce(page(60, ...Array.from({ length: 25 }, (_, i) => i + 26)))
			.mockResolvedValueOnce(page(60, 99));
		const { result } = await renderList(fetchPage);
		await act(() => result.current.loadMore());

		await act(() => result.current.reload());

		expect(fetchPage).toHaveBeenLastCalledWith({ limit: 50, offset: 0 });
		expect(result.current.items).toEqual(items(99));
	});

	it("reloads at least a full page, and never more than the server's maximum of 100", async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce(page(1, 1)).mockResolvedValueOnce(page(1, 1));
		const small = await renderList(fetchPage);
		await act(() => small.result.current.reload());
		expect(fetchPage).toHaveBeenLastCalledWith({ limit: 25, offset: 0 });

		const big = vi.fn().mockResolvedValue(page(500, ...Array.from({ length: 120 }, (_, i) => i + 1)));
		const large = await renderList(big);
		await act(() => large.result.current.reload());
		expect(big).toHaveBeenLastCalledWith({ limit: 100, offset: 0 });
	});

	it("removes an item and lowers the count", async () => {
		const { result } = await renderList(vi.fn().mockResolvedValue(page(3, 1, 2, 3)));

		act(() => result.current.removeItem(2));

		expect(result.current).toMatchObject({ items: items(1, 3), count: 2 });
	});
});

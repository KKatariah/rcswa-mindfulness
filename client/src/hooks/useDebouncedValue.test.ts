import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

describe("useDebouncedValue", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("starts with the initial value", () => {
		const { result } = renderHook(() => useDebouncedValue("calm"));
		expect(result.current).toBe("calm");
	});

	it("updates only once the value has stopped changing for the delay", () => {
		const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
			initialProps: { value: "" },
		});

		rerender({ value: "m" });
		act(() => vi.advanceTimersByTime(200));
		rerender({ value: "me" });
		act(() => vi.advanceTimersByTime(200));
		expect(result.current).toBe("");

		act(() => vi.advanceTimersByTime(100));
		expect(result.current).toBe("me");
	});

	it("defaults to a 300ms delay", () => {
		const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), { initialProps: { value: "a" } });

		rerender({ value: "b" });
		act(() => vi.advanceTimersByTime(299));
		expect(result.current).toBe("a");
		act(() => vi.advanceTimersByTime(1));
		expect(result.current).toBe("b");
	});
});

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFormSubmit } from "@/hooks/useFormSubmit";

describe("useFormSubmit", () => {
	it("is submitting while the action runs", async () => {
		const { result } = renderHook(() => useFormSubmit("Save failed"));
		let finish!: () => void;
		const action = new Promise<void>((resolve) => {
			finish = resolve;
		});

		let running!: Promise<void>;
		act(() => {
			running = result.current.run(() => action);
		});
		expect(result.current.submitting).toBe(true);

		await act(async () => {
			finish();
			await running;
		});
		expect(result.current).toMatchObject({ submitting: false, error: null });
	});

	it("shows a thrown Error's message", async () => {
		const { result } = renderHook(() => useFormSubmit("Save failed"));

		await act(() => result.current.run(() => Promise.reject(new Error("Email already registered"))));

		expect(result.current).toMatchObject({ submitting: false, error: "Email already registered" });
	});

	it("uses the fallback for anything else thrown", async () => {
		const { result } = renderHook(() => useFormSubmit("Save failed"));

		await act(() => result.current.run(() => Promise.reject("oops")));

		expect(result.current.error).toBe("Save failed");
	});

	it("clears the last error when submitting again", async () => {
		const { result } = renderHook(() => useFormSubmit("Save failed"));
		await act(() => result.current.run(() => Promise.reject(new Error("first try"))));

		await act(() => result.current.run(() => Promise.resolve()));

		expect(result.current.error).toBeNull();
	});

	it("lets the caller set and clear the error directly", () => {
		const { result } = renderHook(() => useFormSubmit("Save failed"));

		act(() => result.current.setError("Google login failed"));
		expect(result.current.error).toBe("Google login failed");

		act(() => result.current.setError(null));
		expect(result.current.error).toBeNull();
	});
});

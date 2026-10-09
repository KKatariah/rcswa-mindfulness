import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useRequireRole } from "@/hooks/useRequireRole";
import type { AuthUser } from "@/types/user";

const replace = vi.fn();
const auth = { user: null as AuthUser | null, isLoading: true };

vi.mock("next/router", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));

const student = { id: 1, role: "student" } as AuthUser;
const admin = { id: 2, role: "admin" } as AuthUser;

beforeEach(() => {
	replace.mockReset();
	auth.user = null;
	auth.isLoading = true;
});

describe("useRequireAuth", () => {
	it("waits while the session is still loading", () => {
		renderHook(() => useRequireAuth());
		expect(replace).not.toHaveBeenCalled();
	});

	it("sends a signed-out visitor to the home page", () => {
		auth.isLoading = false;
		renderHook(() => useRequireAuth());
		expect(replace).toHaveBeenCalledExactlyOnceWith("/");
	});

	it("lets a signed-in user stay", () => {
		auth.isLoading = false;
		auth.user = student;
		renderHook(() => useRequireAuth());
		expect(replace).not.toHaveBeenCalled();
	});

	it("redirects once loading finishes with no user", () => {
		const { rerender } = renderHook(() => useRequireAuth());
		expect(replace).not.toHaveBeenCalled();

		auth.isLoading = false;
		rerender();

		expect(replace).toHaveBeenCalledExactlyOnceWith("/");
	});

	it("redirects when the user signs out on the page", () => {
		auth.isLoading = false;
		auth.user = student;
		const { rerender } = renderHook(() => useRequireAuth());

		auth.user = null;
		rerender();

		expect(replace).toHaveBeenCalledExactlyOnceWith("/");
	});

	it("returns the auth context for the page to use", () => {
		auth.isLoading = false;
		auth.user = student;
		const { result } = renderHook(() => useRequireAuth());
		expect(result.current).toBe(auth);
	});
});

describe("useRequireRole", () => {
	it("neither allows nor denies while loading", () => {
		const { result } = renderHook(() => useRequireRole("admin"));
		expect(result.current).toMatchObject({ allowed: false, denied: false, isLoading: true });
	});

	it("allows a user with the role", () => {
		auth.isLoading = false;
		auth.user = admin;
		const { result } = renderHook(() => useRequireRole("admin"));
		expect(result.current).toMatchObject({ allowed: true, denied: false, user: admin });
	});

	it("denies a user without the role", () => {
		auth.isLoading = false;
		auth.user = student;
		const { result } = renderHook(() => useRequireRole("admin"));
		expect(result.current).toMatchObject({ allowed: false, denied: true });
	});

	it("denies a signed-out visitor", () => {
		auth.isLoading = false;
		const { result } = renderHook(() => useRequireRole("admin"));
		expect(result.current).toMatchObject({ allowed: false, denied: true });
	});
});

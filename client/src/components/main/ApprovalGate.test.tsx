import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalGate } from "@/components/main/ApprovalGate";
import { AuthProvider } from "@/context/AuthContext";
import { getCurrentUser, getToken } from "@/lib/api";
import type { AuthUser } from "@/types/user";

const router = { pathname: "/", isReady: true, replace: vi.fn() };
vi.mock("next/router", () => ({ useRouter: () => router }));

vi.mock("@/lib/api", () => ({
	getToken: vi.fn(),
	getCurrentUser: vi.fn(),
	loginUser: vi.fn(),
	registerUser: vi.fn(),
	logoutUser: vi.fn(),
	loginWithGoogle: vi.fn(),
}));

const approved = { id: 1, role: "student", is_approved: true, enrollment_status: "active" } as AuthUser;
const pending = { ...approved, is_approved: false, enrollment_status: "pending" } as AuthUser;

function signedInAs(user: AuthUser | null) {
	vi.mocked(getToken).mockReturnValue(user ? "token" : null);
	vi.mocked(getCurrentUser).mockResolvedValue({ user: user! });
}

async function renderAt(pathname: string) {
	router.pathname = pathname;
	const view = render(
		<AuthProvider>
			<ApprovalGate>
				<p>Page content</p>
			</ApprovalGate>
		</AuthProvider>,
	);
	// The session check has finished once the gate renders something or redirects.
	await waitFor(() => expect(getToken).toHaveBeenCalled());
	await act(async () => {});
	return view;
}

beforeEach(() => {
	localStorage.clear();
	router.replace.mockReset();
	router.isReady = true;
	vi.mocked(getToken).mockReset();
	vi.mocked(getCurrentUser).mockReset();
});

describe("ApprovalGate", () => {
	it.each(["/modules", "/modules/3", "/forum", "/surveys", "/surveys/2", "/resources", "/profile"])(
		"sends a pending student home from %s without showing the page",
		async (path) => {
			signedInAs(pending);
			await renderAt(path);
			expect(router.replace).toHaveBeenCalledWith("/");
			expect(screen.queryByText("Page content")).not.toBeInTheDocument();
		},
	);

	it.each(["/", "/about"])("lets a pending student see %s", async (path) => {
		signedInAs(pending);
		await renderAt(path);
		expect(router.replace).not.toHaveBeenCalled();
		expect(screen.getByText("Page content")).toBeInTheDocument();
	});

	it("lets an approved student into the programme", async () => {
		signedInAs(approved);
		await renderAt("/modules");
		expect(router.replace).not.toHaveBeenCalled();
		expect(screen.getByText("Page content")).toBeInTheDocument();
	});

	it("takes an approved student from the home page to their modules, once", async () => {
		signedInAs(approved);
		const { rerender } = await renderAt("/");
		expect(router.replace).toHaveBeenCalledExactlyOnceWith("/modules");

		// Clicking Home later in the session really goes home.
		router.replace.mockReset();
		router.pathname = "/modules";
		rerender(
			<AuthProvider>
				<ApprovalGate>
					<p>Page content</p>
				</ApprovalGate>
			</AuthProvider>,
		);
		await act(async () => {});
		router.pathname = "/";
		rerender(
			<AuthProvider>
				<ApprovalGate>
					<p>Home page</p>
				</ApprovalGate>
			</AuthProvider>,
		);
		await act(async () => {});
		expect(router.replace).not.toHaveBeenCalled();
	});

	it("leaves signed-out visitors alone (useRequireAuth handles them)", async () => {
		signedInAs(null);
		await renderAt("/about");
		expect(router.replace).not.toHaveBeenCalled();
		expect(screen.getByText("Page content")).toBeInTheDocument();
	});

	it("waits for the router before redirecting", async () => {
		router.isReady = false;
		signedInAs(pending);
		await renderAt("/modules");
		expect(router.replace).not.toHaveBeenCalled();
	});

	it("sends a student home when the server says mid-session they're no longer approved", async () => {
		signedInAs(approved);
		await renderAt("/forum");
		expect(screen.getByText("Page content")).toBeInTheDocument();

		// An admin withdrew them; api.ts sees the 403 and fires approval-required.
		vi.mocked(getCurrentUser).mockResolvedValue({ user: pending });
		await act(async () => {
			window.dispatchEvent(new Event("approval-required"));
		});

		await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
		expect(screen.queryByText("Page content")).not.toBeInTheDocument();
		expect(JSON.parse(localStorage.getItem("user")!).is_approved).toBe(false);
	});
});

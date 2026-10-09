import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createAdditionalResource,
	deleteUser,
	getCurrentUser,
	listModuleSummaries,
	listUsers,
	loginUser,
	logoutUser,
	resetUserPassword,
} from "@/lib/api";

const API = "http://127.0.0.1:8000/api";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;

/** The URL and RequestInit of the nth fetch call. */
function call(n = 0) {
	const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
	return { url, init, headers: (init.headers ?? {}) as Record<string, string> };
}

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
	localStorage.clear();
	window.history.replaceState(null, "", "/");
});

afterEach(() => {
	localStorage.clear();
});

describe("request headers and body", () => {
	it("sends the stored token on authenticated calls", async () => {
		localStorage.setItem("token", "abc123");
		fetchMock.mockResolvedValue(jsonResponse({ temporary_password: "Xy3" }));

		await expect(resetUserPassword(7)).resolves.toEqual({ temporary_password: "Xy3" });

		const { url, init, headers } = call();
		expect(url).toBe(`${API}/users/7/reset-password/`);
		expect(init.method).toBe("POST");
		expect(headers.Authorization).toBe("Token abc123");
	});

	it("leaves the token off public endpoints, so a stale one can't break them", async () => {
		localStorage.setItem("token", "stale");
		fetchMock.mockResolvedValue(jsonResponse([]));

		await listModuleSummaries();

		expect(call().headers.Authorization).toBeUndefined();
	});

	it("sends JSON bodies with a JSON content type", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ message: "ok", token: "new-token", user: { id: 1 } }));

		await loginUser({ email: "a@b.c", password: "pw" });

		const { init, headers } = call();
		expect(headers["Content-Type"]).toBe("application/json");
		expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.c", password: "pw" });
	});

	it("sends FormData as-is, leaving the multipart content type to the browser", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ id: 1 }));

		await createAdditionalResource({ category: "book", title: "Calm", author: "A", url: "https://x.y" } as never);

		const { init, headers } = call();
		expect(init.body).toBeInstanceOf(FormData);
		expect((init.body as FormData).get("title")).toBe("Calm");
		expect(headers["Content-Type"]).toBeUndefined();
	});

	it("returns undefined for 204 No Content", async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

		await expect(deleteUser(3)).resolves.toBeUndefined();
		expect(call().init.method).toBe("DELETE");
	});
});

describe("query strings", () => {
	it("skips empty and undefined params", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ count: 0, results: [] }));

		await listUsers({ search: "", role: "admin", limit: 25, offset: 0 });

		expect(call().url).toBe(`${API}/users/?role=admin&limit=25&offset=0`);
	});

	it("adds no '?' when there are no params", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ count: 0, results: [] }));

		await listUsers();

		expect(call().url).toBe(`${API}/users/`);
	});

	it("encodes search text", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ count: 0, results: [] }));

		await listUsers({ search: "o'neil & co" });

		expect(new URL(call().url).searchParams.get("search")).toBe("o'neil & co");
	});
});

describe("auth token storage", () => {
	it("stores the token from a successful login", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ message: "ok", token: "fresh", user: { id: 1 } }));

		await loginUser({ email: "a@b.c", password: "pw" });

		expect(localStorage.getItem("token")).toBe("fresh");
	});

	it("drops the token on logout even when the server call fails", async () => {
		localStorage.setItem("token", "abc");
		fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

		await logoutUser();

		expect(localStorage.getItem("token")).toBeNull();
	});

	it("doesn't call the server for the current user when signed out", async () => {
		await expect(getCurrentUser()).rejects.toThrow("No token");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("error handling", () => {
	it("signs out when the stored token is rejected", async () => {
		localStorage.setItem("token", "revoked");
		localStorage.setItem("user", "{}");
		fetchMock.mockResolvedValue(jsonResponse({ detail: "Invalid token." }, 401));

		await expect(listUsers()).rejects.toThrow("Your session has expired. Please log in again.");

		expect(localStorage.getItem("token")).toBeNull();
		expect(localStorage.getItem("user")).toBeNull();
	});

	it("shows a failed login's own message rather than signing out", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: "Invalid email or password." }, 401));

		await expect(loginUser({ email: "a@b.c", password: "wrong" })).rejects.toThrow("Invalid email or password.");
	});

	it("announces approval-required when the account is awaiting approval", async () => {
		localStorage.setItem("token", "pending-user");
		const listener = vi.fn();
		window.addEventListener("approval-required", listener);
		fetchMock.mockResolvedValue(jsonResponse({ detail: "Your account is awaiting admin approval." }, 403));

		try {
			await expect(listUsers()).rejects.toThrow("Your account is awaiting admin approval.");
		} finally {
			window.removeEventListener("approval-required", listener);
		}

		expect(listener).toHaveBeenCalledOnce();
		expect(localStorage.getItem("token")).toBe("pending-user");
	});

	it("doesn't announce approval-required for other 403s", async () => {
		const listener = vi.fn();
		window.addEventListener("approval-required", listener);
		fetchMock.mockResolvedValue(jsonResponse({ detail: "You do not have permission to perform this action." }, 403));

		try {
			await expect(deleteUser(1)).rejects.toThrow("You do not have permission to perform this action.");
		} finally {
			window.removeEventListener("approval-required", listener);
		}

		expect(listener).not.toHaveBeenCalled();
	});

	it("says how long to wait when rate limited", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ detail: "Request was throttled. Expected available in 42 seconds." }, 429));

		await expect(listUsers()).rejects.toThrow("You're doing that too often. Please wait 42 seconds and try again.");
	});

	it("falls back to a generic wait message when the throttle gives no time", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ detail: "Slow down." }, 429));

		await expect(listUsers()).rejects.toThrow("You're doing that too often. Please wait a moment and try again.");
	});

	it("joins field validation errors into one message", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ email: ["Enter a valid email."], password: ["Too short."] }, 400));

		await expect(loginUser({ email: "x", password: "y" })).rejects.toThrow("Enter a valid email. Too short.");
	});

	it("copes with an HTML error page", async () => {
		fetchMock.mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }));

		await expect(listUsers()).rejects.toThrow("Something went wrong");
	});
});

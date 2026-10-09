import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToken, getVapidPublicKey, savePushSubscription, updateNotificationPreferences } from "@/lib/api";
import { enableNotifications } from "@/lib/pushNotifications";

vi.mock("@/lib/api", () => ({
	getToken: vi.fn(),
	getVapidPublicKey: vi.fn(),
	savePushSubscription: vi.fn(),
	updateNotificationPreferences: vi.fn(),
}));

// A VAPID key in the URL-safe, unpadded base64 the server sends: bytes 251, 255, 191 ("+/+/" in plain base64).
const VAPID_KEY = "-_-_";
const VAPID_BYTES = [251, 255, 191];

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

function fakeSubscription(keys: { p256dh?: ArrayBuffer | null; auth?: ArrayBuffer | null } = {}) {
	const k = { p256dh: bytes(1, 2, 3, 251, 255), auth: bytes(250), ...keys };
	return {
		endpoint: "https://push.example.com/sub/abc",
		getKey: vi.fn((name: "p256dh" | "auth") => k[name]),
	};
}

let permission: NotificationPermission;
let pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
let register: ReturnType<typeof vi.fn>;

beforeEach(() => {
	permission = "granted";
	pushManager = {
		getSubscription: vi.fn().mockResolvedValue(null),
		subscribe: vi.fn().mockResolvedValue(fakeSubscription()),
	};
	register = vi.fn().mockResolvedValue({ pushManager });

	vi.stubGlobal("Notification", { requestPermission: vi.fn(async () => permission) });
	vi.stubGlobal("PushManager", function PushManager() {});
	Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });

	vi.mocked(getToken).mockReturnValue("token");
	vi.mocked(getVapidPublicKey).mockResolvedValue(VAPID_KEY);
	vi.mocked(savePushSubscription).mockResolvedValue({});
	vi.mocked(updateNotificationPreferences).mockResolvedValue({} as never);
});

afterEach(() => {
	// @ts-expect-error -- remove the stub so "serviceWorker" in navigator is false again.
	delete navigator.serviceWorker;
	vi.clearAllMocks();
});

describe("enableNotifications", () => {
	it("subscribes, saves the subscription and records that notifications are allowed", async () => {
		await expect(enableNotifications()).resolves.toBe("Notifications enabled successfully.");

		expect(register).toHaveBeenCalledWith("/sw.js");
		expect(pushManager.subscribe).toHaveBeenCalledOnce();
		expect(savePushSubscription).toHaveBeenCalledExactlyOnceWith({
			endpoint: "https://push.example.com/sub/abc",
			p256dh: "AQID-_8", // base64url, no padding
			auth: "-g",
		});
		expect(updateNotificationPreferences).toHaveBeenCalledExactlyOnceWith({ push_denied: false });
	});

	it("subscribes with the server's VAPID key, decoded from base64url", async () => {
		await enableNotifications();

		const options = pushManager.subscribe.mock.calls[0][0];
		expect(options.userVisibleOnly).toBe(true);
		expect([...new Uint8Array(options.applicationServerKey)]).toEqual(VAPID_BYTES);
	});

	it("reuses an existing subscription instead of making a new one", async () => {
		pushManager.getSubscription.mockResolvedValue(fakeSubscription());

		await enableNotifications();

		expect(pushManager.subscribe).not.toHaveBeenCalled();
		expect(savePushSubscription).toHaveBeenCalledOnce();
	});

	describe("unsupported browsers", () => {
		it.each([
			["serviceWorker", () => delete (navigator as { serviceWorker?: unknown }).serviceWorker],
			["PushManager", () => delete (window as { PushManager?: unknown }).PushManager],
			["Notification", () => delete (window as { Notification?: unknown }).Notification],
		])("say so when %s is missing", async (_name, remove) => {
			remove();

			await expect(enableNotifications()).rejects.toThrow("Push notifications are not supported by this browser.");
			expect(register).not.toHaveBeenCalled();
		});
	});

	it("requires the user to be signed in, before asking for permission", async () => {
		vi.mocked(getToken).mockReturnValue(null);

		await expect(enableNotifications()).rejects.toThrow("You must be logged in to enable notifications.");
		expect(Notification.requestPermission).not.toHaveBeenCalled();
	});

	it("records a refusal and explains how to unblock notifications", async () => {
		permission = "denied";

		await expect(enableNotifications()).rejects.toThrow(/Notifications are blocked for this site/);
		expect(updateNotificationPreferences).toHaveBeenCalledExactlyOnceWith({ push_denied: true });
		expect(register).not.toHaveBeenCalled();
	});

	it("still shows the blocked message if recording the refusal fails", async () => {
		permission = "denied";
		vi.mocked(updateNotificationPreferences).mockRejectedValue(new Error("offline"));

		await expect(enableNotifications()).rejects.toThrow(/Notifications are blocked for this site/);
	});

	it("asks the user to try again when they dismiss the prompt", async () => {
		permission = "default";

		await expect(enableNotifications()).rejects.toThrow("No choice was made. Try again and choose 'Allow' when asked.");
		expect(updateNotificationPreferences).not.toHaveBeenCalled();
		expect(register).not.toHaveBeenCalled();
	});

	it("explains when the VAPID key can't be fetched", async () => {
		vi.mocked(getVapidPublicKey).mockRejectedValue(new Error("Something went wrong"));

		await expect(enableNotifications()).rejects.toThrow("Could not get the VAPID public key.");
		expect(pushManager.subscribe).not.toHaveBeenCalled();
	});

	it("explains when the server has no VAPID key configured", async () => {
		vi.mocked(getVapidPublicKey).mockResolvedValue(undefined);

		await expect(enableNotifications()).rejects.toThrow("VAPID public key was not returned by the server.");
	});

	it.each([["p256dh"], ["auth"]])("refuses a subscription missing its %s key", async (missing) => {
		pushManager.subscribe.mockResolvedValue(fakeSubscription({ [missing]: null }));

		await expect(enableNotifications()).rejects.toThrow("Push subscription keys are missing.");
		expect(savePushSubscription).not.toHaveBeenCalled();
	});

	it("explains when the subscription can't be saved", async () => {
		vi.mocked(savePushSubscription).mockRejectedValue(new Error("500"));

		await expect(enableNotifications()).rejects.toThrow("Could not save the push subscription.");
		expect(updateNotificationPreferences).not.toHaveBeenCalled();
	});

	it("explains when the preference can't be updated", async () => {
		vi.mocked(updateNotificationPreferences).mockRejectedValue(new Error("500"));

		await expect(enableNotifications()).rejects.toThrow("Could not update notification preferences.");
	});

	it("passes on a failure to subscribe from the browser's push service", async () => {
		pushManager.subscribe.mockRejectedValue(new DOMException("Registration failed - push service error", "AbortError"));

		await expect(enableNotifications()).rejects.toThrow("Registration failed - push service error");
		expect(savePushSubscription).not.toHaveBeenCalled();
	});
});

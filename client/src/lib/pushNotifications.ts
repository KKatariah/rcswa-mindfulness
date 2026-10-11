import { getToken, getVapidPublicKey, savePushSubscription, updateNotificationPreferences } from "@/lib/api";

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; i++) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray.buffer;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
	let binary = "";
	new Uint8Array(buffer).forEach((byte) => {
		binary += String.fromCharCode(byte);
	});
	return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Runs `action`; if it fails, throws `message` instead of the API's own error. */
async function orThrow<T>(action: Promise<T>, message: string): Promise<T> {
	try {
		return await action;
	} catch {
		throw new Error(message);
	}
}

/**
 * Requests notification permission, registers the service worker, subscribes to
 * push, and persists the subscription to the backend.
 *
 * Returns a human-readable result string on success.
 * Throws an Error with a user-facing message on failure.
 */
export async function enableNotifications(): Promise<string> {
	if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
		throw new Error("Push notifications are not supported by this browser.");
	}

	if (!getToken()) {
		throw new Error("You must be logged in to enable notifications.");
	}

	const permission = await Notification.requestPermission();

	if (permission === "denied") {
		// Best-effort: recording the denial must not hide the blocked message below.
		await updateNotificationPreferences({ push_denied: true }).catch(() => undefined);
		throw new Error(
			"Notifications are blocked for this site. Allow them in your browser or device settings, then try again.",
		);
	}

	if (permission !== "granted") {
		throw new Error("No choice was made. Try again and choose 'Allow' when asked.");
	}

	const registration = await navigator.serviceWorker.register("/sw.js");

	const vapidPublicKey = await orThrow(getVapidPublicKey(), "Could not get the VAPID public key.");
	if (!vapidPublicKey) {
		throw new Error("VAPID public key was not returned by the server.");
	}

	let subscription = await registration.pushManager.getSubscription();
	if (!subscription) {
		subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
		});
	}

	const p256dh = subscription.getKey("p256dh");
	const auth = subscription.getKey("auth");
	if (!p256dh || !auth) {
		throw new Error("Push subscription keys are missing.");
	}

	await orThrow(
		savePushSubscription({
			endpoint: subscription.endpoint,
			p256dh: arrayBufferToBase64Url(p256dh),
			auth: arrayBufferToBase64Url(auth),
		}),
		"Could not save the push subscription.",
	);

	await orThrow(updateNotificationPreferences({ push_denied: false }), "Could not update notification preferences.");

	return "Notifications enabled successfully.";
}

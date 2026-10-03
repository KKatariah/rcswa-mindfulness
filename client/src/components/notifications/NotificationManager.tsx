import { useState } from "react";
import { API_BASE_URL } from "@/lib/api";

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);

  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray.buffer;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) {
    return "";
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Requests notification permission, registers the service worker, subscribes to
 * push, and persists the subscription to the backend.
 *
 * Returns a human-readable result string on success or informational outcomes.
 * Throws an Error with a user-facing message on failure.
 */
export async function enableNotifications(): Promise<string> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    throw new Error(
      "Push notifications are not supported by this browser."
    );
  }

  const token = localStorage.getItem("token");

  if (!token) {
    throw new Error(
      "You must be logged in to enable notifications."
    );
  }

  const permission = await Notification.requestPermission();

  if (permission === "denied") {
    const preferenceResponse = await fetch(
      `${API_BASE_URL}/notifications/preferences/me/`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ push_denied: true }),
      }
    );

    if (!preferenceResponse.ok) {
      throw new Error("Could not update notification preferences.");
    }

    throw new Error(
      "Notifications are blocked in your browser. Follow the 'notifications are blocked' step above to allow them, then try again."
    );
  }

  if (permission !== "granted") {
    throw new Error(
      "No choice was made. Click 'Enable notifications' again and choose 'Allow'."
    );
  }

  const registration = await navigator.serviceWorker.register("/sw.js");

  const vapidResponse = await fetch(
    `${API_BASE_URL}/notifications/vapid-public-key/`
  );

  if (!vapidResponse.ok) {
    throw new Error("Could not get the VAPID public key.");
  }

  const vapidData = await vapidResponse.json();
  const vapidPublicKey = vapidData.vapid_public_key;

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

  const subscriptionResponse = await fetch(
    `${API_BASE_URL}/notifications/subscriptions/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: arrayBufferToBase64Url(p256dh),
        auth: arrayBufferToBase64Url(auth),
      }),
    }
  );

  if (!subscriptionResponse.ok) {
    throw new Error("Could not save the push subscription.");
  }

  const preferenceResponse = await fetch(
    `${API_BASE_URL}/notifications/preferences/me/`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify({ push_denied: false }),
    }
  );

  if (!preferenceResponse.ok) {
    throw new Error("Could not update notification preferences.");
  }

  return "Notifications enabled successfully.";
}

export default function NotificationManager() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleClick() {
    setLoading(true);
    setMessage("");

    try {
      const result = await enableNotifications();
      setMessage(result);
    } catch (error) {
      console.error("Failed to enable notifications:", error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to enable notifications."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? "Enabling..." : "Enable notifications"}
      </button>

      {message && <p>{message}</p>}
    </div>
  );
}

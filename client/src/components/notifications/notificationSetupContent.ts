export type SetupStep = {
	instruction: string;
	/** If provided, renders a labelled image placeholder slot below the instruction text. */
	imagePlaceholder?: string;
};

export type PlatformContent = {
	tabLabel: string;
	steps: SetupStep[];
};

export type Platform = "ios" | "android" | "desktop";

// ---------------------------------------------------------------------------
// Placeholder copy — Ari to replace all [PLACEHOLDER] strings with final text
// ---------------------------------------------------------------------------

export const NOTIFICATION_SETUP_CONTENT: Record<Platform, PlatformContent> = {
	ios: {
		tabLabel: "iPhone / iPad",
		steps: [
			{
				instruction:
					"[PLACEHOLDER – Ari to write: Step 1 — open the website in Safari (push notifications require Safari on iOS; Chrome and Firefox on iOS do not support them).]",
				imagePlaceholder:
					"[PLACEHOLDER – screenshot: Safari address bar showing the site URL]",
			},
			{
				instruction:
					"[PLACEHOLDER – Ari to write: Step 2 — tap the Share icon (the box with an arrow pointing upward) at the bottom of the screen.]",
				imagePlaceholder:
					"[PLACEHOLDER – screenshot: Safari bottom toolbar with Share icon highlighted]",
			},
			{
				instruction:
					"[PLACEHOLDER – Ari to write: Step 3 — scroll down in the Share sheet and tap 'Add to Home Screen', then tap 'Add' in the top-right corner.]",
				imagePlaceholder:
					"[PLACEHOLDER – screenshot: iOS Share sheet with 'Add to Home Screen' option visible]",
			},
			{
				instruction:
					"[PLACEHOLDER – Ari to write: Step 4 — open the app from your Home Screen (it must be launched from the Home Screen icon, not Safari), then tap 'Enable notifications' below.]",
			},
		],
	},
	android: {
		tabLabel: "Android",
		steps: [
			{
				instruction:
					"[PLACEHOLDER – Ari to write: Step 1 — open the website in Chrome on your Android device.]",
				imagePlaceholder:
					"[PLACEHOLDER – screenshot: Chrome address bar on Android showing the site URL]",
			},
			{
				instruction:
					"[PLACEHOLDER – Ari to write: Step 2 — tap the three-dot menu in the top-right corner and select 'Add to Home screen', or tap 'Install' if a banner appears at the bottom of the screen.]",
				imagePlaceholder:
					"[PLACEHOLDER – screenshot: Chrome menu open with 'Add to Home screen' highlighted]",
			},
			{
				instruction:
					"[PLACEHOLDER – Ari to write: Step 3 — tap 'Enable notifications' below and tap 'Allow' when Chrome asks for notification permission.]",
				imagePlaceholder:
					"[PLACEHOLDER – screenshot: Android browser notification permission prompt]",
			},
		],
	},
	desktop: {
		tabLabel: "Desktop",
		steps: [
			{
				instruction:
					"[PLACEHOLDER – Ari to write: Step 1 — open the website in Chrome, Edge, or Safari on your computer.]",
			},
			{
				instruction:
					"[PLACEHOLDER – Ari to write: Step 2 — tap 'Enable notifications' below. A permission prompt will appear in your browser.]",
				imagePlaceholder:
					"[PLACEHOLDER – screenshot: browser notification permission prompt bar]",
			},
			{
				instruction:
					"[PLACEHOLDER – Ari to write: Step 3 — click 'Allow' to confirm. You will receive a confirmation message once notifications are set up.]",
			},
		],
	},
};

export function detectPlatform(): Platform {
	if (typeof window === "undefined") return "desktop";
	const ua = navigator.userAgent;
	if (/iPad|iPhone|iPod/.test(ua)) return "ios";
	if (/Android/.test(ua)) return "android";
	return "desktop";
}

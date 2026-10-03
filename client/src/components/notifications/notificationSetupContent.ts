export type StepVisualKey =
	| "ios-share"
	| "ios-add-to-home"
	| "ios-home-icon"
	| "allow-prompt"
	| "site-settings"
	| "android-menu"
	| "desktop-prompt";

export type SetupStep = {
	instruction: string;
	/** If provided, renders a step illustration below the instruction text. */
	visual?: StepVisualKey;
};

export type PlatformContent = {
	tabLabel: string;
	steps: SetupStep[];
};

export type Platform = "ios" | "android" | "desktop";

// Setup instructions shown in NotificationSetupModal, one entry per platform tab.

export const NOTIFICATION_SETUP_CONTENT: Record<Platform, PlatformContent> = {
	ios: {
		tabLabel: "iPhone / iPad",
		steps: [
			{
				instruction:
					"Open this website in Safari. On iPhone and iPad, reminders only work once the site has been added to your Home Screen, and you need iOS 16.4 or later.",
			},
			{
				instruction:
					"Tap the Share button (the square with an arrow pointing up) in the Safari toolbar.",
				visual: "ios-share",
			},
			{
				instruction:
					"Scroll down the list, tap 'Add to Home Screen', then tap 'Add' in the top-right corner.",
				visual: "ios-add-to-home",
			},
			{
				instruction:
					"Close Safari and open the app from its new icon on your Home Screen. Log in, go to your Profile, and tap 'Set up notifications' to come back to this screen.",
				visual: "ios-home-icon",
			},
			{
				instruction:
					"Tap 'Enable notifications' below, then tap 'Allow' when your device asks. If you see a message that notifications are not supported, the app was opened in Safari rather than from the Home Screen icon.",
				visual: "allow-prompt",
			},
			{
				instruction:
					"If you see a message that notifications are blocked, they were blocked earlier. Open the Settings app, tap 'Notifications', find this app in the list, turn on 'Allow Notifications', then come back and try again.",
			},
		],
	},
	android: {
		tabLabel: "Android",
		steps: [
			{
				instruction:
					"Open this website in Chrome on your Android device and log in.",
			},
			{
				instruction:
					"Tap 'Enable notifications' below, then tap 'Allow' when Chrome asks for permission. Reminders will arrive even when Chrome is closed.",
				visual: "allow-prompt",
			},
			{
				instruction:
					"If you see a message that notifications are blocked, they were blocked earlier. Tap the small icon at the left end of the address bar (two sliders or a padlock), tap 'Permissions', set 'Notifications' to 'Allow', then reload this page and try again.",
				visual: "site-settings",
			},
			{
				instruction:
					"Optional: for one-tap access, open the three-dot menu in Chrome and choose 'Add to Home screen'.",
				visual: "android-menu",
			},
		],
	},
	desktop: {
		tabLabel: "Desktop",
		steps: [
			{
				instruction:
					"Open this website in Chrome, Edge, Firefox or Safari on your computer and log in.",
			},
			{
				instruction:
					"Click 'Enable notifications' below. A permission prompt will appear near the address bar.",
				visual: "desktop-prompt",
			},
			{
				instruction:
					"Click 'Allow'. A confirmation message will appear here once reminders are set up. If you allowed notifications before, the prompt is skipped and you go straight to the confirmation. Reminders arrive while your browser is running, even if this site is closed.",
			},
			{
				instruction:
					"If you see a message that notifications are blocked, they were blocked earlier. In Chrome, Edge or Firefox, click the small icon at the left end of the address bar (a circle with an 'i', a padlock, or two sliders), set 'Notifications' to 'Allow', then reload this page and try again.",
				visual: "site-settings",
			},
			{
				instruction:
					"In Safari on a Mac there is no icon for this. Open the Safari menu, choose 'Settings', then 'Websites', then 'Notifications', set this site to 'Allow', then reload this page and try again.",
			},
			{
				instruction:
					"Reminders are set up separately on each device and browser. Repeat these steps on your phone if you want them there too.",
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

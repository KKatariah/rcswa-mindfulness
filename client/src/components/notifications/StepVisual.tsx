import type { StepVisualKey } from "./notificationSetupContent";

// CSS variable references for brand colours; standard greys use hex.
const BLUE = "var(--color-brand-blue)";
const INK = "var(--color-ink)";
const MUTED = "var(--color-muted)";
const BLUE_TINT = "#eff6ff";
const G100 = "#f3f4f6";
const G200 = "#e5e7eb";
const G300 = "#d1d5db";
const G400 = "#9ca3af";
const FF = "var(--font-sans), sans-serif";

// ── Visuals ──────────────────────────────────────────────────────────────────

/** Permission prompt card: "Allow notifications?" with Block/Allow buttons. */
function AllowPrompt() {
	return (
		<svg
			viewBox="0 0 240 90"
			width="100%"
			style={{ maxWidth: 280 }}
			role="img"
			aria-label="Browser notification permission dialog with Allow highlighted"
		>
			<rect x="20" y="4" width="200" height="82" rx="10" fill="white" stroke={G200} strokeWidth="1" />
			<text x="120" y="30" textAnchor="middle" fontSize="11" fill={INK} fontFamily={FF}>
				Allow notifications?
			</text>
			<line x1="20" y1="44" x2="220" y2="44" stroke={G100} strokeWidth="1" />
			{/* Don't Allow */}
			<rect x="28" y="52" width="80" height="26" rx="13" fill="white" stroke={G300} strokeWidth="1" />
			<text x="68" y="69" textAnchor="middle" fontSize="10" fill={MUTED} fontFamily={FF}>
				{"Don't Allow"}
			</text>
			{/* Allow */}
			<rect x="132" y="52" width="80" height="26" rx="13" fill={BLUE} />
			<text x="172" y="69" textAnchor="middle" fontSize="10" fill="white" fontWeight="600" fontFamily={FF}>
				Allow
			</text>
		</svg>
	);
}

/** Safari bottom toolbar with the share button (square + up arrow) highlighted. */
function IosShare() {
	return (
		<svg
			viewBox="0 0 240 64"
			width="100%"
			style={{ maxWidth: 280 }}
			role="img"
			aria-label="Safari toolbar with Share button highlighted"
		>
			<rect x="0" y="8" width="240" height="56" rx="10" fill={G100} stroke={G200} strokeWidth="1" />
			{/* Back chevron */}
			<path d="M22 28 L16 36 L22 44" stroke={G300} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
			{/* Forward chevron (dimmed) */}
			<path d="M58 28 L64 36 L58 44" stroke={G200} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
			{/* Share button — highlighted */}
			<circle cx="120" cy="36" r="17" fill={BLUE} />
			<line x1="120" y1="31" x2="120" y2="24" stroke="white" strokeWidth="2" strokeLinecap="round" />
			<path d="M117 27 L120 24 L123 27" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M113 32 L113 43 L127 43 L127 32" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
			{/* Bookmark */}
			<path d="M178 24 L178 47 L185 42 L192 47 L192 24 Z" stroke={G300} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
			{/* Tabs (two overlapping squares) */}
			<rect x="212" y="28" width="11" height="11" rx="2" stroke={G300} strokeWidth="1.5" fill={G100} />
			<rect x="215" y="25" width="11" height="11" rx="2" stroke={G300} strokeWidth="1.5" fill={G100} />
		</svg>
	);
}

/** Share sheet with "Add to Home Screen" row highlighted. */
function IosAddToHome() {
	return (
		<svg
			viewBox="0 0 240 100"
			width="100%"
			style={{ maxWidth: 280 }}
			role="img"
			aria-label="Share sheet with Add to Home Screen option highlighted"
		>
			<rect x="10" y="4" width="220" height="92" rx="10" fill="white" stroke={G200} strokeWidth="1" />
			{/* Row 1 */}
			<text x="28" y="27" fontSize="11" fill={G400} fontFamily={FF}>Copy</text>
			<circle cx="196" cy="20" r="8" fill={G200} />
			<line x1="10" y1="36" x2="230" y2="36" stroke={G100} strokeWidth="1" />
			{/* Row 2 — highlighted (middle row, no clipping needed) */}
			<rect x="11" y="37" width="218" height="30" fill={BLUE_TINT} />
			<text x="28" y="57" fontSize="11" fill={BLUE} fontWeight="600" fontFamily={FF}>
				Add to Home Screen
			</text>
			{/* Plus-in-square icon */}
			<rect x="188" y="44" width="16" height="16" rx="3" fill={BLUE} />
			<line x1="196" y1="48" x2="196" y2="56" stroke="white" strokeWidth="2" strokeLinecap="round" />
			<line x1="192" y1="52" x2="200" y2="52" stroke="white" strokeWidth="2" strokeLinecap="round" />
			<line x1="10" y1="67" x2="230" y2="67" stroke={G100} strokeWidth="1" />
			{/* Row 3 */}
			<text x="28" y="88" fontSize="11" fill={G300} fontFamily={FF}>Share…</text>
			<circle cx="196" cy="81" r="8" fill={G200} />
		</svg>
	);
}

/** 2×2 home screen grid with the Wellbeing app highlighted. */
function IosHomeIcon() {
	return (
		<svg
			viewBox="0 0 240 106"
			width="100%"
			style={{ maxWidth: 280 }}
			role="img"
			aria-label="Home screen app grid with Wellbeing app highlighted in blue"
		>
			{/* Highlighted app (top-left) */}
			<rect x="75" y="8" width="40" height="40" rx="10" fill={BLUE} />
			<line x1="84" y1="21" x2="107" y2="21" stroke="white" strokeWidth="2" strokeLinecap="round" />
			<line x1="84" y1="28" x2="107" y2="28" stroke="white" strokeWidth="2" strokeLinecap="round" />
			<line x1="84" y1="35" x2="100" y2="35" stroke="white" strokeWidth="2" strokeLinecap="round" />
			<text x="95" y="56" textAnchor="middle" fontSize="10" fill={INK} fontWeight="600" fontFamily={FF}>
				Wellbeing
			</text>
			{/* Grey apps */}
			<rect x="125" y="8" width="40" height="40" rx="10" fill={G200} />
			<rect x="75" y="60" width="40" height="40" rx="10" fill={G200} />
			<rect x="125" y="60" width="40" height="40" rx="10" fill={G200} />
		</svg>
	);
}

/** Address bar with a highlighted icon at its left, and a Notifications toggle turned on. */
function SiteSettings() {
	return (
		<svg
			viewBox="0 0 240 92"
			width="100%"
			style={{ maxWidth: 280 }}
			role="img"
			aria-label="Browser address bar and Notifications permission toggle turned on"
		>
			{/* Address bar */}
			<rect x="8" y="6" width="224" height="28" rx="14" fill={G100} stroke={G200} strokeWidth="1" />
			{/* Highlighted icon at left */}
			<circle cx="26" cy="20" r="10" fill={BLUE} />
			<circle cx="26" cy="15" r="1.5" fill="white" />
			<line x1="26" y1="19" x2="26" y2="25" stroke="white" strokeWidth="2" strokeLinecap="round" />
			{/* URL placeholder */}
			<rect x="44" y="14" width="100" height="12" rx="6" fill={G200} />
			{/* Separator */}
			<line x1="8" y1="46" x2="232" y2="46" stroke={G200} strokeWidth="1" />
			{/* Notifications label */}
			<text x="16" y="68" fontSize="11" fill={INK} fontFamily={FF}>Notifications</text>
			{/* Toggle ON (pill in brand-blue, knob to the right) */}
			<rect x="186" y="56" width="38" height="20" rx="10" fill={BLUE} />
			<circle cx="213" cy="66" r="8" fill="white" />
		</svg>
	);
}

/** Browser top bar with three-dot menu highlighted and a dropdown showing "Add to Home screen". */
function AndroidMenu() {
	return (
		<svg
			viewBox="0 0 240 108"
			width="100%"
			style={{ maxWidth: 280 }}
			role="img"
			aria-label="Browser three-dot menu highlighted with Add to Home screen option"
		>
			<defs>
				<clipPath id="sv-amenu-clip">
					<rect x="130" y="40" width="104" height="64" rx="8" />
				</clipPath>
			</defs>
			{/* Browser bar */}
			<rect x="0" y="0" width="240" height="38" fill={G100} />
			<line x1="0" y1="38" x2="240" y2="38" stroke={G200} strokeWidth="1" />
			{/* Address bar */}
			<rect x="8" y="8" width="198" height="22" rx="11" fill="white" stroke={G200} strokeWidth="1" />
			<rect x="22" y="14" width="80" height="10" rx="5" fill={G200} />
			{/* Three vertical dots — highlighted */}
			<circle cx="222" cy="12" r="2.5" fill={BLUE} />
			<circle cx="222" cy="19" r="2.5" fill={BLUE} />
			<circle cx="222" cy="26" r="2.5" fill={BLUE} />
			{/* Dropdown card */}
			<rect x="130" y="40" width="104" height="64" rx="8" fill="white" stroke={G200} strokeWidth="1" />
			{/* Row 1 */}
			<text x="142" y="62" fontSize="9.5" fill={G400} fontFamily={FF}>New Tab</text>
			<line x1="130" y1="68" x2="234" y2="68" stroke={G100} strokeWidth="1" />
			{/* Row 2 — highlighted (last row, clipped to card's rounded corners) */}
			<g clipPath="url(#sv-amenu-clip)">
				<rect x="130" y="69" width="104" height="35" fill={BLUE_TINT} />
			</g>
			<text x="142" y="89" fontSize="9.5" fill={BLUE} fontWeight="600" fontFamily={FF}>
				Add to Home screen
			</text>
		</svg>
	);
}

/** Browser address bar with a permission popup dropping down from it. */
function DesktopPrompt() {
	return (
		<svg
			viewBox="0 0 240 108"
			width="100%"
			style={{ maxWidth: 280 }}
			role="img"
			aria-label="Browser permission popup with Allow button highlighted"
		>
			{/* Browser bar */}
			<rect x="0" y="0" width="240" height="34" fill={G100} />
			<line x1="0" y1="34" x2="240" y2="34" stroke={G200} strokeWidth="1" />
			{/* Address bar */}
			<rect x="28" y="7" width="182" height="20" rx="10" fill="white" stroke={G200} strokeWidth="1" />
			{/* Secure indicator at left of address bar */}
			<circle cx="42" cy="17" r="7" fill={G200} />
			{/* URL placeholder */}
			<rect x="56" y="12" width="88" height="10" rx="5" fill={G200} />
			{/* Popup arrow pointing up to address bar area */}
			<path d="M38 38 L42 32 L46 38" fill="white" stroke={G200} strokeWidth="1" />
			{/* Cover card top-border where arrow meets card */}
			<line x1="39" y1="38" x2="45" y2="38" stroke="white" strokeWidth="1.5" />
			{/* Popup card */}
			<rect x="6" y="38" width="168" height="66" rx="8" fill="white" stroke={G200} strokeWidth="1" />
			{/* Question text */}
			<text x="90" y="58" textAnchor="middle" fontSize="10.5" fill={INK} fontFamily={FF}>
				Allow notifications?
			</text>
			{/* Block button */}
			<rect x="14" y="68" width="62" height="24" rx="12" fill="white" stroke={G300} strokeWidth="1" />
			<text x="45" y="84" textAnchor="middle" fontSize="9.5" fill={MUTED} fontFamily={FF}>Block</text>
			{/* Allow button */}
			<rect x="86" y="68" width="62" height="24" rx="12" fill={BLUE} />
			<text x="117" y="84" textAnchor="middle" fontSize="9.5" fill="white" fontWeight="600" fontFamily={FF}>
				Allow
			</text>
		</svg>
	);
}

// ── Lookup ───────────────────────────────────────────────────────────────────

const VISUALS: Record<StepVisualKey, () => React.ReactElement> = {
	"allow-prompt": AllowPrompt,
	"ios-share": IosShare,
	"ios-add-to-home": IosAddToHome,
	"ios-home-icon": IosHomeIcon,
	"site-settings": SiteSettings,
	"android-menu": AndroidMenu,
	"desktop-prompt": DesktopPrompt,
};

// ── Export ───────────────────────────────────────────────────────────────────

export default function StepVisual({ visual }: { visual: StepVisualKey | undefined }) {
	if (!visual) return null;
	const Visual = VISUALS[visual];
	return (
		<div className="mt-3 flex justify-center rounded-xl bg-gray-50 p-3">
			<Visual />
		</div>
	);
}

// One date style for the whole site: Australian order with a short month name ("9 Oct 2026"),
// so dates can't be misread as US month/day whatever the viewer's browser locale is.
const LOCALE = "en-AU";
const TIME_ZONE = "Australia/Perth";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "9 Oct 2026", or "—" when there is no date. Bare YYYY-MM-DD dates are calendar dates, not instants. */
export function formatDate(iso: string | null | undefined): string {
	if (!iso) return "—";
	if (DATE_ONLY.test(iso)) {
		// Read as UTC midnight and shown in UTC, so the day never shifts with the viewer's timezone.
		return new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
	}
	return new Date(iso).toLocaleDateString(LOCALE, { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
}

/** "9 Oct 2026, 5:00 pm" in Perth time. */
export function formatDateTime(iso: string | null | undefined): string {
	if (!iso) return "—";
	return new Date(iso).toLocaleString(LOCALE, { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
}

/** "5:00 pm" for a wall-clock "HH:MM" value. */
export function formatClockTime(hhmm: string): string {
	const [h, m] = hhmm.split(":").map(Number);
	return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(LOCALE, { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
}

import { useEffect, useState } from "react";
import NextSession from "@/components/modules/NextSession";
import { listModules } from "@/lib/api";

type SessionModule = {
	id: number;
	week_number: number;
	unlock_at: string | null;
	is_unlocked: boolean;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Earliest module the server still reports as locked. */
export function findUpcomingModule<T extends SessionModule>(modules: T[]): T | undefined {
	return modules
		.filter((module) => !module.is_unlocked && module.unlock_at)
		.sort((a, b) => Date.parse(a.unlock_at!) - Date.parse(b.unlock_at!))[0];
}

// unlock_at is either a full timestamp or a date-only string (cohort-based unlocks).
// A date-only value has no time, so format it as a plain calendar date rather than
// letting new Date() treat it as UTC midnight (8:00 AM in Perth).
function unlockLabels(unlockAt: string) {
	if (DATE_ONLY.test(unlockAt)) {
		const dateLabel = new Date(`${unlockAt}T00:00:00Z`).toLocaleDateString("en-AU", {
			timeZone: "UTC",
			weekday: "short",
			month: "short",
			day: "numeric",
		});
		return { dateLabel, timeLabel: undefined };
	}
	const date = new Date(unlockAt);
	return {
		dateLabel: date.toLocaleDateString("en-AU", {
			timeZone: "Australia/Perth",
			weekday: "short",
			month: "short",
			day: "numeric",
		}),
		timeLabel: date.toLocaleTimeString("en-AU", {
			timeZone: "Australia/Perth",
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		}),
	};
}

/**
 * Next Session card for the next module that hasn't unlocked yet.
 * Pass `modules` when the page has already loaded them; otherwise the list is fetched.
 */
export default function UpcomingSession({ modules }: { modules?: SessionModule[] }) {
	const [fetched, setFetched] = useState<SessionModule[]>([]);

	useEffect(() => {
		if (modules) return;
		const token = localStorage.getItem("token");
		if (!token) return;

		let cancelled = false;
		listModules(token)
			.then((data) => { if (!cancelled) setFetched(data); })
			.catch((error) => console.error("Failed to load next session:", error));
		return () => { cancelled = true; };
	}, [modules]);

	const upcoming = findUpcomingModule(modules ?? fetched);
	if (!upcoming?.unlock_at) return null;

	return (
		<NextSession
			moduleTitle={`Module Week ${upcoming.week_number}`}
			startsAt={upcoming.unlock_at}
			{...unlockLabels(upcoming.unlock_at)}
		/>
	);
}

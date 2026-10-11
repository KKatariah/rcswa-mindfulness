import { useEffect, useState } from "react";
import Link from "next/link";
import NextSession from "@/components/modules/NextSession";
import { getToken, listModules, listProgress } from "@/lib/api";
import { weekLabel } from "@/lib/weeks";

type SessionModule = {
	id: number;
	week_number: number;
	title?: string;
	content_items?: { id: number }[];
	unlock_at: string | null;
	is_unlocked: boolean;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Earliest module the server still reports as locked. */
function findUpcomingModule<T extends SessionModule>(modules: T[]): T | undefined {
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

/** First open week the user hasn't finished, using the same rule as the Progress page. */
function findUnfinishedModule<T extends SessionModule>(modules: T[], completedItemIds: Set<number>): T | undefined {
	return modules
		.filter((module) => module.is_unlocked)
		.sort((a, b) => a.week_number - b.week_number)
		.find((module) => {
			const items = module.content_items ?? [];
			return items.length === 0 || !items.every((item) => completedItemIds.has(item.id));
		});
}

/**
 * Next Session card for the next module that hasn't unlocked yet. Once every
 * week is open (or the user has no cohort schedule), it points at the first
 * open week the user hasn't finished, so the card doesn't vanish from the rail.
 * Pass `modules` and `completedItemIds` when the page has already loaded them;
 * otherwise they are fetched.
 */
export default function UpcomingSession({
	modules,
	completedItemIds,
}: {
	modules?: SessionModule[];
	completedItemIds?: Set<number>;
}) {
	const [fetched, setFetched] = useState<SessionModule[]>([]);
	const [fetchedCompleted, setFetchedCompleted] = useState<Set<number> | null>(null);

	useEffect(() => {
		if (modules) return;
		if (!getToken()) return;

		let cancelled = false;
		listModules()
			.then((data) => { if (!cancelled) setFetched(data); })
			.catch((error) => console.error("Failed to load next session:", error));
		return () => { cancelled = true; };
	}, [modules]);

	useEffect(() => {
		if (completedItemIds) return;
		if (!getToken()) return;

		let cancelled = false;
		listProgress()
			.then((data) => { if (!cancelled) setFetchedCompleted(new Set(data.map((c) => c.content_item))); })
			.catch((error) => console.error("Failed to load progress for next session:", error));
		return () => { cancelled = true; };
	}, [completedItemIds]);

	const list = modules ?? fetched;
	const completed = completedItemIds ?? fetchedCompleted;
	const upcoming = findUpcomingModule(list);
	if (!upcoming?.unlock_at) {
		// Wait for progress so the card doesn't flash a week that's already done.
		if (!completed) return null;
		const unfinished = findUnfinishedModule(list, completed);
		if (!unfinished) {
			return list.some((module) => module.is_unlocked) ? (
				<div className="rounded-xl bg-white p-5 text-sm text-muted">You’ve completed all available modules.</div>
			) : null;
		}
		return (
			<Link href={`/modules/${unfinished.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-brand-blue-dark">
				<NextSession
					moduleTitle={unfinished.title ? `${weekLabel(unfinished.week_number)}: ${unfinished.title}` : weekLabel(unfinished.week_number)}
				/>
			</Link>
		);
	}

	return (
		<NextSession
			moduleTitle={upcoming.week_number === 0 ? weekLabel(0) : `Module ${weekLabel(upcoming.week_number)}`}
			startsAt={upcoming.unlock_at}
			{...unlockLabels(upcoming.unlock_at)}
		/>
	);
}

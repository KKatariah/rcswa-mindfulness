import Head from "next/head";
import Link from "next/link";
import AppShell from "@/components/main/AppShell";
import UpcomingSession from "@/components/modules/UpcomingSession";
import NotificationsPanel from "@/components/notifications/NotificationsPanel";
import Card from "@/components/ui/Card";
import { FullPageMessage } from "@/components/ui/feedback";
import PageHeader from "@/components/ui/PageHeader";
import StatusIcon, { type ProgressStatus } from "@/components/ui/StatusIcon";
import { useAsync } from "@/hooks/useAsync";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { listModules, listProgress, type ApiModule } from "@/lib/api";
import { weekLabel } from "@/lib/weeks";
import { pageTitle } from "@/lib/pageTitle";

type WeekRow = {
	module: ApiModule;
	completedItems: number;
	totalItems: number;
	status: ProgressStatus;
};

function buildWeekRows(modules: ApiModule[], completedItemIds: Set<number>): WeekRow[] {
	return modules.map((module) => {
		const totalItems = module.content_items.length;
		const completedItems = module.content_items.filter((item) => completedItemIds.has(item.id)).length;
		const isComplete = totalItems > 0 && completedItems === totalItems;

		// The server decides locking from the cohort start date (week N opens N-1 weeks in).
		const status: ProgressStatus = !module.is_unlocked ? "locked" : isComplete ? "completed" : "current";
		return { module, completedItems, totalItems, status };
	});
}

function percentOf(done: number, total: number) {
	return total === 0 ? 0 : Math.round((done / total) * 100);
}

function ProgressRing({ percent }: { percent: number }) {
	const size = 88;
	const stroke = 9;
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const offset = circumference * (1 - percent / 100);

	return (
		<div className="relative shrink-0" style={{ width: size, height: size }}>
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
				<circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="fill-none stroke-surface-muted" />
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					strokeWidth={stroke}
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={offset}
					className="fill-none stroke-brand-blue transition-[stroke-dashoffset] duration-500"
				/>
			</svg>
			<div className="absolute inset-0 flex flex-col items-center justify-center">
				<span className="text-2xs font-semibold uppercase tracking-wide text-muted">Overall</span>
				<span className="text-xl font-extrabold text-ink">{percent}%</span>
			</div>
		</div>
	);
}

function encouragement(percent: number) {
	if (percent >= 100) return "Amazing! You've completed the program!";
	if (percent === 0) return "Let's get started!";
	return "You're doing great! Keep going!";
}

export default function ModulesIndexPage() {
	const { user, isLoading: authLoading } = useRequireAuth();
	const { data, loading, error } = useAsync(
		async () => {
			const [modules, progress] = await Promise.all([listModules(), listProgress()]);
			return { modules, completedItemIds: new Set(progress.map((p) => p.content_item)) };
		},
		[user],
		{ modules: [] as ApiModule[], completedItemIds: new Set<number>() },
		{ enabled: !authLoading && !!user, errorFallback: "Failed to load modules" },
	);

	if (!authLoading && !user) {
		return (
			<FullPageMessage>
				Please <Link href="/" className="text-brand-blue underline">log in</Link> to view your progress.
			</FullPageMessage>
		);
	}

	const ready = !loading && !authLoading && !error;
	const rows = buildWeekRows(data.modules, data.completedItemIds);
	const completedWeeks = rows.filter((r) => r.status === "completed").length;
	const overallPercent = percentOf(
		rows.reduce((sum, r) => sum + r.completedItems, 0),
		rows.reduce((sum, r) => sum + r.totalItems, 0),
	);

	return (
		<>
			<Head>
				<title>{pageTitle("Your Progress")}</title>
			</Head>
			{/* The rail column is always reserved so the layout doesn't jump once data arrives. */}
			<AppShell
				rightRail={
					<div className="space-y-4">
						{ready && <UpcomingSession modules={data.modules} completedItemIds={data.completedItemIds} />}
						<NotificationsPanel />
					</div>
				}
			>
				<div className="flex min-w-0 flex-col gap-4">
					<PageHeader title="Your Progress" description="Track your 8-week meditation journey" />

					{(loading || authLoading) && !error && (
						<Card className="p-8 text-center">
							<p className="text-ink-soft">Loading modules…</p>
						</Card>
					)}
					{error && (
						<Card className="p-8 text-center">
							<p className="text-ink-soft">{error}</p>
						</Card>
					)}

					{ready && (
						<>
							<Card className="flex items-center gap-6 p-6 sm:p-8">
								<ProgressRing percent={overallPercent} />
								<div>
									<h2 className="font-bold text-ink">Overall Progress</h2>
									<p className="text-sm text-ink-soft">{completedWeeks} of {rows.length} Weeks Completed</p>
									<p className="mt-1 text-sm text-muted">{encouragement(overallPercent)}</p>
								</div>
							</Card>

							<Card as="ul" className="overflow-hidden">
								{rows.map(({ module: m, status, completedItems, totalItems }, idx) => {
									const isLocked = status === "locked";
									const content = (
										<div className={`flex items-center gap-4 px-6 py-4 ${idx !== 0 ? "border-t border-gray-100" : ""}`}>
											<StatusIcon status={status} />
											<span className={`flex-1 font-semibold ${isLocked ? "text-gray-400" : "text-ink"}`}>
												{weekLabel(m.week_number)}
											</span>
											{!isLocked && (
												<div className="h-2 w-40 max-w-[40%] overflow-hidden rounded-full bg-surface-muted">
													<div
														className="h-full rounded-full bg-brand-blue"
														style={{ width: `${percentOf(completedItems, totalItems)}%` }}
													/>
												</div>
											)}
										</div>
									);

									return (
										<li key={m.id}>
											{isLocked ? (
												<div className="cursor-not-allowed" aria-disabled="true">{content}</div>
											) : (
												<Link href={`/modules/${m.id}`} className="block hover:bg-surface-muted">
													{content}
												</Link>
											)}
										</li>
									);
								})}
							</Card>
						</>
					)}
				</div>
			</AppShell>

		</>
	);
}

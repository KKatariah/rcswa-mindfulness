import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import Navbar from "@/components/main/Navbar";
import Footer from "@/components/main/Footer";
import Sidebar from "@/components/main/Sidebar";
import UpcomingSession from "@/components/modules/UpcomingSession";
import NotificationsPanel from "@/components/notifications/NotificationsPanel";
import { CheckIcon, LockIcon, PlayIcon } from "@/components/ui/icons";
import { useAuth } from "@/context/AuthContext";
import { listModules, listProgress, type ApiModule } from "@/lib/api";
import { weekLabel } from "@/lib/weeks";

type WeekStatus = "completed" | "current" | "locked";

type WeekRow = {
	module: ApiModule;
	completedItems: number;
	totalItems: number;
	status: WeekStatus;
};

function buildWeekRows(modules: ApiModule[], completedItemIds: Set<number>): WeekRow[] {
	return modules.map((module) => {
		const totalItems = module.content_items.length;
		const completedItems = module.content_items.filter((item) => completedItemIds.has(item.id)).length;
		const isComplete = totalItems > 0 && completedItems === totalItems;

		// The server decides locking from the cohort start date (week N opens N-1 weeks in).
		const status: WeekStatus = !module.is_unlocked ? "locked" : isComplete ? "completed" : "current";
		return { module, completedItems, totalItems, status };
	});
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
				<span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Overall</span>
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
	const router = useRouter();
	const { user, isLoading: authLoading } = useAuth();
	const [modules, setModules] = useState<ApiModule[]>([]);

	useEffect(() => {
		if (!authLoading && !user) {
			router.replace("/");
		}
	}, [authLoading, user, router]);
	const [completedItemIds, setCompletedItemIds] = useState<Set<number>>(new Set());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (authLoading) return;

		let cancelled = false;

		(async () => {
			if (!user) {
				if (!cancelled) setLoading(false);
				return;
			}

			const token = localStorage.getItem("token") ?? "";
			try {
				const [modulesData, progressData] = await Promise.all([listModules(token), listProgress(token)]);
				if (cancelled) return;
				setModules(modulesData);
				setCompletedItemIds(new Set(progressData.map((p) => p.content_item)));
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load modules");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => { cancelled = true; };
	}, [user, authLoading]);

	if (!authLoading && !user) {
		return (
			<div className="flex min-h-screen items-center justify-center p-6">
				<p className="text-ink-soft">
					Please <Link href="/" className="text-brand-blue underline">log in</Link> to view your progress.
				</p>
			</div>
		);
	}

	const rows = buildWeekRows(modules, completedItemIds);
	const completedWeeks = rows.filter((r) => r.status === "completed").length;
	const totalItemsAll = rows.reduce((sum, r) => sum + r.totalItems, 0);
	const completedItemsAll = rows.reduce((sum, r) => sum + r.completedItems, 0);
	const overallPercent = totalItemsAll === 0 ? 0 : Math.round((completedItemsAll / totalItemsAll) * 100);

	return (
		<>
			<Head>
				<title>Progress</title>
			</Head>
			<div
				className="bg-cover bg-center bg-fixed bg-no-repeat"
				style={{ backgroundImage: "url(/images/module-background.jpg)" }}
			>
				<div className="sticky top-0 z-30 h-20 bg-black/30 backdrop-blur-md lg:h-24">
					<Navbar />
				</div>

				<div className="mx-auto grid max-w-[1920px] items-start gap-6 p-4 md:grid-cols-[240px_minmax(0,1fr)] lg:p-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
					<Sidebar responsive />

					<div className="flex min-w-0 flex-col gap-4">
							<div className="rounded-[10px] border border-gray-200 bg-white p-6 shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
								<h1 className="text-2xl font-extrabold text-ink sm:text-3xl">Your Progress</h1>
								<p className="mt-1 text-sm text-muted sm:text-base">Track your 8-week meditation journey</p>
							</div>

							{(loading || authLoading) && (
								<div className="rounded-[10px] border border-gray-200 bg-white p-8 text-center shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
									<p className="text-ink-soft">Loading modules…</p>
								</div>
							)}
							{error && (
								<div className="rounded-[10px] border border-gray-200 bg-white p-8 text-center shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
									<p className="text-ink-soft">{error}</p>
								</div>
							)}

							{!loading && !authLoading && !error && (
								<>
									<div className="flex items-center gap-6 rounded-[10px] border border-gray-200 bg-white p-6 shadow-[0_6px_9px_rgba(0,0,0,0.05)] sm:p-8">
										<ProgressRing percent={overallPercent} />
										<div>
											<h2 className="font-bold text-ink">Overall Progress</h2>
											<p className="text-sm text-ink-soft">{completedWeeks} of {rows.length} Weeks Completed</p>
											<p className="mt-1 text-sm text-muted">{encouragement(overallPercent)}</p>
										</div>
									</div>

									<ul className="overflow-hidden rounded-[10px] border border-gray-200 bg-white shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
										{rows.map((row, idx) => {
											const { module: m, status, completedItems, totalItems } = row;
											const percent = totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 100);
											const isLocked = status === "locked";

											const icon = status === "completed"
												? <CheckIcon className="size-4" />
												: status === "current"
													? <PlayIcon className="size-4" />
													: <LockIcon className="size-4" />;

											const content = (
												<div className={`flex items-center gap-4 px-6 py-4 ${idx !== 0 ? "border-t border-gray-100" : ""}`}>
													<span
												className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
													status === "completed"
														? "bg-brand-blue text-white"
														: status === "current"
															? "border-2 border-brand-blue bg-gray-100 text-brand-blue"
															: "bg-gray-100 text-gray-400"
												}`}
											>
														{icon}
													</span>
													<span className={`flex-1 text-sm font-semibold sm:text-base ${isLocked ? "text-gray-400" : "text-ink"}`}>
														{weekLabel(m.week_number)}
													</span>
													{!isLocked && (
														<div className="h-2 w-40 max-w-[40%] overflow-hidden rounded-full bg-surface-muted">
															<div className="h-full rounded-full bg-brand-blue" style={{ width: `${percent}%` }} />
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
									</ul>
								</>
							)}
						</div>

						<div className="min-w-0 space-y-4 md:col-start-2 xl:col-start-3 md:sticky md:top-20 lg:top-24 xl:-mx-2 xl:max-h-[calc(100dvh-7.5rem)] xl:overflow-y-auto xl:overscroll-contain xl:px-2 xl:pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
							{!loading && !authLoading && !error && <UpcomingSession modules={modules} completedItemIds={completedItemIds} />}
							<NotificationsPanel />
						</div>
					</div>
				</div>

				<Footer />
			</>
	);
}

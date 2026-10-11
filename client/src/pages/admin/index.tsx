import type { ReactNode } from "react";
import Head from "next/head";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import SurveyExport from "@/components/admin/SurveyExport";
import Card from "@/components/ui/Card";
import { LoadingState } from "@/components/ui/feedback";
import { useAsync } from "@/hooks/useAsync";
import { getDashboardStats } from "@/lib/api";
import { weekLabel } from "@/lib/weeks";
import type { DashboardStats } from "@/types/admin";
import { adminPageTitle } from "@/lib/pageTitle";
import { ChevronRightIcon } from "@/components/ui/icons";

function StatCard({ label, value }: { label: string; value: string | number }) {
	return (
		<Card className="p-5">
			<p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
			<p className="mt-2 text-2xl font-extrabold text-ink">{value}</p>
		</Card>
	);
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<Card className="p-5">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-sm font-bold uppercase tracking-wide text-muted">{title}</h2>
				{hint && <span className="text-xs text-muted">{hint}</span>}
			</div>
			{children}
		</Card>
	);
}

function ProgressBar({ label, pct, detail, href }: { label: string; pct: number; detail: string; href?: string }) {
	return (
		<div>
			<div className="flex items-center justify-between gap-3 text-sm">
				{href ? (
					<Link href={href} className="min-w-0 wrap-anywhere font-semibold text-ink hover:text-brand-blue hover:underline">
						{label}
					</Link>
				) : (
					<span className="min-w-0 wrap-anywhere font-semibold text-ink">{label}</span>
				)}
				<span className="flex shrink-0 items-center gap-1 text-muted">
					{detail}
					{/* Shows the row opens something, matching the hint above the list. */}
					{href && <ChevronRightIcon className="size-4" aria-hidden="true" />}
				</span>
			</div>
			<div className="mt-1.5 h-2 rounded-full bg-gray-200">
				<div className="h-2 rounded-full bg-brand-blue" style={{ width: `${Math.min(100, pct)}%` }} />
			</div>
		</div>
	);
}

export default function AdminDashboardPage() {
	const { data: stats, loading, error } = useAsync(getDashboardStats, [], null as DashboardStats | null, {
		errorFallback: "Failed to load dashboard",
	});

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle("Dashboard")}</title>
			</Head>

			<AdminPageHeader title="Dashboard" />

			{loading ? (
				<LoadingState />
			) : error ? (
				<p className="mt-6 text-sm text-red-600">{error}</p>
			) : stats ? (
				<div className="mt-6 flex flex-col gap-6">
					{/* Every sign-up whatever its status, the same count as the cohort table's Total column
					    (total_enrolled from the API is active enrolments only, which the Active card shows). */}
					<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
						<StatCard
							label="Total sign-ups"
							value={Object.values(stats.enrollment_status_breakdown).reduce((sum, n) => sum + n, 0)}
						/>
						<StatCard label="Pending approval" value={stats.enrollment_status_breakdown.pending ?? 0} />
						<StatCard label="Active" value={stats.enrollment_status_breakdown.active ?? 0} />
						<StatCard label="Completed" value={stats.enrollment_status_breakdown.completed ?? 0} />
					</div>

					<Section title="Module completion" hint="Select a module to see which students have finished it">
						<div className="mt-4 space-y-4">
							{stats.modules.length === 0 ? (
								<p className="text-sm text-muted">No published modules yet.</p>
							) : (
								stats.modules.map((m) => (
									<ProgressBar
										key={m.id}
										label={`${weekLabel(m.week_number)}: ${m.title}`}
										href={`/admin/modules/${m.id}#progress`}
										pct={m.completion_pct}
										detail={`${m.completed_count}/${m.eligible_count} (${m.completion_pct}%)`}
									/>
								))
							)}
						</div>
					</Section>

					<Section title="Cohorts">
						<div role="region" aria-label="Cohorts table" tabIndex={0} className="mt-4 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">
							<table className="w-full text-left text-sm">
								<thead>
									<tr className="text-xs font-semibold uppercase tracking-wide text-muted">
										<th className="py-2 pr-4">Cohort</th>
										<th className="py-2 pr-4">Total</th>
										<th className="py-2 pr-4">Pending</th>
										<th className="py-2 pr-4">Active</th>
										<th className="py-2 pr-4">Completed</th>
										<th className="py-2 pr-4">Withdrawn</th>
									</tr>
								</thead>
								<tbody>
									{stats.by_cohort.map((c) => (
										<tr key={c.cohort_id} className="border-t border-gray-100">
											<td className="py-2 pr-4 font-semibold text-ink">{c.cohort_name}</td>
											<td className="py-2 pr-4 text-ink-soft">{c.enrolled}</td>
											<td className="py-2 pr-4 text-ink-soft">{c.pending}</td>
											<td className="py-2 pr-4 text-ink-soft">{c.active}</td>
											<td className="py-2 pr-4 text-ink-soft">{c.completed}</td>
											<td className="py-2 pr-4 text-ink-soft">{c.withdrawn}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</Section>

					<Section title="Survey response rates">
						<div className="mt-4 space-y-4">
							{stats.survey_response_rates.length === 0 ? (
								<p className="text-sm text-muted">No surveys yet.</p>
							) : (
								stats.survey_response_rates.map((s) => (
									<ProgressBar
										key={s.survey_id}
										label={s.title}
										pct={s.response_pct}
										detail={`${s.response_count}/${s.eligible_count} (${s.response_pct}%)`}
									/>
								))
							)}
						</div>
						<div className="mt-5 border-t border-gray-100 pt-5">
							<SurveyExport
								surveys={stats.survey_response_rates.map((s) => ({ id: s.survey_id, title: s.title }))}
							/>
						</div>
					</Section>

					<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
						<StatCard label="Forum threads" value={stats.forum_activity.thread_count} />
						<StatCard label="Forum posts" value={stats.forum_activity.post_count} />
						<StatCard label="Active participants" value={stats.forum_activity.active_participants} />
						<Link href="/admin/moderation" className="rounded-xl focus-visible:outline-2 focus-visible:outline-brand-blue">
							<StatCard label="Reported posts" value={stats.forum_activity.reported_post_count} />
						</Link>
					</div>
				</div>
			) : null}
		</AdminLayout>
	);
}

import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import SurveyExport from "@/components/admin/SurveyExport";
import { getDashboardStats } from "@/lib/api";
import type { DashboardStats } from "@/types/admin";

function StatCard({ label, value }: { label: string; value: string | number }) {
	return (
		<div className="rounded-2xl border border-gray-200 bg-white p-5">
			<p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
			<p className="mt-2 text-2xl font-extrabold text-ink">{value}</p>
		</div>
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
				<span className="shrink-0 text-muted">{detail}</span>
			</div>
			<div className="mt-1.5 h-2 rounded-full bg-gray-200">
				<div className="h-2 rounded-full bg-brand-blue" style={{ width: `${Math.min(100, pct)}%` }} />
			</div>
		</div>
	);
}

export default function AdminDashboardPage() {
	const [stats, setStats] = useState<DashboardStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const data = await getDashboardStats(token);
				if (!cancelled) setStats(data);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load dashboard");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, []);

	return (
		<AdminLayout>
			<Head>
				<title>Dashboard — Admin</title>
			</Head>

			<h1 className="text-2xl font-extrabold text-ink">Dashboard</h1>

			{loading ? (
				<div className="flex justify-center py-16">
					<span className="text-sm text-muted">Loading…</span>
				</div>
			) : error ? (
				<p className="mt-6 text-sm text-red-600">{error}</p>
			) : stats ? (
				<div className="mt-6 flex flex-col gap-6">
					<div className="grid gap-4 sm:grid-cols-4">
						<StatCard label="Total enrolled" value={stats.total_enrolled} />
						<StatCard label="Pending approval" value={stats.enrollment_status_breakdown.pending ?? 0} />
						<StatCard label="Active" value={stats.enrollment_status_breakdown.active ?? 0} />
						<StatCard label="Completed" value={stats.enrollment_status_breakdown.completed ?? 0} />
					</div>

					<div className="rounded-2xl border border-gray-200 bg-white p-5">
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<h2 className="text-sm font-bold uppercase tracking-wide text-muted">Module completion</h2>
							<span className="text-xs text-muted">Select a module to see which students have finished it</span>
						</div>
						<div className="mt-4 space-y-4">
							{stats.modules.length === 0 ? (
								<p className="text-sm text-muted">No published modules yet.</p>
							) : (
								stats.modules.map((m) => (
									<ProgressBar
										key={m.id}
										label={`Week ${m.week_number}: ${m.title}`}
										pct={m.completion_pct}
										detail={`${m.completed_count}/${m.eligible_count} (${m.completion_pct}%)`}
										href={`/admin/modules/${m.id}#progress`}
									/>
								))
							)}
						</div>
					</div>

					<div className="rounded-2xl border border-gray-200 bg-white p-5">
						<h2 className="text-sm font-bold uppercase tracking-wide text-muted">Cohorts</h2>
						<div className="mt-4 overflow-x-auto">
							<table className="w-full text-left text-sm">
								<thead>
									<tr className="text-xs font-semibold uppercase tracking-wide text-muted">
										<th className="py-2 pr-4">Cohort</th>
										<th className="py-2 pr-4">Enrolled</th>
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
					</div>

					<div className="rounded-2xl border border-gray-200 bg-white p-5">
						<h2 className="text-sm font-bold uppercase tracking-wide text-muted">Survey response rates</h2>
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
					</div>

					<div className="grid gap-4 sm:grid-cols-3">
						<StatCard label="Forum threads" value={stats.forum_activity.thread_count} />
						<StatCard label="Forum posts" value={stats.forum_activity.post_count} />
						<StatCard label="Active participants" value={stats.forum_activity.active_participants} />
					</div>
				</div>
			) : null}
		</AdminLayout>
	);
}

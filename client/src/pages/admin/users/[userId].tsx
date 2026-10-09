import { useEffect, useState, type ReactNode } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import AdminLayout from "@/components/admin/AdminLayout";
import { EnrollmentStatusBadge, ProgressStatusBadge, RoleBadge } from "@/components/admin/Badges";
import EditUserModal from "@/components/admin/EditUserModal";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { CheckIcon, ChevronLeftIcon, PencilIcon } from "@/components/ui/icons";
import { getUserOverview, listCohorts } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { SURVEY_TYPE_LABELS } from "@/lib/surveys";
import type { Cohort, UserOverview } from "@/types/admin";
import { adminPageTitle } from "@/lib/pageTitle";

function formatDate(iso: string | null) {
	if (!iso) return "—";
	// A bare YYYY-MM-DD would otherwise be read as UTC midnight and can show as the previous day.
	return new Date(iso.length === 10 ? `${iso}T00:00` : iso).toLocaleDateString();
}

function formatTime(hhmm: string) {
	const [h, m] = hhmm.split(":").map(Number);
	return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="rounded-2xl border border-gray-200 bg-white p-5">
			<h2 className="text-sm font-bold uppercase tracking-wide text-muted">{title}</h2>
			<div className="mt-4">{children}</div>
		</section>
	);
}

function StatCard({ label, value }: { label: string; value: string | number }) {
	return (
		<div className="rounded-2xl border border-gray-200 bg-white p-5">
			<p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
			<p className="mt-2 text-2xl font-extrabold text-ink">{value}</p>
		</div>
	);
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
	return (
		<>
			<dt className="text-muted">{label}</dt>
			<dd className="text-ink-soft">{children}</dd>
		</>
	);
}

function YesNo({ value }: { value: boolean }) {
	return value ? <span className="text-green-700">On</span> : <span className="text-muted">Off</span>;
}

export default function AdminUserProfilePage() {
	const router = useRouter();
	const userId = router.query.userId;
	const [data, setData] = useState<UserOverview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [cohorts, setCohorts] = useState<Cohort[]>([]);
	const [editing, setEditing] = useState(false);

	useEffect(() => {
		if (!userId || Array.isArray(userId)) return;
		let cancelled = false;
		(async () => {
			try {
				const [overview, cohortList] = await Promise.all([getUserOverview(Number(userId)), listCohorts()]);
				if (!cancelled) {
					setData(overview);
					setCohorts(cohortList);
				}
			} catch (e) {
				if (!cancelled) setError(errorMessage(e, "Failed to load user"));
			}
		})();
		return () => { cancelled = true; };
	}, [userId]);

	const backLink = (
		<Link href="/admin/users" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-brand-blue">
			<ChevronLeftIcon className="size-4" /> Users
		</Link>
	);

	if (error || !data) {
		return (
			<AdminLayout>
				{backLink}
				{error ? (
					<p className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-red-600">{error}</p>
				) : (
					<div className="mt-6 flex justify-center py-16">
						<span className="text-sm text-muted">Loading…</span>
					</div>
				)}
			</AdminLayout>
		);
	}

	// A role or cohort change affects most of the page (unlock dates, progress), so reload all of it.
	async function handleSaved() {
		setEditing(false);
		try {
			setData(await getUserOverview(data!.user.id));
		} catch (e) {
			setError(errorMessage(e, "Failed to reload user"));
		}
	}

	const { user, enrollments, modules, surveys, forum, notifications } = data;
	const name = user.full_name || user.display_name || user.email;
	const current = enrollments[0];
	const completedModules = modules.filter((m) => m.status === "completed").length;
	const submittedSurveys = surveys.filter((s) => s.submitted_at).length;

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle(name)}</title>
			</Head>

			{backLink}

			<div className="mt-4 flex flex-col gap-6">
				<div className="flex flex-col gap-5 rounded-2xl border border-gray-200 bg-white p-5 sm:flex-row sm:items-start">
					<UserAvatar avatarUrl={user.avatar_url} fullName={name} size={72} className="shrink-0" />
					<button
						type="button"
						onClick={() => setEditing(true)}
						className="order-last inline-flex h-10 shrink-0 items-center gap-1.5 self-start rounded-xl border border-gray-200 px-4 text-sm font-semibold text-ink hover:border-brand-blue hover:text-brand-blue"
					>
						<PencilIcon className="size-4" /> Edit
					</button>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="wrap-anywhere text-2xl font-extrabold text-ink">{name}</h1>
							<RoleBadge role={user.role} />
							{current && <EnrollmentStatusBadge status={current.status} />}
						</div>
						<a href={`mailto:${user.email}`} className="wrap-anywhere text-sm text-ink-soft hover:text-brand-blue hover:underline">
							{user.email}
						</a>
						<dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
							<Detail label="Display name">{user.display_name || "—"}</Detail>
							<Detail label="Cohort">{current ? current.cohort_name : "Not enrolled"}</Detail>
							<Detail label="Joined">{formatDate(user.created_at)}</Detail>
							<Detail label="Signs in with">{user.auth_provider === "google" ? "Google" : "Email & password"}</Detail>
							<Detail label="Forum rules">
								{user.forum_rules_accepted_at ? `Accepted ${formatDate(user.forum_rules_accepted_at)}` : "Not accepted"}
							</Detail>
						</dl>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
					<StatCard label="Modules completed" value={`${completedModules}/${modules.length}`} />
					<StatCard label="Surveys submitted" value={`${submittedSurveys}/${surveys.length}`} />
					<StatCard label="Forum threads" value={forum.thread_count} />
					<StatCard label="Forum replies" value={forum.post_count} />
				</div>

				<Section title="Module progress">
					{modules.length === 0 ? (
						<p className="text-sm text-muted">No published modules yet.</p>
					) : (
						<>
						{/* Mobile: one row per module */}
						<ul className="divide-y divide-gray-100 text-sm md:hidden">
							{modules.map((m) => (
								<li key={m.id} className="py-2.5">
									<div className="flex items-start justify-between gap-3">
										<Link href={`/admin/modules/${m.id}#progress`} className="min-w-0 font-semibold text-ink hover:text-brand-blue hover:underline">
											Week {m.week_number}: {m.title}
										</Link>
										<ProgressStatusBadge status={m.status} />
									</div>
									<p className="mt-1 text-xs text-muted">
										{m.completed_count}/{m.item_count} items
										{m.survey_submitted !== null && ` · survey ${m.survey_submitted ? "submitted" : "not submitted"}`}
										{m.status === "locked" && m.unlock_date && ` · unlocks ${formatDate(m.unlock_date)}`}
									</p>
								</li>
							))}
						</ul>

						{/* Desktop: table */}
						<div className="-mx-5 hidden overflow-x-auto md:block">
							<table className="w-full text-left text-sm">
								<thead>
									<tr className="text-xs font-semibold uppercase tracking-wide text-muted">
										<th className="px-5 py-2">Module</th>
										<th className="px-5 py-2">Status</th>
										<th className="px-5 py-2">Content</th>
										<th className="px-5 py-2">Survey</th>
										<th className="px-5 py-2">Last activity</th>
									</tr>
								</thead>
								<tbody>
									{modules.map((m) => (
										<tr key={m.id} className="border-t border-gray-100">
											<td className="px-5 py-2.5">
												<Link href={`/admin/modules/${m.id}#progress`} className="font-semibold text-ink hover:text-brand-blue hover:underline">
													Week {m.week_number}: {m.title}
												</Link>
											</td>
											<td className="px-5 py-2.5"><ProgressStatusBadge status={m.status} /></td>
											<td className="px-5 py-2.5 text-ink-soft">{m.completed_count}/{m.item_count}</td>
											<td className="px-5 py-2.5">
												{m.survey_submitted === null ? (
													<span className="text-muted">—</span>
												) : m.survey_submitted ? (
													<span className="inline-flex items-center gap-1 text-green-700"><CheckIcon className="size-4" /> Submitted</span>
												) : (
													<span className="text-muted">Not submitted</span>
												)}
											</td>
											<td className="px-5 py-2.5 text-ink-soft">
												{m.status === "locked"
													? m.unlock_date ? `Unlocks ${formatDate(m.unlock_date)}` : "No active cohort"
													: formatDate(m.last_activity)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						</>
					)}
				</Section>

				<div className="grid gap-6 lg:grid-cols-2">
					<Section title="Surveys">
						{surveys.length === 0 ? (
							<p className="text-sm text-muted">No surveys yet.</p>
						) : (
							<ul className="divide-y divide-gray-100 text-sm">
								{surveys.map((s) => (
									<li key={s.id} className="flex items-center justify-between gap-3 py-2">
										<Link href={`/admin/surveys/${s.id}`} className="min-w-0 hover:text-brand-blue hover:underline">
											<span className="font-semibold text-ink">{s.title}</span>{" "}
											<span className="text-xs text-muted">{SURVEY_TYPE_LABELS[s.type]}</span>
										</Link>
										{s.submitted_at ? (
											<span className="shrink-0 text-green-700">Submitted {formatDate(s.submitted_at)}</span>
										) : (
											<span className="shrink-0 text-muted">Not submitted</span>
										)}
									</li>
								))}
							</ul>
						)}
					</Section>

					<Section title="Enrollment history">
						{enrollments.length === 0 ? (
							<p className="text-sm text-muted">Never enrolled in a cohort.</p>
						) : (
							<ul className="divide-y divide-gray-100 text-sm">
								{enrollments.map((e) => (
									<li key={e.id} className="flex items-center justify-between gap-3 py-2">
										<div className="min-w-0">
											<p className="font-semibold text-ink">{e.cohort_name}</p>
											<p className="text-xs text-muted">
												{formatDate(e.cohort_start_date)} – {formatDate(e.cohort_end_date)} · signed up {formatDate(e.enrolled_at)}
											</p>
										</div>
										<EnrollmentStatusBadge status={e.status} />
									</li>
								))}
							</ul>
						)}
					</Section>

					<Section title="Recent forum posts">
						{forum.recent_posts.length === 0 ? (
							<p className="text-sm text-muted">No forum posts yet.</p>
						) : (
							<ul className="divide-y divide-gray-100 text-sm">
								{forum.recent_posts.map((p) => (
									<li key={p.id} className="py-2">
										<p className="text-xs text-muted">
											{p.is_head_post ? "Started" : "Replied in"} <span className="font-semibold text-ink-soft">{p.thread_title}</span> · {formatDate(p.created_at)}
										</p>
										<p className="mt-1 line-clamp-2 wrap-anywhere text-ink-soft">{p.body}</p>
									</li>
								))}
							</ul>
						)}
					</Section>

					<Section title="Notifications">
						<dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
							<Detail label="Reminder time">{formatTime(notifications.reminder_time)}</Detail>
							<Detail label="Daily meditation reminder"><YesNo value={notifications.daily_content_reminder} /></Detail>
							<Detail label="Daily survey reminder"><YesNo value={notifications.daily_survey_reminder} /></Detail>
							<Detail label="Push notifications">
								{notifications.push_denied
									? "Blocked"
									: notifications.push_devices === 0
										? "Not set up"
										: `${notifications.push_devices} device${notifications.push_devices === 1 ? "" : "s"}`}
							</Detail>
						</dl>
					</Section>
				</div>
			</div>

			<EditUserModal
				user={editing ? user : null}
				enrollment={current ? { id: current.id, cohort: current.cohort_id } : null}
				cohorts={cohorts}
				onClose={() => setEditing(false)}
				onSaved={handleSaved}
			/>
		</AdminLayout>
	);
}

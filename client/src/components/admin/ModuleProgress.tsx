import { useEffect, useMemo, useState } from "react";
import Select from "@/components/ui/Select";
import { CheckIcon } from "@/components/ui/icons";
import { getModuleProgress } from "@/lib/api";
import type { AdminContentItem, ModuleProgress as Progress, ModuleProgressStatus, ModuleStudentProgress } from "@/types/admin";

const STATUS_LABELS: Record<ModuleProgressStatus, string> = {
	completed: "Completed",
	in_progress: "In progress",
	not_started: "Not started",
	locked: "Not unlocked yet",
};

const STATUS_STYLES: Record<ModuleProgressStatus, string> = {
	completed: "bg-green-100 text-green-700",
	in_progress: "bg-amber-100 text-amber-700",
	not_started: "bg-red-100 text-red-700",
	locked: "bg-gray-100 text-gray-600",
};

const STATUS_ORDER: ModuleProgressStatus[] = ["completed", "in_progress", "not_started", "locked"];

function StatusBadge({ status }: { status: ModuleProgressStatus }) {
	return (
		<span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}>
			{STATUS_LABELS[status]}
		</span>
	);
}

// One dot per content item, filled when the student has completed it.
function ItemDots({ items, student }: { items: AdminContentItem[]; student: ModuleStudentProgress }) {
	const done = new Set(student.completed_item_ids);
	return (
		<div className="flex items-center gap-2">
			<div className="flex gap-1">
				{items.map((item) => (
					<span
						key={item.id}
						title={`${item.title}: ${done.has(item.id) ? "completed" : "not completed"}`}
						className={`size-2.5 rounded-full ${done.has(item.id) ? "bg-green-500" : "bg-gray-200"}`}
					/>
				))}
			</div>
			<span className="text-xs text-muted">
				{student.completed_item_ids.length}/{items.length}
			</span>
		</div>
	);
}

function SurveyCell({ submitted }: { submitted: boolean | null }) {
	if (submitted === null) return <span className="text-muted">—</span>;
	return submitted ? (
		<span className="inline-flex items-center gap-1 text-green-700">
			<CheckIcon className="size-4" /> Submitted
		</span>
	) : (
		<span className="text-muted">Not submitted</span>
	);
}

function formatDate(iso: string | null) {
	if (!iso) return "—";
	// A bare YYYY-MM-DD would otherwise be read as UTC midnight and can show as the previous day.
	return new Date(iso.length === 10 ? `${iso}T00:00` : iso).toLocaleDateString();
}

export default function ModuleProgress({ moduleId, items }: { moduleId: number; items: AdminContentItem[] }) {
	const [progress, setProgress] = useState<Progress | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [statusFilter, setStatusFilter] = useState<ModuleProgressStatus | "">("");
	const [cohortFilter, setCohortFilter] = useState("");
	const [search, setSearch] = useState("");
	const [copied, setCopied] = useState(false);

	// The dashboard links to #progress, but this section mounts after the module loads, too late for the browser's own jump.
	useEffect(() => {
		if (window.location.hash === "#progress") document.getElementById("progress")?.scrollIntoView();
	}, []);

	// Refetch when items change, since adding or removing one changes who has completed the module.
	const itemKey = items.map((i) => i.id).join();
	useEffect(() => {
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const data = await getModuleProgress(moduleId, token);
				if (!cancelled) {
					setProgress(data);
					setError(null);
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load student progress");
			}
		})();
		return () => { cancelled = true; };
	}, [moduleId, itemKey]);

	const cohorts = useMemo(() => {
		const map = new Map<number, string>();
		for (const s of progress?.students ?? []) map.set(s.cohort_id, s.cohort_name);
		return [...map].map(([id, name]) => ({ value: String(id), label: name }));
	}, [progress]);

	// Counts respect the cohort and search filters, so the status tabs always add up to what's listed under "All".
	const inScope = useMemo(() => {
		const q = search.trim().toLowerCase();
		return (progress?.students ?? []).filter((s) => {
			if (cohortFilter && String(s.cohort_id) !== cohortFilter) return false;
			if (q && !s.full_name.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q)) return false;
			return true;
		});
	}, [progress, cohortFilter, search]);

	const counts = useMemo(() => {
		const c: Record<ModuleProgressStatus, number> = { completed: 0, in_progress: 0, not_started: 0, locked: 0 };
		for (const s of inScope) c[s.status]++;
		return c;
	}, [inScope]);

	const shown = statusFilter ? inScope.filter((s) => s.status === statusFilter) : inScope;

	async function copyEmails() {
		try {
			await navigator.clipboard.writeText(shown.map((s) => s.email).join(", "));
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setError("Couldn't copy to the clipboard.");
		}
	}

	return (
		<section id="progress" className="mt-8">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-lg font-extrabold text-ink">Student progress</h2>
				<p className="text-xs text-muted">Active students only. A module is completed once every content item is.</p>
			</div>

			{error && (
				<p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600" role="alert">
					{error}
				</p>
			)}

			{!progress ? (
				!error && (
					<div className="mt-4 flex justify-center rounded-2xl border border-gray-200 bg-white py-10">
						<span className="text-sm text-muted">Loading…</span>
					</div>
				)
			) : progress.students.length === 0 ? (
				<p className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-muted">
					No active students yet.
				</p>
			) : (
				<>
					<div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by progress">
						{([["", "All", inScope.length], ...STATUS_ORDER.map((s) => [s, STATUS_LABELS[s], counts[s]])] as [ModuleProgressStatus | "", string, number][]).map(
							([value, label, count]) => (
								<button
									key={value || "all"}
									type="button"
									aria-pressed={statusFilter === value}
									onClick={() => setStatusFilter(value)}
									className={`h-9 rounded-full border px-3.5 text-sm font-semibold ${
										statusFilter === value
											? "border-brand-blue-dark bg-brand-blue-dark text-white"
											: "border-gray-200 bg-white text-ink-soft hover:border-brand-blue"
									}`}
								>
									{label} <span className="opacity-70">{count}</span>
								</button>
							),
						)}
					</div>

					<div className="mt-3 flex flex-wrap gap-3">
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search by name or email"
							aria-label="Search students"
							className="h-11 min-w-[200px] flex-1 rounded-xl border border-gray-200 px-4 text-[14px] text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
						/>
						{cohorts.length > 1 && (
							<Select
								value={cohortFilter}
								onChange={setCohortFilter}
								options={[{ value: "", label: "All cohorts" }, ...cohorts]}
								className="h-11 w-48"
							/>
						)}
						<button
							type="button"
							onClick={copyEmails}
							disabled={shown.length === 0}
							className="h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-ink disabled:opacity-50"
						>
							{copied ? "Copied!" : `Copy ${shown.length} email${shown.length === 1 ? "" : "s"}`}
						</button>
					</div>

					{shown.length === 0 ? (
						<p className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-muted">
							No students match these filters.
						</p>
					) : (
						<>
							{/* Mobile: stacked cards */}
							<div className="mt-4 flex flex-col gap-3 md:hidden">
								{shown.map((s) => (
									<div key={s.user_id} className="rounded-2xl border border-gray-200 bg-white p-4">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="truncate font-semibold text-ink">{s.full_name || "—"}</p>
												<p className="truncate text-sm text-ink-soft">{s.email}</p>
											</div>
											<StatusBadge status={s.status} />
										</div>
										<dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
											<dt className="text-muted">Cohort</dt>
											<dd className="text-right text-ink-soft">{s.cohort_name}</dd>
											<dt className="text-muted">Content</dt>
											<dd className="flex justify-end"><ItemDots items={items} student={s} /></dd>
											<dt className="text-muted">Survey</dt>
											<dd className="text-right"><SurveyCell submitted={s.survey_submitted} /></dd>
											<dt className="text-muted">{s.status === "locked" ? "Unlocks" : "Last activity"}</dt>
											<dd className="text-right text-ink-soft">
												{s.status === "locked" ? formatDate(s.unlock_date) : formatDate(s.last_activity)}
											</dd>
										</dl>
									</div>
								))}
							</div>

							{/* Desktop: table */}
							<div className="mt-4 hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white md:block">
								<table className="w-full text-left text-sm">
									<thead>
										<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
											<th className="px-5 py-3">Student</th>
											<th className="px-5 py-3">Cohort</th>
											<th className="px-5 py-3">Status</th>
											<th className="px-5 py-3">Content</th>
											{progress.survey && <th className="px-5 py-3">Survey</th>}
											<th className="px-5 py-3">Last activity</th>
										</tr>
									</thead>
									<tbody>
										{shown.map((s) => (
											<tr key={s.user_id} className="border-b border-gray-100 last:border-0">
												<td className="px-5 py-3">
													<p className="font-semibold text-ink">{s.full_name || "—"}</p>
													<p className="text-xs text-ink-soft">{s.email}</p>
												</td>
												<td className="px-5 py-3 text-ink-soft">{s.cohort_name}</td>
												<td className="px-5 py-3"><StatusBadge status={s.status} /></td>
												<td className="px-5 py-3"><ItemDots items={items} student={s} /></td>
												{progress.survey && (
													<td className="px-5 py-3"><SurveyCell submitted={s.survey_submitted} /></td>
												)}
												<td className="px-5 py-3 text-ink-soft">
													{s.status === "locked" ? `Unlocks ${formatDate(s.unlock_date)}` : formatDate(s.last_activity)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</>
					)}
				</>
			)}
		</section>
	);
}

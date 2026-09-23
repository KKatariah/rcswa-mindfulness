import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import AdminLayout from "@/components/admin/AdminLayout";
import { listCohorts, listEnrollments } from "@/lib/api";
import type { Cohort, Enrollment } from "@/types/admin";

const STATUS_STYLES: Record<Enrollment["status"], string> = {
	pending: "bg-amber-100 text-amber-700",
	active: "bg-green-100 text-green-700",
	completed: "bg-blue-100 text-blue-700",
	withdrawn: "bg-gray-100 text-gray-600",
};

function StatusBadge({ status }: { status: Enrollment["status"] }) {
	return (
		<span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[status]}`}>
			{status}
		</span>
	);
}

export default function AdminStudentsPage() {
	const [cohorts, setCohorts] = useState<Cohort[]>([]);
	const [students, setStudents] = useState<Enrollment[]>([]);
	const [cohortFilter, setCohortFilter] = useState<string>("");
	const [search, setSearch] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const [cohortData, studentData] = await Promise.all([
					listCohorts(token),
					listEnrollments({}, token),
				]);
				if (!cancelled) {
					setCohorts(cohortData);
					setStudents(studentData);
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load students");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, []);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return students.filter((s) => {
			if (cohortFilter && String(s.cohort) !== cohortFilter) return false;
			if (q && !s.user_full_name.toLowerCase().includes(q) && !s.user_email.toLowerCase().includes(q)) return false;
			return true;
		});
	}, [students, cohortFilter, search]);

	const cohortName = (id: number) => cohorts.find((c) => c.id === id)?.name ?? `#${id}`;

	return (
		<AdminLayout>
			<Head>
				<title>Students — Admin</title>
			</Head>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-2xl font-extrabold text-ink">Students</h1>
				<span className="text-sm text-muted">{filtered.length} of {students.length}</span>
			</div>

			<div className="mt-6 flex flex-wrap gap-3">
				<input
					type="text"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Search by name or email"
					className="h-11 min-w-[220px] flex-1 rounded-xl border border-gray-200 px-4 text-[14px] text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
				/>
				<select
					value={cohortFilter}
					onChange={(e) => setCohortFilter(e.target.value)}
					className="h-11 rounded-xl border border-gray-200 px-4 text-[14px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
				>
					<option value="">All cohorts</option>
					{cohorts.map((c) => (
						<option key={c.id} value={c.id}>{c.name}</option>
					))}
				</select>
			</div>

			<div className="mt-6 overflow-x-auto rounded-2xl border border-gray-200 bg-white">
				{loading ? (
					<div className="flex justify-center py-16">
						<span className="text-sm text-muted">Loading…</span>
					</div>
				) : error ? (
					<p className="p-6 text-sm text-red-600">{error}</p>
				) : filtered.length === 0 ? (
					<p className="p-6 text-sm text-muted">No students found.</p>
				) : (
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
								<th className="px-5 py-3">Name</th>
								<th className="px-5 py-3">Email</th>
								<th className="px-5 py-3">Cohort</th>
								<th className="px-5 py-3">Week</th>
								<th className="px-5 py-3">Status</th>
								<th className="px-5 py-3">Enrolled</th>
							</tr>
						</thead>
						<tbody>
							{filtered.map((s) => (
								<tr key={s.id} className="border-b border-gray-100 last:border-0">
									<td className="px-5 py-3 font-semibold text-ink">{s.user_full_name || "—"}</td>
									<td className="px-5 py-3 text-ink-soft">{s.user_email}</td>
									<td className="px-5 py-3 text-ink-soft">{cohortName(s.cohort)}</td>
									<td className="px-5 py-3 text-ink-soft">{s.current_week}</td>
									<td className="px-5 py-3"><StatusBadge status={s.status} /></td>
									<td className="px-5 py-3 text-ink-soft">{new Date(s.enrolled_at).toLocaleDateString()}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</AdminLayout>
	);
}

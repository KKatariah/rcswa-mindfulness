import { useEffect, useState } from "react";
import Head from "next/head";
import AdminLayout from "@/components/admin/AdminLayout";
import { CheckIcon, XIcon } from "@/components/ui/icons";
import { listCohorts, listEnrollments, approveEnrollment, rejectEnrollment } from "@/lib/api";
import type { Cohort, Enrollment } from "@/types/admin";

export default function AdminApprovalsPage() {
	const [cohorts, setCohorts] = useState<Cohort[]>([]);
	const [requests, setRequests] = useState<Enrollment[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actioningId, setActioningId] = useState<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const [cohortData, pending] = await Promise.all([
					listCohorts(token),
					listEnrollments({ status: "pending" }, token),
				]);
				if (!cancelled) {
					setCohorts(cohortData);
					setRequests(pending);
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load pending requests");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, []);

	const cohortName = (id: number) => cohorts.find((c) => c.id === id)?.name ?? `#${id}`;

	async function handleApprove(enrollment: Enrollment) {
		const token = localStorage.getItem("token") ?? "";
		setActioningId(enrollment.id);
		try {
			await approveEnrollment(enrollment.id, token);
			setRequests((prev) => prev.filter((r) => r.id !== enrollment.id));
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to approve request");
		} finally {
			setActioningId(null);
		}
	}

	async function handleReject(enrollment: Enrollment) {
		if (!confirm(`Reject ${enrollment.user_full_name || enrollment.user_email}'s request to join ${cohortName(enrollment.cohort)}?`)) return;
		const token = localStorage.getItem("token") ?? "";
		setActioningId(enrollment.id);
		try {
			await rejectEnrollment(enrollment.id, token);
			setRequests((prev) => prev.filter((r) => r.id !== enrollment.id));
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to reject request");
		} finally {
			setActioningId(null);
		}
	}

	return (
		<AdminLayout>
			<Head>
				<title>Approvals — Admin</title>
			</Head>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-2xl font-extrabold text-ink">Approvals</h1>
				<span className="text-sm text-muted">{requests.length} pending</span>
			</div>

			<div className="mt-6 overflow-x-auto rounded-2xl border border-gray-200 bg-white">
				{loading ? (
					<div className="flex justify-center py-16">
						<span className="text-sm text-muted">Loading…</span>
					</div>
				) : error ? (
					<p className="p-6 text-sm text-red-600">{error}</p>
				) : requests.length === 0 ? (
					<p className="p-6 text-sm text-muted">No pending requests. New cohort join requests will show up here.</p>
				) : (
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
								<th className="px-5 py-3">Name</th>
								<th className="px-5 py-3">Email</th>
								<th className="px-5 py-3">Requested cohort</th>
								<th className="px-5 py-3">Requested</th>
								<th className="px-5 py-3" />
							</tr>
						</thead>
						<tbody>
							{requests.map((r) => (
								<tr key={r.id} className="border-b border-gray-100 last:border-0">
									<td className="px-5 py-3 font-semibold text-ink">{r.user_full_name || "—"}</td>
									<td className="px-5 py-3 text-ink-soft">{r.user_email}</td>
									<td className="px-5 py-3 text-ink-soft">{cohortName(r.cohort)}</td>
									<td className="px-5 py-3 text-ink-soft">{new Date(r.enrolled_at).toLocaleDateString()}</td>
									<td className="px-5 py-3">
										<div className="flex justify-end gap-3">
											<button
												type="button"
												disabled={actioningId === r.id}
												onClick={() => handleApprove(r)}
												aria-label="Approve request"
												className="flex h-9 items-center gap-1.5 rounded-lg bg-brand-blue px-3 text-xs font-bold text-white disabled:opacity-50"
											>
												<CheckIcon className="size-3.5" />
												Approve
											</button>
											<button
												type="button"
												disabled={actioningId === r.id}
												onClick={() => handleReject(r)}
												aria-label="Reject request"
												className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-ink-soft hover:border-red-300 hover:text-red-500 disabled:opacity-50"
											>
												<XIcon className="size-3.5" />
												Reject
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</AdminLayout>
	);
}

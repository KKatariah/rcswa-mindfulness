import { useEffect, useState } from "react";
import Head from "next/head";
import AdminLayout from "@/components/admin/AdminLayout";
import Select from "@/components/ui/Select";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { listCohorts, listEnrollments, updateEnrollment, deleteUser } from "@/lib/api";
import type { Cohort, Enrollment } from "@/types/admin";

export default function AdminApprovalsPage() {
	const [pendingEnrollments, setPendingEnrollments] = useState<Enrollment[]>([]);
	const [cohorts, setCohorts] = useState<Cohort[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actioningId, setActioningId] = useState<number | null>(null);
	const [selectedCohort, setSelectedCohort] = useState<Record<number, string>>({});
	const [rejecting, setRejecting] = useState<Enrollment | null>(null);

	useEffect(() => {
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const [enrollmentData, cohortData] = await Promise.all([
					listEnrollments({ status: "pending" }, token),
					listCohorts(token),
				]);
				if (!cancelled) {
					setPendingEnrollments(enrollmentData);
					setCohorts(cohortData);
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load pending signups");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, []);

	async function handleApprove(enrollment: Enrollment) {
		const cohortId = Number(selectedCohort[enrollment.id] ?? enrollment.cohort);
		const token = localStorage.getItem("token") ?? "";
		setActioningId(enrollment.id);
		try {
			await updateEnrollment(enrollment.id, { cohort: cohortId, status: "active" }, token);
			setPendingEnrollments((prev) => prev.filter((e) => e.id !== enrollment.id));
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to approve signup");
		} finally {
			setActioningId(null);
		}
	}

	async function handleReject() {
		if (!rejecting) return;
		const token = localStorage.getItem("token") ?? "";
		setActioningId(rejecting.id);
		try {
			await deleteUser(rejecting.user, token);
			setPendingEnrollments((prev) => prev.filter((e) => e.id !== rejecting.id));
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to reject signup");
		} finally {
			setActioningId(null);
			setRejecting(null);
		}
	}

	return (
		<AdminLayout>
			<Head>
				<title>Approvals — Admin</title>
			</Head>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-2xl font-extrabold text-ink">Approvals</h1>
				<span className="text-sm text-muted">{pendingEnrollments.length} pending</span>
			</div>

			<div className="mt-6 overflow-x-auto rounded-2xl border border-gray-200 bg-white">
				{loading ? (
					<div className="flex justify-center py-16">
						<span className="text-sm text-muted">Loading…</span>
					</div>
				) : error ? (
					<p className="p-6 text-sm text-red-600">{error}</p>
				) : pendingEnrollments.length === 0 ? (
					<p className="p-6 text-sm text-muted">No pending signups. New signups are auto-assigned a cohort and show up here for confirmation.</p>
				) : (
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
								<th className="px-5 py-3">Name</th>
								<th className="px-5 py-3">Email</th>
								<th className="px-5 py-3">Cohort</th>
								<th className="px-5 py-3" />
							</tr>
						</thead>
						<tbody>
							{pendingEnrollments.map((e) => (
								<tr key={e.id} className="border-b border-gray-100 last:border-0">
									<td className="px-5 py-3 font-semibold text-ink">{e.user_full_name || "—"}</td>
									<td className="px-5 py-3 text-ink-soft">{e.user_email}</td>
									<td className="px-5 py-3">
										<Select
											value={String(selectedCohort[e.id] ?? e.cohort)}
											onChange={(v) => setSelectedCohort((prev) => ({ ...prev, [e.id]: v }))}
											options={cohorts.map((c) => ({ value: String(c.id), label: c.name }))}
											className="h-10 w-56"
										/>
									</td>
									<td className="px-5 py-3">
										<div className="flex justify-end gap-3">
											<button
												type="button"
												disabled={actioningId === e.id}
												onClick={() => handleApprove(e)}
												className="flex h-9 items-center gap-1.5 rounded-lg bg-brand-blue px-3 text-xs font-bold text-white disabled:opacity-50"
											>
												Approve
											</button>
											<button
												type="button"
												disabled={actioningId === e.id}
												onClick={() => setRejecting(e)}
												className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-ink-soft hover:border-red-300 hover:text-red-500 disabled:opacity-50"
											>
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

			{rejecting && (
				<ConfirmDialog
					title="Reject this signup?"
					message={`This permanently deletes ${rejecting.user_email}'s account. This can't be undone.`}
					confirmLabel="Delete account"
					danger
					onConfirm={handleReject}
					onCancel={() => setRejecting(null)}
				/>
			)}
		</AdminLayout>
	);
}

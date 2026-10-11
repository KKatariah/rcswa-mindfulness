import { useState } from "react";
import Head from "next/head";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminTable from "@/components/admin/AdminTable";
import Select from "@/components/ui/Select";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { LoadMore } from "@/components/ui/paging";
import { useAsync } from "@/hooks/useAsync";
import { usePagedList } from "@/hooks/usePagedList";
import { listCohorts, listEnrollments, updateEnrollment, deleteUser } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Cohort, Enrollment } from "@/types/admin";
import { adminPageTitle } from "@/lib/pageTitle";
import Button from "@/components/ui/Button";

export default function AdminApprovalsPage() {
	const pending = usePagedList((page) => listEnrollments({ status: "pending", ...page }), [], {
		errorFallback: "Failed to load pending signups",
	});
	const cohorts = useAsync(listCohorts, [], [] as Cohort[], { errorFallback: "Failed to load pending signups" });
	const [actionError, setActionError] = useState<string | null>(null);
	const [actioningId, setActioningId] = useState<number | null>(null);
	const [selectedCohort, setSelectedCohort] = useState<Record<number, string>>({});
	const [rejecting, setRejecting] = useState<Enrollment | null>(null);
	const [approving, setApproving] = useState<Enrollment | null>(null);

	const pendingEnrollments = pending.items;
	const removeFromList = pending.removeItem;

	const chosenCohortId = (e: Enrollment) => Number(selectedCohort[e.id] ?? e.cohort);
	const cohortName = (id: number) => cohorts.data.find((c) => c.id === id)?.name ?? `#${id}`;

	async function handleApprove() {
		if (!approving) return;
		const enrollment = approving;
		setApproving(null);
		const cohortId = chosenCohortId(enrollment);
		setActioningId(enrollment.id);
		try {
			await updateEnrollment(enrollment.id, { cohort: cohortId, status: "active" });
			removeFromList(enrollment.id);
		} catch (e) {
			setActionError(errorMessage(e, "Failed to approve signup"));
		} finally {
			setActioningId(null);
		}
	}

	async function handleReject() {
		if (!rejecting) return;
		setActioningId(rejecting.id);
		try {
			await deleteUser(rejecting.user);
			removeFromList(rejecting.id);
		} catch (e) {
			setActionError(errorMessage(e, "Failed to reject signup"));
		} finally {
			setActioningId(null);
			setRejecting(null);
		}
	}

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle("Approvals")}</title>
			</Head>

			<AdminPageHeader title="Approvals">
				<span className="text-sm text-muted">{pending.count} pending</span>
			</AdminPageHeader>

			<AdminTable
				columns={["Name", "Email", "Cohort", ""]}
				loading={pending.loading || cohorts.loading}
				error={pending.error ?? cohorts.error ?? actionError}
				empty={pendingEnrollments.length === 0}
				emptyMessage="No pending signups. New signups are auto-assigned a cohort and show up here for confirmation."
			>
				{pendingEnrollments.map((e) => (
					<tr key={e.id} className="border-b border-gray-100 last:border-0">
						<td className="px-5 py-3 font-semibold text-ink">{e.user_full_name || "—"}</td>
						<td className="px-5 py-3 text-ink-soft">{e.user_email}</td>
						<td className="px-5 py-3">
							<Select
								value={String(selectedCohort[e.id] ?? e.cohort)}
								onChange={(v) => setSelectedCohort((prev) => ({ ...prev, [e.id]: v }))}
								options={cohorts.data.map((c) => ({ value: String(c.id), label: c.name }))}
								className="h-10 w-56 cursor-pointer"
							/>
						</td>
						<td className="px-5 py-3">
							<div className="flex justify-end gap-3">
								<Button
									type="button"
									disabled={actioningId === e.id}
									onClick={() => setApproving(e)}
									variant="primary" size="sm" className="px-3"
								>
									Approve
								</Button>
								<button
									type="button"
									disabled={actioningId === e.id}
									onClick={() => setRejecting(e)}
									className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-ink-soft hover:border-red-300 hover:text-red-500 disabled:opacity-50 cursor-pointer"
								>
									Reject
								</button>
							</div>
						</td>
					</tr>
				))}
			</AdminTable>

			<LoadMore
				hasMore={pending.hasMore}
				loading={pending.loadingMore}
				error={pending.loadMoreError}
				onLoadMore={pending.loadMore}
				className="mt-4"
			/>

			{approving && (
				<ConfirmDialog
					title="Approve this signup?"
					message={`${approving.user_email} will be enrolled in ${cohortName(chosenCohortId(approving))} and get access to its modules straight away.`}
					confirmLabel="Approve"
					onConfirm={handleApprove}
					onCancel={() => setApproving(null)}
				/>
			)}

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

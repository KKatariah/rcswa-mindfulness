import { useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminTable from "@/components/admin/AdminTable";
import { EnrollmentStatusBadge, RoleBadge } from "@/components/admin/Badges";
import EditUserModal from "@/components/admin/EditUserModal";
import Card from "@/components/ui/Card";
import { LoadingState } from "@/components/ui/feedback";
import { PencilIcon } from "@/components/ui/icons";
import Select from "@/components/ui/Select";
import { useAsync } from "@/hooks/useAsync";
import { listCohorts, listEnrollments, listUsers } from "@/lib/api";
import type { AdminUser, Cohort, Enrollment } from "@/types/admin";

function EnrollmentStatus({ enrollment }: { enrollment: Enrollment | undefined }) {
	if (!enrollment) return <span className="text-xs text-muted">Not enrolled</span>;
	return <EnrollmentStatusBadge status={enrollment.status} />;
}

export default function AdminUsersPage() {
	const usersState = useAsync(listUsers, [], [] as AdminUser[], { errorFallback: "Failed to load users" });
	const cohortsState = useAsync(listCohorts, [], [] as Cohort[], { errorFallback: "Failed to load users" });
	const enrollmentsState = useAsync(() => listEnrollments(), [], [] as Enrollment[], { errorFallback: "Failed to load users" });
	const { data: users, setData: setUsers } = usersState;
	const cohorts = cohortsState.data;
	const { data: enrollments, setData: setEnrollments } = enrollmentsState;
	const loading = usersState.loading || cohortsState.loading || enrollmentsState.loading;
	const error = usersState.error ?? cohortsState.error ?? enrollmentsState.error;
	const [roleFilter, setRoleFilter] = useState<string>("");
	const [search, setSearch] = useState("");
	const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

	// A user can have more than one enrollment record over time (e.g. withdrawn
	// from one cohort, later enrolled in another) — always keep the most recent
	// one by enrolled_at rather than whichever the API happens to return last,
	// so this doesn't silently depend on the endpoint's default ordering.
	const enrollmentByUser = useMemo(() => {
		const map = new Map<number, Enrollment>();
		for (const e of enrollments) {
			const existing = map.get(e.user);
			if (!existing || new Date(e.enrolled_at) > new Date(existing.enrolled_at)) {
				map.set(e.user, e);
			}
		}
		return map;
	}, [enrollments]);

	const cohortName = (id: number) => cohorts.find((c) => c.id === id)?.name ?? `#${id}`;

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return users.filter((u) => {
			if (roleFilter && u.role !== roleFilter) return false;
			const name = u.full_name || u.display_name;
			if (q && !name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
			return true;
		});
	}, [users, roleFilter, search]);

	function handleUserSaved(updated: AdminUser, nextEnrollment: Enrollment | null | undefined) {
		setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
		if (nextEnrollment !== undefined) {
			setEnrollments((prev) => {
				const withoutUser = prev.filter((e) => e.user !== updated.id);
				return nextEnrollment ? [...withoutUser, nextEnrollment] : withoutUser;
			});
		}
		setEditingUser(null);
	}

	return (
		<AdminLayout>
			<Head>
				<title>Users — Admin</title>
			</Head>

			<AdminPageHeader title="Users">
				<span className="text-sm text-muted">{filtered.length} of {users.length}</span>
			</AdminPageHeader>

			<div className="mt-6 flex flex-wrap gap-3">
				<input
					type="text"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Search by name or email"
					className="h-11 min-w-[220px] flex-1 rounded-xl border border-gray-200 px-4 text-[14px] text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
				/>
				<Select
					value={roleFilter}
					onChange={setRoleFilter}
					options={[
						{ value: "", label: "All roles" },
						{ value: "admin", label: "Admin" },
						{ value: "student", label: "Student" },
					]}
					className="h-11 w-48"
				/>
			</div>

			{loading ? (
				<Card variant="admin" className="mt-6">
					<LoadingState />
				</Card>
			) : error ? (
				<Card as="p" variant="admin" className="mt-6 p-6 text-sm text-red-600">{error}</Card>
			) : filtered.length === 0 ? (
				<Card as="p" variant="admin" className="mt-6 p-6 text-sm text-muted">No users found.</Card>
			) : (
				<>
					{/* Mobile: stacked cards */}
					<div className="mt-6 flex flex-col gap-3 md:hidden">
						{filtered.map((u) => {
							const enrollment = enrollmentByUser.get(u.id);
							return (
								<Card key={u.id} variant="admin" className="p-4">
									<div className="flex items-start justify-between gap-3">
										<Link href={`/admin/users/${u.id}`} className="group min-w-0">
											<p className="truncate font-semibold text-ink group-hover:text-brand-blue group-hover:underline">{u.full_name || u.display_name || "—"}</p>
											<p className="truncate text-sm text-ink-soft">{u.email}</p>
										</Link>
										<button
											type="button"
											onClick={() => setEditingUser(u)}
											aria-label="Edit user"
											className="shrink-0 rounded-lg p-1.5 hover:bg-surface-muted"
										>
											<PencilIcon className="size-4 text-muted hover:text-brand-blue" />
										</button>
									</div>

									<div className="mt-3 flex flex-wrap items-center gap-2">
										<RoleBadge role={u.role} />
										<EnrollmentStatus enrollment={enrollment} />
									</div>

									<dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
										<dt className="text-muted">Cohort</dt>
										<dd className="text-right text-ink-soft">{enrollment ? cohortName(enrollment.cohort) : "—"}</dd>
										<dt className="text-muted">Joined</dt>
										<dd className="text-right text-ink-soft">{new Date(u.created_at).toLocaleDateString()}</dd>
									</dl>
								</Card>
							);
						})}
					</div>

					{/* Desktop: table */}
					<AdminTable columns={["Name", "Email", "Role", "Cohort", "Status", "Joined", ""]} className="mt-6 hidden md:block">
						{filtered.map((u) => {
							const enrollment = enrollmentByUser.get(u.id);
							return (
								<tr key={u.id} className="border-b border-gray-100 last:border-0">
									<td className="px-5 py-3 font-semibold text-ink">
										<Link href={`/admin/users/${u.id}`} className="hover:text-brand-blue hover:underline">{u.full_name || u.display_name || "—"}</Link>
									</td>
									<td className="px-5 py-3 text-ink-soft">
										<Link href={`/admin/users/${u.id}`} className="hover:text-brand-blue hover:underline">{u.email}</Link>
									</td>
									<td className="px-5 py-3"><RoleBadge role={u.role} /></td>
									<td className="px-5 py-3 text-ink-soft">{enrollment ? cohortName(enrollment.cohort) : "—"}</td>
									<td className="px-5 py-3"><EnrollmentStatus enrollment={enrollment} /></td>
									<td className="px-5 py-3 text-ink-soft">{new Date(u.created_at).toLocaleDateString()}</td>
									<td className="px-5 py-3">
										<button type="button" onClick={() => setEditingUser(u)} aria-label="Edit user">
											<PencilIcon className="size-4 text-muted hover:text-brand-blue" />
										</button>
									</td>
								</tr>
							);
						})}
					</AdminTable>
				</>
			)}

			<EditUserModal
				user={editingUser}
				enrollment={editingUser ? enrollmentByUser.get(editingUser.id) ?? null : null}
				cohorts={cohorts}
				onClose={() => setEditingUser(null)}
				onSaved={handleUserSaved}
			/>
		</AdminLayout>
	);
}

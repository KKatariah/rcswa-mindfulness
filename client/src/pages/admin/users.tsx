import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import Select from "@/components/ui/Select";
import EditUserModal from "@/components/admin/EditUserModal";
import ResetPasswordModal from "@/components/admin/ResetPasswordModal";
import { EnrollmentStatusBadge, RoleBadge } from "@/components/admin/Badges";
import { PencilIcon } from "@/components/ui/icons";
import { listCohorts, listEnrollments, listUsers } from "@/lib/api";
import type { AdminUser, Cohort, Enrollment } from "@/types/admin";
import { adminPageTitle } from "@/lib/pageTitle";

export default function AdminUsersPage() {
	const [users, setUsers] = useState<AdminUser[]>([]);
	const [cohorts, setCohorts] = useState<Cohort[]>([]);
	const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
	const [roleFilter, setRoleFilter] = useState<string>("");
	const [search, setSearch] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
	const [resettingUser, setResettingUser] = useState<AdminUser | null>(null);

	useEffect(() => {
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const [userData, cohortData, enrollmentData] = await Promise.all([
					listUsers(token),
					listCohorts(token),
					listEnrollments({}, token),
				]);
				if (!cancelled) {
					setUsers(userData);
					setCohorts(cohortData);
					setEnrollments(enrollmentData);
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load users");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, []);

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

	// Admins can't be reset from here (the server refuses it too).
	const canReset = (u: AdminUser) => u.role !== "admin";

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle("Users")}</title>
			</Head>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-2xl font-extrabold text-ink">Users</h1>
				<span className="text-sm text-muted">{filtered.length} of {users.length}</span>
			</div>

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
				<div className="mt-6 flex justify-center rounded-2xl border border-gray-200 bg-white py-16">
					<span className="text-sm text-muted">Loading…</span>
				</div>
			) : error ? (
				<p className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-red-600">{error}</p>
			) : filtered.length === 0 ? (
				<p className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-muted">No users found.</p>
			) : (
				<>
					{/* Mobile: stacked cards */}
					<div className="mt-6 flex flex-col gap-3 md:hidden">
						{filtered.map((u) => {
							const enrollment = enrollmentByUser.get(u.id);
							return (
								<div key={u.id} className="rounded-2xl border border-gray-200 bg-white p-4">
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
										{enrollment ? <EnrollmentStatusBadge status={enrollment.status} /> : <span className="text-xs text-muted">Not enrolled</span>}
									</div>

									<dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
										<dt className="text-muted">Cohort</dt>
										<dd className="text-right text-ink-soft">{enrollment ? cohortName(enrollment.cohort) : "—"}</dd>
										<dt className="text-muted">Joined</dt>
										<dd className="text-right text-ink-soft">{new Date(u.created_at).toLocaleDateString()}</dd>
									</dl>

									{canReset(u) && (
										<button
											type="button"
											onClick={() => setResettingUser(u)}
											className="mt-3 text-sm font-semibold text-brand-blue hover:underline"
										>
											Reset password
										</button>
									)}
								</div>
							);
						})}
					</div>

					{/* Desktop: table */}
					<div className="mt-6 hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white md:block">
						<table className="w-full text-left text-sm">
							<thead>
								<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
									<th className="px-5 py-3">Name</th>
									<th className="px-5 py-3">Email</th>
									<th className="px-5 py-3">Role</th>
									<th className="px-5 py-3">Cohort</th>
									<th className="px-5 py-3">Status</th>
									<th className="px-5 py-3">Joined</th>
									<th className="px-5 py-3" />
								</tr>
							</thead>
							<tbody>
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
											<td className="px-5 py-3">{enrollment ? <EnrollmentStatusBadge status={enrollment.status} /> : <span className="text-xs text-muted">Not enrolled</span>}</td>
											<td className="px-5 py-3 text-ink-soft">{new Date(u.created_at).toLocaleDateString()}</td>
											<td className="px-5 py-3">
												<div className="flex items-center justify-end gap-4">
													{canReset(u) && (
														<button
															type="button"
															onClick={() => setResettingUser(u)}
															className="whitespace-nowrap text-sm font-semibold text-brand-blue hover:underline"
														>
															Reset password
														</button>
													)}
													<button type="button" onClick={() => setEditingUser(u)} aria-label="Edit user">
														<PencilIcon className="size-4 text-muted hover:text-brand-blue" />
													</button>
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</>
			)}

			<EditUserModal
				user={editingUser}
				enrollment={editingUser ? enrollmentByUser.get(editingUser.id) ?? null : null}
				cohorts={cohorts}
				onClose={() => setEditingUser(null)}
				onSaved={handleUserSaved}
			/>

			<ResetPasswordModal user={resettingUser} onClose={() => setResettingUser(null)} />
		</AdminLayout>
	);
}

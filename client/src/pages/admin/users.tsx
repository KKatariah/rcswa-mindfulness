import { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminTable from "@/components/admin/AdminTable";
import ResetPasswordModal from "@/components/admin/ResetPasswordModal";
import { EnrollmentStatusBadge, NotEnrolledBadge, RoleBadge } from "@/components/admin/Badges";
import EditUserModal from "@/components/admin/EditUserModal";
import Card from "@/components/ui/Card";
import { LoadingState } from "@/components/ui/feedback";
import { LockIcon, PencilIcon } from "@/components/ui/icons";
import { Pager } from "@/components/ui/paging";
import Select from "@/components/ui/Select";
import { useAsync } from "@/hooks/useAsync";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { listCohorts, listUsers, type Page } from "@/lib/api";
import type { AdminUser, Cohort, Enrollment } from "@/types/admin";
import { adminPageTitle } from "@/lib/pageTitle";
import { formatDate } from "@/lib/dates";

const PAGE_SIZE = 25;

function EnrollmentStatus({ enrollment }: { enrollment: AdminUser["enrollment"] }) {
	if (!enrollment) return <NotEnrolledBadge />;
	return <EnrollmentStatusBadge status={enrollment.status} />;
}

export default function AdminUsersPage() {
	const [roleFilter, setRoleFilter] = useState<string>("");
	const [search, setSearch] = useState("");
	const [offset, setOffset] = useState(0);
	const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
	const debouncedSearch = useDebouncedValue(search.trim());
	const [resettingUser, setResettingUser] = useState<AdminUser | null>(null);

	// Searching and filtering happen on the server, which sends one page at a time.
	const usersState = useAsync(
		() => listUsers({ search: debouncedSearch, role: roleFilter, limit: PAGE_SIZE, offset }),
		[debouncedSearch, roleFilter, offset],
		{ count: 0, results: [] } as Page<AdminUser>,
		{ errorFallback: "Failed to load users" },
	);
	const cohortsState = useAsync(listCohorts, [], [] as Cohort[], { errorFallback: "Failed to load users" });
	const { results: users, count } = usersState.data;
	const cohorts = cohortsState.data;
	const loading = usersState.loading || cohortsState.loading;
	const error = usersState.error ?? cohortsState.error;

	// A new search or filter starts again from the first page.
	const [shownFilters, setShownFilters] = useState({ debouncedSearch, roleFilter });
	if (shownFilters.debouncedSearch !== debouncedSearch || shownFilters.roleFilter !== roleFilter) {
		setShownFilters({ debouncedSearch, roleFilter });
		setOffset(0);
	}

	const cohortName = (id: number) => cohorts.find((c) => c.id === id)?.name ?? `#${id}`;

	function handleUserSaved(updated: AdminUser, nextEnrollment: Enrollment | null | undefined) {
		usersState.setData((page) => ({
			...page,
			results: page.results.map((u) => {
				if (u.id !== updated.id) return u;
				// The save response has no enrollment; keep theirs unless the cohort changed.
				const enrollment =
					nextEnrollment === undefined
						? u.enrollment
						: nextEnrollment && {
								id: nextEnrollment.id,
								cohort: nextEnrollment.cohort,
								status: nextEnrollment.status,
								enrolled_at: nextEnrollment.enrolled_at,
							};
				return { ...u, ...updated, enrollment };
			}),
		}));
		setEditingUser(null);
	}

	// Admins can't be reset from here (the server refuses it too).
	const canReset = (u: AdminUser) => u.role !== "admin";

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle("Users")}</title>
			</Head>

			<AdminPageHeader title="Users">
				<span className="text-sm text-muted">{count} {debouncedSearch || roleFilter ? "found" : "total"}</span>
			</AdminPageHeader>

			<div className="mt-6 flex flex-wrap gap-3">
				<input
					type="text"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Search by name or email"
					aria-label="Search users by name or email"
					className="h-11 min-w-[220px] flex-1 rounded-xl border border-gray-200 px-4 text-sm text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue"
				/>
				<Select
					value={roleFilter}
					onChange={setRoleFilter}
					options={[
						{ value: "", label: "All roles" },
						{ value: "admin", label: "Admin" },
						{ value: "student", label: "Student" },
					]}
					className="h-11 w-48 cursor-pointer"
				/>
			</div>

			{loading ? (
				<Card className="mt-6">
					<LoadingState />
				</Card>
			) : error ? (
				<Card as="p" className="mt-6 p-6 text-sm text-red-600">{error}</Card>
			) : users.length === 0 ? (
				<Card as="p" className="mt-6 p-6 text-sm text-muted">No users found.</Card>
			) : (
				<>
					{/* Mobile: stacked cards */}
					<div className="mt-6 flex flex-col gap-3 md:hidden">
						{users.map((u) => {
							const enrollment = u.enrollment;
							return (
								<Card key={u.id} className="p-4">
									<div className="flex items-start justify-between gap-3">
										<Link href={`/admin/users/${u.id}`} className="group min-w-0">
											<p className="truncate font-semibold text-ink group-hover:text-brand-blue group-hover:underline">{u.full_name || u.display_name || "—"}</p>
											<p className="truncate text-sm text-ink-soft">{u.email}</p>
										</Link>
										{/* Same icons as the desktop table: reset password beside the edit pencil. */}
										<div className="flex shrink-0 items-center">
											{canReset(u) && (
												<button
													type="button"
													onClick={() => setResettingUser(u)}
													aria-label={`Reset password for ${u.full_name || u.email}`}
													title="Reset password"
													className="rounded-lg p-1.5 hover:bg-surface-muted"
												>
													<LockIcon className="size-4 text-muted hover:text-brand-blue cursor-pointer" />
												</button>
											)}
											<button
												type="button"
												onClick={() => setEditingUser(u)}
												aria-label="Edit user"
												className="rounded-lg p-1.5 hover:bg-surface-muted"
											>
												<PencilIcon className="size-4 text-muted hover:text-brand-blue cursor-pointer" />
											</button>
										</div>
									</div>

									<div className="mt-3 flex flex-wrap items-center gap-2">
										<RoleBadge role={u.role} />
										<EnrollmentStatus enrollment={enrollment} />
									</div>

									<dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
										<dt className="text-muted">Cohort</dt>
										<dd className="text-right text-ink-soft">{enrollment ? cohortName(enrollment.cohort) : "—"}</dd>
										<dt className="text-muted">Joined</dt>
										<dd className="text-right text-ink-soft">{formatDate(u.created_at)}</dd>
									</dl>

								</Card>
							);
						})}
					</div>

					{/* Desktop: table */}
					<AdminTable columns={["Name", "Email", "Role", "Cohort", "Status", "Joined", ""]} className="mt-6 hidden md:block">
						{users.map((u) => {
							const enrollment = u.enrollment;
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
									<td className="px-5 py-3 text-ink-soft">{formatDate(u.created_at)}</td>
									<td className="px-5 py-3">
										<div className="flex items-center justify-end gap-4">
											{/* An icon beside the edit pencil, so the column isn't a repeated text link; admins
											    can't be reset here, and the empty slot keeps the pencils lined up. */}
											{canReset(u) ? (
												<button
													type="button"
													onClick={() => setResettingUser(u)}
													aria-label={`Reset password for ${u.full_name || u.email}`}
													title="Reset password"
												>
													<LockIcon className="size-4 text-muted hover:text-brand-blue cursor-pointer" />
												</button>
											) : (
												<span className="size-4" aria-hidden="true" />
											)}
											<button type="button" onClick={() => setEditingUser(u)} aria-label="Edit user">
												<PencilIcon className="size-4 text-muted hover:text-brand-blue cursor-pointer" />
											</button>
										</div>
									</td>
								</tr>
							);
						})}
					</AdminTable>

					<Pager offset={offset} pageSize={PAGE_SIZE} count={count} onChange={setOffset} className="mt-4" />
				</>
			)}

			<EditUserModal
				user={editingUser}
				enrollment={editingUser?.enrollment ?? null}
				cohorts={cohorts}
				onClose={() => setEditingUser(null)}
				onSaved={handleUserSaved}
			/>

			<ResetPasswordModal user={resettingUser} onClose={() => setResettingUser(null)} />
		</AdminLayout>
	);
}

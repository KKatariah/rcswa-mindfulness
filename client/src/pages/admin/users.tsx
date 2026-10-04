import { useEffect, useMemo, useState, type FormEvent } from "react";
import Head from "next/head";
import AdminLayout from "@/components/admin/AdminLayout";
import Modal from "@/components/main/Modal";
import Select from "@/components/ui/Select";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { PencilIcon } from "@/components/ui/icons";
import {
	listCohorts,
	listEnrollments,
	listUsers,
	updateUser,
	createEnrollment,
	updateEnrollment,
	deleteEnrollment,
} from "@/lib/api";
import type { AdminUser, Cohort, Enrollment } from "@/types/admin";

const STATUS_STYLES: Record<Enrollment["status"], string> = {
	pending: "bg-amber-100 text-amber-700",
	active: "bg-green-100 text-green-700",
	completed: "bg-blue-100 text-blue-700",
	withdrawn: "bg-gray-100 text-gray-600",
};

const ROLE_STYLES: Record<AdminUser["role"], string> = {
	admin: "bg-purple-100 text-purple-700",
	student: "bg-gray-100 text-gray-600",
};

function StatusBadge({ status }: { status: Enrollment["status"] }) {
	return (
		<span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[status]}`}>
			{status}
		</span>
	);
}

function RoleBadge({ role }: { role: AdminUser["role"] }) {
	return (
		<span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${ROLE_STYLES[role]}`}>
			{role}
		</span>
	);
}

type EditFormState = {
	full_name: string;
	email: string;
	role: AdminUser["role"];
	cohort: string;
};

function EditUserForm({
	initial,
	cohorts,
	onSubmit,
	onCancel,
}: {
	initial: EditFormState;
	cohorts: Cohort[];
	onSubmit: (data: EditFormState) => Promise<void>;
	onCancel: () => void;
}) {
	const [form, setForm] = useState(initial);
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [confirmingPromote, setConfirmingPromote] = useState(false);
	const [pendingChanges, setPendingChanges] = useState<string[] | null>(null);

	const cohortName = (id: string) => cohorts.find((c) => String(c.id) === id)?.name ?? "their cohort";

	// Changes that cost the user access (or move them between cohort schedules) are confirmed before saving.
	function riskyChanges(): string[] {
		const changes: string[] = [];
		if (initial.role === "admin" && form.role !== "admin") {
			changes.push("lose access to the admin dashboard");
		}
		if (initial.cohort && !form.cohort) {
			changes.push(`be removed from ${cohortName(initial.cohort)} and lose access to the program's modules`);
		} else if (initial.cohort && form.cohort !== initial.cohort) {
			changes.push(`move from ${cohortName(initial.cohort)} to ${cohortName(form.cohort)}, which changes when each module unlocks for them`);
		}
		return changes;
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const changes = riskyChanges();
		if (changes.length > 0) {
			setPendingChanges(changes);
			return;
		}
		save();
	}

	async function save() {
		setPendingChanges(null);
		setError(null);
		setSubmitting(true);
		try {
			await onSubmit(form);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save user");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			{error && <p className="text-sm text-red-600" role="alert">{error}</p>}

			<div className="flex flex-col gap-2">
				<label htmlFor="user-name" className="text-sm font-semibold text-ink">Full name</label>
				<input
					id="user-name"
					required
					value={form.full_name}
					onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
					className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
				/>
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="user-email" className="text-sm font-semibold text-ink">Email</label>
				<input
					id="user-email"
					type="email"
					required
					value={form.email}
					onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
					className="h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
				/>
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="user-role" className="text-sm font-semibold text-ink">Role</label>
				<Select
					id="user-role"
					value={form.role}
					onChange={(nextRole) => {
						if (nextRole === "admin" && initial.role !== "admin") {
							setConfirmingPromote(true);
							return;
						}
						setForm((f) => ({ ...f, role: nextRole as AdminUser["role"] }));
					}}
					options={[
						{ value: "student", label: "Student" },
						{ value: "admin", label: "Admin" },
					]}
					className="h-12 w-full"
				/>
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="user-cohort" className="text-sm font-semibold text-ink">Cohort</label>
				<Select
					id="user-cohort"
					value={form.cohort}
					onChange={(cohort) => setForm((f) => ({ ...f, cohort }))}
					options={[
						{ value: "", label: "Not enrolled" },
						...cohorts.map((c) => ({ value: String(c.id), label: c.name })),
					]}
					className="h-12 w-full"
				/>
			</div>

			<div className="mt-2 flex gap-3">
				<button
					type="submit"
					disabled={submitting}
					className="h-12 flex-1 rounded-xl bg-brand-blue-dark text-[15px] font-bold text-white disabled:opacity-50"
				>
					{submitting ? "Saving…" : "Save"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="h-12 flex-1 rounded-xl border border-gray-200 text-[15px] font-semibold text-ink"
				>
					Cancel
				</button>
			</div>

			{pendingChanges && (
				<ConfirmDialog
					title="Save these changes?"
					message={`${initial.email} will ${pendingChanges.join(", and will ")}.`}
					confirmLabel="Save changes"
					danger
					onConfirm={save}
					onCancel={() => setPendingChanges(null)}
				/>
			)}

			{confirmingPromote && (
				<ConfirmDialog
					title="Promote to admin?"
					message={`${initial.email} will gain full access to the admin dashboard, including managing users, cohorts, and content.`}
					confirmLabel="Promote"
					onConfirm={() => {
						setForm((f) => ({ ...f, role: "admin" }));
						setConfirmingPromote(false);
					}}
					onCancel={() => setConfirmingPromote(false)}
				/>
			)}
		</form>
	);
}

export default function AdminUsersPage() {
	const [users, setUsers] = useState<AdminUser[]>([]);
	const [cohorts, setCohorts] = useState<Cohort[]>([]);
	const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
	const [roleFilter, setRoleFilter] = useState<string>("");
	const [search, setSearch] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

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

	async function handleSaveUser(form: EditFormState) {
		if (!editingUser) return;
		const token = localStorage.getItem("token") ?? "";

		const updated = await updateUser(
			editingUser.id,
			{ full_name: form.full_name, email: form.email, role: form.role },
			token,
		);

		const existing = enrollmentByUser.get(editingUser.id);
		const nextCohortId = form.cohort ? Number(form.cohort) : null;
		let nextEnrollment = existing ?? null;

		if (nextCohortId === null && existing) {
			await deleteEnrollment(existing.id, token);
			nextEnrollment = null;
		} else if (nextCohortId !== null && !existing) {
			nextEnrollment = await createEnrollment({ user: editingUser.id, cohort: nextCohortId }, token);
		} else if (nextCohortId !== null && existing && existing.cohort !== nextCohortId) {
			nextEnrollment = await updateEnrollment(existing.id, { cohort: nextCohortId }, token);
		}

		setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
		setEnrollments((prev) => {
			const withoutUser = prev.filter((e) => e.user !== editingUser.id);
			return nextEnrollment ? [...withoutUser, nextEnrollment] : withoutUser;
		});
		setEditingUser(null);
	}

	return (
		<AdminLayout>
			<Head>
				<title>Users — Admin</title>
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
										<div className="min-w-0">
											<p className="truncate font-semibold text-ink">{u.full_name || u.display_name || "—"}</p>
											<p className="truncate text-sm text-ink-soft">{u.email}</p>
										</div>
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
										{enrollment ? <StatusBadge status={enrollment.status} /> : <span className="text-xs text-muted">Not enrolled</span>}
									</div>

									<dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
										<dt className="text-muted">Cohort</dt>
										<dd className="text-right text-ink-soft">{enrollment ? cohortName(enrollment.cohort) : "—"}</dd>
										<dt className="text-muted">Joined</dt>
										<dd className="text-right text-ink-soft">{new Date(u.created_at).toLocaleDateString()}</dd>
									</dl>
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
											<td className="px-5 py-3 font-semibold text-ink">{u.full_name || u.display_name || "—"}</td>
											<td className="px-5 py-3 text-ink-soft">{u.email}</td>
											<td className="px-5 py-3"><RoleBadge role={u.role} /></td>
											<td className="px-5 py-3 text-ink-soft">{enrollment ? cohortName(enrollment.cohort) : "—"}</td>
											<td className="px-5 py-3">{enrollment ? <StatusBadge status={enrollment.status} /> : <span className="text-xs text-muted">Not enrolled</span>}</td>
											<td className="px-5 py-3 text-ink-soft">{new Date(u.created_at).toLocaleDateString()}</td>
											<td className="px-5 py-3">
												<button type="button" onClick={() => setEditingUser(u)} aria-label="Edit user">
													<PencilIcon className="size-4 text-muted hover:text-brand-blue" />
												</button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</>
			)}

			<Modal isOpen={!!editingUser} onClose={() => setEditingUser(null)} title="Edit User">
				{editingUser && (
					<EditUserForm
						initial={{
							full_name: editingUser.full_name,
							email: editingUser.email,
							role: editingUser.role,
							cohort: enrollmentByUser.get(editingUser.id)?.cohort.toString() ?? "",
						}}
						cohorts={cohorts}
						onSubmit={handleSaveUser}
						onCancel={() => setEditingUser(null)}
					/>
				)}
			</Modal>
		</AdminLayout>
	);
}

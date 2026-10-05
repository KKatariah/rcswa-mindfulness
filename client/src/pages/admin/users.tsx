import { useMemo, useState, type FormEvent } from "react";
import Head from "next/head";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminTable from "@/components/admin/AdminTable";
import Modal from "@/components/main/Modal";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Select from "@/components/ui/Select";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { LoadingState } from "@/components/ui/feedback";
import { Field, FormActions, FormError, TextField } from "@/components/ui/form";
import { PencilIcon } from "@/components/ui/icons";
import { useAsync } from "@/hooks/useAsync";
import { useFormSubmit } from "@/hooks/useFormSubmit";
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

const STATUS_TONES: Record<Enrollment["status"], BadgeTone> = {
	pending: "amber",
	active: "green",
	completed: "blue",
	withdrawn: "gray",
};

const ROLE_TONES: Record<AdminUser["role"], BadgeTone> = {
	admin: "purple",
	student: "gray",
};

function EnrollmentStatus({ enrollment }: { enrollment: Enrollment | undefined }) {
	if (!enrollment) return <span className="text-xs text-muted">Not enrolled</span>;
	return <Badge tone={STATUS_TONES[enrollment.status]}>{enrollment.status}</Badge>;
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
	const { submitting, error, run } = useFormSubmit("Failed to save user");
	const [confirmingPromote, setConfirmingPromote] = useState(false);

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		void run(() => onSubmit(form));
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<FormError message={error} />

			<TextField
				id="user-name"
				label="Full name"
				required
				value={form.full_name}
				onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
			/>

			<TextField
				id="user-email"
				label="Email"
				type="email"
				required
				value={form.email}
				onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
			/>

			<Field id="user-role" label="Role">
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
			</Field>

			<Field id="user-cohort" label="Cohort">
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
			</Field>

			<FormActions submitting={submitting} onCancel={onCancel} />

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

	async function handleSaveUser(form: EditFormState) {
		if (!editingUser) return;

		const updated = await updateUser(editingUser.id, { full_name: form.full_name, email: form.email, role: form.role });

		const existing = enrollmentByUser.get(editingUser.id);
		const nextCohortId = form.cohort ? Number(form.cohort) : null;
		let nextEnrollment = existing ?? null;

		if (nextCohortId === null && existing) {
			await deleteEnrollment(existing.id);
			nextEnrollment = null;
		} else if (nextCohortId !== null && !existing) {
			nextEnrollment = await createEnrollment({ user: editingUser.id, cohort: nextCohortId });
		} else if (nextCohortId !== null && existing && existing.cohort !== nextCohortId) {
			nextEnrollment = await updateEnrollment(existing.id, { cohort: nextCohortId });
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
										<Badge tone={ROLE_TONES[u.role]}>{u.role}</Badge>
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
									<td className="px-5 py-3 font-semibold text-ink">{u.full_name || u.display_name || "—"}</td>
									<td className="px-5 py-3 text-ink-soft">{u.email}</td>
									<td className="px-5 py-3"><Badge tone={ROLE_TONES[u.role]}>{u.role}</Badge></td>
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

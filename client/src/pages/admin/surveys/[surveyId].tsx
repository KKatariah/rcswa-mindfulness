import { useEffect, useState, type FormEvent } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import AdminLayout from "@/components/admin/AdminLayout";
import Modal from "@/components/main/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { PlusIcon, PencilIcon, TrashIcon, ChevronDownIcon } from "@/components/ui/icons";
import { getAdminSurveyDetail, updateSurveyAdmin } from "@/lib/api";
import type { AdminSurveyDetail, SurveyQuestion } from "@/types/admin";

type QuestionForm = {
	text: string;
	type: "integer" | "likert" | "longtext";
	unit: string;
	min: string;
	max: string;
	section: string;
};

const EMPTY_QUESTION_FORM: QuestionForm = {
	text: "",
	type: "integer",
	unit: "",
	min: "0",
	max: "6",
	section: "",
};

type QuestionModalState = {
	mode: "add" | "edit";
	index: number | null;
	form: QuestionForm;
	original: SurveyQuestion | null;
};

function nextQuestionId(existing: SurveyQuestion[]): string {
	const nums = existing
		.map((q) => q.id)
		.filter((id) => /^q\d+$/.test(id))
		.map((id) => parseInt(id.slice(1), 10));
	const max = nums.length > 0 ? Math.max(...nums) : 0;
	return `q${max + 1}`;
}

function formToQuestion(form: QuestionForm, id: string, original: SurveyQuestion | null): SurveyQuestion {
	const base: SurveyQuestion = original ? { ...original } : { id, type: form.type, text: form.text };
	base.id = id;
	base.text = form.text;
	base.type = form.type;

	if (form.type === "integer") {
		if (form.unit) base.unit = form.unit;
		else delete base.unit;
		delete base.min;
		delete base.max;
	} else if (form.type === "likert") {
		base.min = parseInt(form.min, 10) || 0;
		base.max = parseInt(form.max, 10) || 6;
		delete base.unit;
	} else {
		delete base.unit;
		delete base.min;
		delete base.max;
	}

	if (form.section) base.section = form.section;
	else delete base.section;

	return base;
}

function questionToForm(q: SurveyQuestion): QuestionForm {
	return {
		text: q.text,
		type: q.type,
		unit: typeof q.unit === "string" ? q.unit : "",
		min: q.min != null ? String(q.min) : "0",
		max: q.max != null ? String(q.max) : "6",
		section: typeof q.section === "string" ? q.section : "",
	};
}

function getSkipIfDependents(questions: SurveyQuestion[], targetId: string): SurveyQuestion[] {
	return questions.filter((q) => q.skip_if?.question_id === targetId);
}

export default function AdminSurveyEditPage() {
	const router = useRouter();
	const { surveyId } = router.query;

	const [survey, setSurvey] = useState<AdminSurveyDetail | null>(null);
	const [title, setTitle] = useState("");
	const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);

	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saveSuccess, setSaveSuccess] = useState(false);

	const [questionModal, setQuestionModal] = useState<QuestionModalState | null>(null);
	const [questionFormError, setQuestionFormError] = useState<string | null>(null);

	const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const hasResponses = (survey?.response_count ?? 0) > 0;

	useEffect(() => {
		if (!surveyId) return;
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const data = await getAdminSurveyDetail(surveyId as string, token);
				if (!cancelled) {
					setSurvey(data);
					setTitle(data.title);
					setQuestions(data.questions ?? []);
				}
			} catch (e) {
				if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load survey");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, [surveyId]);

	async function handleSave(e: FormEvent) {
		e.preventDefault();
		if (!survey) return;
		setSaving(true);
		setSaveError(null);
		setSaveSuccess(false);
		try {
			const token = localStorage.getItem("token") ?? "";
			const payload: { title: string; questions?: SurveyQuestion[] } = { title };
			if (!hasResponses) payload.questions = questions;
			const updated = await updateSurveyAdmin(survey.id, payload, token);
			setSurvey(updated);
			setTitle(updated.title);
			setQuestions(updated.questions ?? []);
			setSaveSuccess(true);
		} catch (e) {
			setSaveError(e instanceof Error ? e.message : "Failed to save survey");
		} finally {
			setSaving(false);
		}
	}

	function openAddModal() {
		setQuestionFormError(null);
		setQuestionModal({ mode: "add", index: null, form: EMPTY_QUESTION_FORM, original: null });
	}

	function openEditModal(index: number) {
		setQuestionFormError(null);
		setQuestionModal({
			mode: "edit",
			index,
			form: questionToForm(questions[index]),
			original: questions[index],
		});
	}

	function handleQuestionModalSave() {
		if (!questionModal) return;
		const { mode, index, form, original } = questionModal;
		setQuestionFormError(null);

		if (!form.text.trim()) {
			setQuestionFormError("Question text is required.");
			return;
		}
		if (form.type === "likert") {
			const mn = parseInt(form.min, 10);
			const mx = parseInt(form.max, 10);
			if (isNaN(mn) || isNaN(mx) || mn >= mx) {
				setQuestionFormError("Min must be less than max.");
				return;
			}
		}

		if (mode === "add") {
			const id = nextQuestionId(questions);
			const newQuestion = formToQuestion(form, id, null);
			setQuestions((prev) => [...prev, newQuestion]);
		} else if (mode === "edit" && index != null) {
			const updated = formToQuestion(form, questions[index].id, original);
			setQuestions((prev) => prev.map((q, i) => (i === index ? updated : q)));
		}
		setQuestionModal(null);
	}

	function tryDeleteQuestion(index: number) {
		const target = questions[index];
		const dependents = getSkipIfDependents(questions, target.id);
		if (dependents.length > 0) {
			const ids = dependents.map((q) => q.id).join(", ");
			setDeleteError(
				`Cannot delete ${target.id}: question${dependents.length > 1 ? "s" : ""} ${ids} depend${dependents.length === 1 ? "s" : ""} on it via skip_if. Remove that dependency first.`,
			);
			return;
		}
		setDeleteError(null);
		setConfirmDeleteIndex(index);
	}

	function confirmDelete() {
		if (confirmDeleteIndex == null) return;
		setQuestions((prev) => prev.filter((_, i) => i !== confirmDeleteIndex));
		setConfirmDeleteIndex(null);
	}

	function moveQuestion(from: number, to: number) {
		setQuestions((prev) => {
			const next = [...prev];
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);
			return next;
		});
	}

	if (loading) {
		return (
			<AdminLayout>
				<div className="flex justify-center py-16">
					<span className="text-sm text-muted">Loading…</span>
				</div>
			</AdminLayout>
		);
	}

	if (loadError || !survey) {
		return (
			<AdminLayout>
				<p className="p-6 text-sm text-red-600">{loadError ?? "Survey not found."}</p>
			</AdminLayout>
		);
	}

	return (
		<AdminLayout>
			<Head>
				<title>{survey.title} — Admin</title>
			</Head>

			<div className="mb-4">
				<Link
					href="/admin/surveys"
					className="text-sm font-semibold text-brand-blue hover:underline"
				>
					← Back to Surveys
				</Link>
			</div>

			<h1 className="text-2xl font-extrabold text-ink">{survey.title}</h1>
			<p className="mt-1 text-sm text-muted">Code: {survey.code}</p>

			<form onSubmit={handleSave} className="mt-6 space-y-8">
				{/* Title */}
				<div className="rounded-2xl border border-gray-200 bg-white p-6">
					<h2 className="mb-4 text-base font-bold text-ink">Survey title</h2>
					<input
						id="survey-title"
						value={title}
						onChange={(e) => { setTitle(e.target.value); setSaveSuccess(false); }}
						required
						className="h-12 w-full rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
					/>
				</div>

				{/* Questions */}
				<div className="rounded-2xl border border-gray-200 bg-white p-6">
					<h2 className="mb-4 text-base font-bold text-ink">Questions</h2>

					{hasResponses && (
						<div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
							Questions cannot be edited once students have submitted responses. You can still rename the survey above.
						</div>
					)}

					{deleteError && (
						<p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600" role="alert">
							{deleteError}
						</p>
					)}

					{questions.length === 0 ? (
						<p className="text-sm text-muted">No questions yet.</p>
					) : (
						<div className="overflow-x-auto rounded-xl border border-gray-100">
							<table className="w-full text-left text-sm">
								<thead>
									<tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-muted">
										<th className="px-4 py-2">#</th>
										<th className="px-4 py-2">Question</th>
										<th className="px-4 py-2">Type</th>
										<th className="px-4 py-2 text-right">Actions</th>
									</tr>
								</thead>
								<tbody>
									{questions.map((q, i) => (
										<tr key={q.id} className="border-b border-gray-50 last:border-0">
											<td className="px-4 py-2 text-xs font-mono text-muted">{q.id}</td>
											<td className="px-4 py-2 text-ink-soft">{q.text}</td>
											<td className="px-4 py-2">
												<span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
													{q.type}
												</span>
												{q.skip_if && (
													<span className="ml-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
														skip_if
													</span>
												)}
											</td>
											<td className="px-4 py-2">
												<div className="flex items-center justify-end gap-1">
													<button
														type="button"
														disabled={hasResponses || i === 0}
														onClick={() => moveQuestion(i, i - 1)}
														aria-label="Move up"
														className="rounded p-1 disabled:opacity-30 hover:bg-gray-100"
													>
														<ChevronDownIcon className="size-4 rotate-180" />
													</button>
													<button
														type="button"
														disabled={hasResponses || i === questions.length - 1}
														onClick={() => moveQuestion(i, i + 1)}
														aria-label="Move down"
														className="rounded p-1 disabled:opacity-30 hover:bg-gray-100"
													>
														<ChevronDownIcon className="size-4" />
													</button>
													<button
														type="button"
														disabled={hasResponses}
														onClick={() => { setDeleteError(null); openEditModal(i); }}
														aria-label="Edit question"
														className="rounded p-1 disabled:opacity-30 hover:bg-gray-100"
													>
														<PencilIcon className="size-4 text-muted" />
													</button>
													<button
														type="button"
														disabled={hasResponses}
														onClick={() => tryDeleteQuestion(i)}
														aria-label="Delete question"
														className="rounded p-1 disabled:opacity-30 hover:bg-gray-100"
													>
														<TrashIcon className="size-4 text-muted hover:text-red-500" />
													</button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{!hasResponses && (
						<button
							type="button"
							onClick={openAddModal}
							className="mt-4 flex items-center gap-2 text-sm font-semibold text-brand-blue hover:underline"
						>
							<PlusIcon className="size-4" />
							Add question
						</button>
					)}
				</div>

				{/* Save */}
				<div className="flex items-center gap-4">
					<button
						type="submit"
						disabled={saving}
						className="h-11 rounded-xl bg-brand-blue px-6 text-sm font-bold text-white disabled:opacity-50"
					>
						{saving ? "Saving…" : "Save changes"}
					</button>
					{saveSuccess && (
						<span className="text-sm font-semibold text-green-600">Saved.</span>
					)}
					{saveError && (
						<span className="text-sm text-red-600" role="alert">{saveError}</span>
					)}
				</div>
			</form>

			{/* Question add/edit modal */}
			{questionModal && (
				<Modal
					isOpen
					onClose={() => setQuestionModal(null)}
					title={questionModal.mode === "add" ? "Add question" : "Edit question"}
				>
					<div className="flex flex-col gap-4">
						{questionFormError && (
							<p className="text-sm text-red-600" role="alert">{questionFormError}</p>
						)}

						<div className="flex flex-col gap-1">
							<label className="text-sm font-semibold text-ink">Question text</label>
							<textarea
								rows={3}
								value={questionModal.form.text}
								onChange={(e) =>
									setQuestionModal((m) => m && { ...m, form: { ...m.form, text: e.target.value } })
								}
								className="resize-none rounded-xl border border-gray-200 p-3 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
							/>
						</div>

						<div className="flex flex-col gap-1">
							<label className="text-sm font-semibold text-ink">Type</label>
							<select
								value={questionModal.form.type}
								onChange={(e) =>
									setQuestionModal((m) =>
										m && {
											...m,
											form: {
												...m.form,
												type: e.target.value as QuestionForm["type"],
											},
										},
									)
								}
								className="h-11 rounded-xl border border-gray-200 px-3 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
							>
								<option value="integer">Integer (number input)</option>
								<option value="likert">Likert (scale)</option>
								<option value="longtext">Long text (open response)</option>
							</select>
						</div>

						{questionModal.form.type === "integer" && (
							<div className="flex flex-col gap-1">
								<label className="text-sm font-semibold text-ink">Unit (optional)</label>
								<input
									value={questionModal.form.unit}
									onChange={(e) =>
										setQuestionModal((m) =>
											m && { ...m, form: { ...m.form, unit: e.target.value } },
										)
									}
									placeholder="e.g. minutes, times"
									className="h-11 rounded-xl border border-gray-200 px-3 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
								/>
							</div>
						)}

						{questionModal.form.type === "likert" && (
							<div className="flex gap-3">
								<div className="flex flex-1 flex-col gap-1">
									<label className="text-sm font-semibold text-ink">Min</label>
									<input
										type="number"
										value={questionModal.form.min}
										onChange={(e) =>
											setQuestionModal((m) =>
												m && { ...m, form: { ...m.form, min: e.target.value } },
											)
										}
										className="h-11 rounded-xl border border-gray-200 px-3 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
									/>
								</div>
								<div className="flex flex-1 flex-col gap-1">
									<label className="text-sm font-semibold text-ink">Max</label>
									<input
										type="number"
										value={questionModal.form.max}
										onChange={(e) =>
											setQuestionModal((m) =>
												m && { ...m, form: { ...m.form, max: e.target.value } },
											)
										}
										className="h-11 rounded-xl border border-gray-200 px-3 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
									/>
								</div>
							</div>
						)}

						<div className="flex flex-col gap-1">
							<label className="text-sm font-semibold text-ink">Section heading (optional)</label>
							<input
								value={questionModal.form.section}
								onChange={(e) =>
									setQuestionModal((m) =>
										m && { ...m, form: { ...m.form, section: e.target.value } },
									)
								}
								placeholder="Shown above this question as a group heading"
								className="h-11 rounded-xl border border-gray-200 px-3 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue"
							/>
						</div>

						{questionModal.original?.skip_if && (
							<div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-muted">
								<span className="font-semibold">skip_if:</span> shown when question{" "}
								{questionModal.original.skip_if.question_id} ={" "}
								{questionModal.original.skip_if.value} (read-only)
							</div>
						)}

						<button
							type="button"
							onClick={handleQuestionModalSave}
							className="h-12 rounded-xl bg-brand-blue-dark text-[15px] font-bold text-white"
						>
							{questionModal.mode === "add" ? "Add" : "Save"}
						</button>
					</div>
				</Modal>
			)}

			{confirmDeleteIndex != null && (
				<ConfirmDialog
					title="Delete question?"
					message={`Delete "${questions[confirmDeleteIndex]?.text}"? This cannot be undone.`}
					confirmLabel="Delete"
					danger
					onConfirm={confirmDelete}
					onCancel={() => setConfirmDeleteIndex(null)}
				/>
			)}
		</AdminLayout>
	);
}

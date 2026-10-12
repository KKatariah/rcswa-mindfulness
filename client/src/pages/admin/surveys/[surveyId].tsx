import { useMemo, useState, type FormEvent } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import AdminLayout from "@/components/admin/AdminLayout";
import DangerZone from "@/components/admin/DangerZone";
import SurveyExport from "@/components/admin/SurveyExport";
import Card from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DragHandle, { ReorderHelp } from "@/components/ui/DragHandle";
import { ErrorBanner, LoadingState } from "@/components/ui/feedback";
import { TextAreaField, TextField } from "@/components/ui/form";
import { PlusIcon, TrashIcon } from "@/components/ui/icons";
import Select from "@/components/ui/Select";
import Tabs from "@/components/ui/Tabs";
import { useAsync } from "@/hooks/useAsync";
import { useDragReorder, type ReorderHandlers } from "@/hooks/useDragReorder";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import { deleteSurvey, getSurveyAdmin, listSurveyResponses, updateSurvey } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { SURVEY_TYPE_LABELS, describeAnswerFormat } from "@/lib/surveys";
import type { AdminSurvey, AdminSurveyResponse, SurveyQuestion } from "@/types/admin";
import { adminPageTitle } from "@/lib/pageTitle";
import Button from "@/components/ui/Button";
import { formatDateTime } from "@/lib/dates";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

type Survey = Omit<AdminSurvey, "response_count">;
type Tab = "questions" | "responses";

const fieldClass =
	"rounded-xl border border-gray-200 px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue";

const NEW_QUESTION_TYPES: { type: SurveyQuestion["type"]; label: string }[] = [
	{ type: "likert", label: "Rating scale" },
	{ type: "integer", label: "Number" },
	{ type: "longtext", label: "Free text" },
];

const SCALE_PRESETS = [
	{ min: 0, max: 6 },
	{ min: 1, max: 5 },
	{ min: 1, max: 10 },
];

/**
 * Next unused "qN" id, so new questions line up with the existing q1, q2… columns in the export.
 * Ids of removed questions that participants answered are skipped: an id must keep one meaning.
 */
function nextQuestionId(usedIds: string[]) {
	const used = usedIds.map((id) => Number(/^q(\d+)$/.exec(id)?.[1] ?? 0));
	return `q${Math.max(0, ...used) + 1}`;
}

function blankQuestion(id: string, type: SurveyQuestion["type"]): SurveyQuestion {
	if (type === "likert") return { id, type, text: "", min: 0, max: 6, scale_labels: { "0": "Never", "6": "Always" } };
	if (type === "integer") return { id, type, text: "", unit: "" };
	return { id, type, text: "" };
}

/** Answered questions whose answer type changed in the draft (they'll be saved under a new id). */
function retypedIds(questions: SurveyQuestion[], saved: SurveyQuestion[], answeredIds: string[]) {
	const savedType = new Map(saved.map((q) => [q.id, q.type]));
	return new Set(
		questions
			.filter((q) => answeredIds.includes(q.id) && savedType.has(q.id) && savedType.get(q.id) !== q.type)
			.map((q) => q.id),
	);
}

/**
 * Give retyped questions fresh ids. Answers are stored by id, so keeping the id would put old
 * number answers and new text answers (say) in one CSV column; with a new id the old answers
 * stay with the old question, shown as removed and flagged.
 */
function reassignRetypedIds(questions: SurveyQuestion[], saved: SurveyQuestion[], answeredIds: string[]) {
	const retyped = retypedIds(questions, saved, answeredIds);
	if (retyped.size === 0) return questions;
	const used = [...questions.map((q) => q.id), ...answeredIds];
	const renamed = new Map<string, string>();
	for (const id of retyped) {
		const fresh = nextQuestionId(used);
		used.push(fresh);
		renamed.set(id, fresh);
	}
	return questions.map((q) => {
		const next = { ...q, id: renamed.get(q.id) ?? q.id };
		if (q.skip_if && renamed.has(q.skip_if.question_id)) {
			next.skip_if = { ...q.skip_if, question_id: renamed.get(q.skip_if.question_id)! };
		}
		return next;
	});
}

function withoutSkipOn(questions: SurveyQuestion[], targetId: string) {
	return questions.map((q) => {
		if (q.skip_if?.question_id !== targetId) return q;
		const rest = { ...q };
		delete rest.skip_if;
		return rest;
	});
}

/** Drop optional text fields left blank, so the participant form doesn't render empty headings. */
function tidyQuestions(questions: SurveyQuestion[]) {
	return questions.map((q) => {
		const tidy = { ...q };
		if (!tidy.section?.trim()) delete tidy.section;
		if (!tidy.unit?.trim()) delete tidy.unit;
		return tidy;
	});
}

/** "Skip this question when question N is X". Only number and rating questions can be the trigger. */
function SkipRuleEditor({
	question,
	earlier,
	later,
	onChange,
}: {
	question: SurveyQuestion;
	earlier: SurveyQuestion[];
	later: SurveyQuestion[];
	onChange: (targetId: string, value?: number) => void;
}) {
	const rule = question.skip_if;
	const options = earlier
		.map((q, i) => ({ q, n: i + 1 }))
		.filter(({ q }) => q.type !== "longtext")
		.map(({ q, n }) => ({ value: q.id, label: `Question ${n} (${q.id})` }));
	// Reordering can leave the trigger below this question, which the server rejects.
	const misplaced = rule && !earlier.some((q) => q.id === rule.question_id);
	if (misplaced && later.some((q) => q.id === rule.question_id)) {
		options.push({ value: rule.question_id, label: `${rule.question_id} (now below this question)` });
	}
	if (options.length === 0 && !rule) return null;

	return (
		<div className="flex flex-col gap-2">
			<label htmlFor={`skip-${question.id}`} className="text-sm font-semibold text-ink">
				Skip this question when
			</label>
			<div className="flex gap-2">
				<div className="min-w-0 flex-1">
					<Select
						id={`skip-${question.id}`}
						value={rule?.question_id ?? ""}
						onChange={(v) => onChange(v)}
						options={[{ value: "", label: "Never skip" }, ...options]}
						className="h-11 w-full cursor-pointer"
					/>
				</div>
				{rule && (
					<>
						<span className="self-center text-sm text-muted">is</span>
						<input
							type="number"
							step={1}
							required
							aria-label="Skip when the answer is"
							value={rule.value}
							onChange={(e) => {
								if (e.target.value !== "") onChange(rule.question_id, Math.trunc(Number(e.target.value)));
							}}
							className={`h-11 w-20 ${fieldClass}`}
						/>
					</>
				)}
			</div>
			{misplaced && (
				<p className="text-xs font-semibold text-red-600">
					The question this depends on is now below it. Move it back above, or pick another rule.
				</p>
			)}
		</div>
	);
}

function QuestionsEditor({
	survey,
	responseCount,
	answeredIds,
	onSaved,
}: {
	survey: Survey;
	responseCount: number;
	answeredIds: string[];
	onSaved: (survey: Survey) => void;
}) {
	const [draft, setDraft] = useState(survey);
	const { submitting: saving, error, setError, run } = useFormSubmit("Failed to save survey");
	const [savedAt, setSavedAt] = useState<Date | null>(null);
	const [confirmingSave, setConfirmingSave] = useState(false);
	const [addedId, setAddedId] = useState<string | null>(null);
	const dirty = JSON.stringify(draft) !== JSON.stringify(survey);
	const { draggingId, startDrag, handleKey } = useDragReorder<string>();
	const questionIds = draft.questions.map((q) => q.id);

	function reorderTo(ids: string[]) {
		setDraft((d) => {
			const byId = new Map(d.questions.map((q) => [q.id, q]));
			return { ...d, questions: ids.map((id) => byId.get(id)!) };
		});
		setSavedAt(null);
	}

	const reorder: ReorderHandlers<string> = {
		onMove: reorderTo,
		onDrop: () => {},
		onCancel: reorderTo,
	};

	function updateQuestion(index: number, changes: Partial<SurveyQuestion>) {
		setDraft((d) => ({ ...d, questions: d.questions.map((q, i) => (i === index ? { ...q, ...changes } : q)) }));
		setSavedAt(null);
	}

	function updateScale(index: number, q: SurveyQuestion, changes: { min?: number; max?: number; low?: string; high?: string }) {
		const min = changes.min ?? q.min ?? 0;
		const max = changes.max ?? q.max ?? 6;
		const low = changes.low ?? q.scale_labels?.[String(q.min)] ?? "";
		const high = changes.high ?? q.scale_labels?.[String(q.max)] ?? "";
		const labels = changes.min === undefined && changes.max === undefined ? { ...q.scale_labels } : {};
		labels[String(min)] = low;
		labels[String(max)] = high;
		updateQuestion(index, { min, max, scale_labels: labels });
	}

	function addQuestion(type: SurveyQuestion["type"]) {
		const id = nextQuestionId([...draft.questions.map((q) => q.id), ...answeredIds]);
		setDraft((d) => ({ ...d, questions: [...d.questions, blankQuestion(id, type)] }));
		setAddedId(id);
		setSavedAt(null);
	}

	function removeQuestion(index: number) {
		setDraft((d) => {
			const removed = d.questions[index].id;
			// A question can't be skipped based on one that no longer exists.
			return { ...d, questions: withoutSkipOn(d.questions.filter((_, i) => i !== index), removed) };
		});
		setSavedAt(null);
	}

	function changeType(index: number, type: SurveyQuestion["type"]) {
		setDraft((d) => {
			const q = d.questions[index];
			if (q.type === type) return d;
			// Switching back to the saved type restores the saved settings (range, labels, unit).
			const saved = survey.questions.find((s) => s.id === q.id && s.type === type);
			const base = saved ?? blankQuestion(q.id, type);
			const next: SurveyQuestion = { ...base, text: q.text, section: q.section, skip_if: q.skip_if };
			if (next.section === undefined) delete next.section;
			if (next.skip_if === undefined) delete next.skip_if;
			let questions = d.questions.map((x, i) => (i === index ? next : x));
			// Skip rules can only depend on number or rating answers.
			if (type === "longtext") questions = withoutSkipOn(questions, q.id);
			return { ...d, questions };
		});
		setSavedAt(null);
	}

	function setSkipRule(index: number, targetId: string, value?: number) {
		const q = draft.questions[index];
		if (!targetId) {
			const rest = { ...q };
			delete rest.skip_if;
			setDraft((d) => ({ ...d, questions: d.questions.map((x, i) => (i === index ? rest : x)) }));
			setSavedAt(null);
			return;
		}
		const target = draft.questions.find((x) => x.id === targetId);
		const fallback = target?.type === "likert" ? (target.min ?? 0) : 0;
		updateQuestion(index, { skip_if: { question_id: targetId, value: value ?? q.skip_if?.value ?? fallback } });
	}

	const retyped = retypedIds(draft.questions, survey.questions, answeredIds);

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		// Edits reach participants who've already answered, so double-check before changing a live survey.
		if (responseCount > 0) {
			setConfirmingSave(true);
			return;
		}
		save();
	}

	function save() {
		setConfirmingSave(false);
		void run(async () => {
			const updated = await updateSurvey(survey.id, {
				title: draft.title,
				code: draft.code,
				questions: tidyQuestions(reassignRetypedIds(draft.questions, survey.questions, answeredIds)),
			});
			onSaved(updated);
			setDraft(updated);
			setSavedAt(new Date());
		});
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			{responseCount > 0 && (
				<p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
					{responseCount} participant{responseCount === 1 ? " has" : "s have"} already answered this survey.
					You can still edit, reorder, add and remove questions. Their answers are kept, and any answer
					given to a question you change or remove is flagged in the responses and the CSV export.
				</p>
			)}

			<Card className="grid gap-4 p-5 sm:grid-cols-2">
				<TextField
					id="survey-title"
					label="Title"
					size="md"
					required
					maxLength={200}
					value={draft.title}
					onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
				/>
				<TextField
					id="survey-code"
					label={
						<>
							Code <span className="font-normal text-muted">(used in the CSV export)</span>
						</>
					}
					size="md"
					required
					maxLength={50}
					value={draft.code}
					onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
					className="font-mono"
				/>
			</Card>

			<ReorderHelp />
			{draft.questions.map((q, index) => (
				<Card
					key={q.id}
					data-reorder-id={q.id}
					className={`p-5 ${draggingId === q.id ? "opacity-50" : ""}`}
				>
					<div className="flex flex-wrap items-center gap-2">
						<DragHandle
							label={`Move question ${index + 1}`}
							onPointerDown={(e) => startDrag(e, q.id, questionIds, reorder)}
							onKeyDown={(e) => handleKey(e, q.id, questionIds, reorder)}
							disabled={saving}
						/>
						<span className="text-sm font-bold text-ink">Question {index + 1}</span>
						<span className="rounded-full bg-brand-blue/10 px-2.5 py-0.5 font-mono text-xs font-bold text-brand-blue">
							{q.id}
						</span>
						<span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-muted">
							{describeAnswerFormat(q)}
						</span>
						<div className="ml-auto flex items-center gap-1">
							{q.section === undefined && (
								<button
									type="button"
									onClick={() => updateQuestion(index, { section: "" })}
									className="h-8 rounded-lg px-2.5 text-xs font-semibold text-muted hover:bg-surface-muted hover:text-ink cursor-pointer"
								>
									Add section heading
								</button>
							)}
							<button
								type="button"
								onClick={() => removeQuestion(index)}
								disabled={draft.questions.length === 1}
								aria-label={`Remove question ${q.id}`}
								title={draft.questions.length === 1 ? "A survey needs at least one question" : "Remove question"}
								className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-red-600 enabled:cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
							>
								<TrashIcon className="size-4" />
							</button>
						</div>
					</div>

					{q.section !== undefined && (
						<div className="relative mt-4">
							<button
								type="button"
								onClick={() => updateQuestion(index, { section: undefined })}
								className="absolute right-0 top-0 text-xs font-semibold text-muted hover:text-red-600 cursor-pointer"
							>
								Remove heading
							</button>
							<TextAreaField
								id={`section-${q.id}`}
								label={
									<>
										Section heading <span className="font-normal text-muted">(starts a new section at this question)</span>
									</>
								}
								size="md"
								rows={2}
								maxLength={1000}
								value={q.section}
								onChange={(e) => updateQuestion(index, { section: e.target.value })}
								className="resize-y"
							/>
						</div>
					)}

					<div className="mt-4">
						<TextAreaField
							id={`text-${q.id}`}
							label="Question"
							size="md"
							rows={2}
							required
							maxLength={1000}
							autoFocus={q.id === addedId}
							value={q.text}
							onChange={(e) => updateQuestion(index, { text: e.target.value })}
							className="resize-y"
						/>
					</div>

					<div className="mt-4 grid gap-4 sm:grid-cols-2">
						<div className="flex flex-col gap-2">
							<label htmlFor={`type-${q.id}`} className="text-sm font-semibold text-ink">Answer type</label>
							<Select
								id={`type-${q.id}`}
								value={q.type}
								onChange={(v) => changeType(index, v as SurveyQuestion["type"])}
								options={NEW_QUESTION_TYPES.map(({ type, label }) => ({ value: type, label }))}
								className="h-11 cursor-pointer"
							/>
						</div>
						{(index > 0 || q.skip_if) && (
							<SkipRuleEditor
								question={q}
								earlier={draft.questions.slice(0, index)}
								later={draft.questions.slice(index + 1)}
								onChange={(targetId, value) => setSkipRule(index, targetId, value)}
							/>
						)}
					</div>

					{retyped.has(q.id) && (
						<p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
							Participants answered this as a {describeAnswerFormat(survey.questions.find((s) => s.id === q.id)!).toLowerCase()}{" "}
							question. Their answers will be kept with the old version (shown as removed and flagged), and this
							question will be saved as a new one.
						</p>
					)}

					{q.type === "integer" && (
						<div className="mt-4 flex flex-col gap-2 sm:max-w-xs">
							<label htmlFor={`unit-${q.id}`} className="text-sm font-semibold text-ink">
								Unit <span className="font-normal text-muted">(optional, e.g. minutes)</span>
							</label>
							<input
								id={`unit-${q.id}`}
								maxLength={100}
								value={q.unit ?? ""}
								onChange={(e) => updateQuestion(index, { unit: e.target.value })}
								className={`h-11 ${fieldClass}`}
							/>
						</div>
					)}

					{q.type === "likert" && (
						<div className="mt-4 flex flex-wrap items-center gap-2">
							<span className="text-sm font-semibold text-ink">Scale:</span>
							{SCALE_PRESETS.map(({ min, max }) => (
								<button
									key={`${min}-${max}`}
									type="button"
									aria-pressed={q.min === min && q.max === max}
									onClick={() => updateScale(index, q, { min, max })}
									className="h-8 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-ink hover:border-brand-blue hover:text-brand-blue aria-pressed:border-brand-blue aria-pressed:bg-brand-blue/10 aria-pressed:text-brand-blue cursor-pointer"
								>
									{min}–{max}
								</button>
							))}
							<span className="text-xs text-muted">or set your own below (up to 11 points)</span>
						</div>
					)}

					{q.type === "likert" && (
						<div className="mt-4 grid gap-4 sm:grid-cols-[repeat(2,minmax(0,6rem))_repeat(2,minmax(0,1fr))]">
							{([
								["min", "Lowest", q.min],
								["max", "Highest", q.max],
							] as const).map(([key, label, value]) => (
								<div key={key} className="flex flex-col gap-2">
									<label htmlFor={`${key}-${q.id}`} className="text-sm font-semibold text-ink">{label}</label>
									<input
										id={`${key}-${q.id}`}
										type="number"
										required
										step={1}
										value={value ?? ""}
										onChange={(e) => {
											if (e.target.value !== "") updateScale(index, q, { [key]: Math.trunc(Number(e.target.value)) });
										}}
										className={`h-11 ${fieldClass}`}
									/>
								</div>
							))}
							{([
								["low", `Label for ${q.min}`, q.scale_labels?.[String(q.min)]],
								["high", `Label for ${q.max}`, q.scale_labels?.[String(q.max)]],
							] as const).map(([key, label, value]) => (
								<div key={key} className="flex flex-col gap-2">
									<label htmlFor={`${key}-${q.id}`} className="text-sm font-semibold text-ink">{label}</label>
									<input
										id={`${key}-${q.id}`}
										maxLength={100}
										value={value ?? ""}
										onChange={(e) => updateScale(index, q, { [key]: e.target.value })}
										className={`h-11 ${fieldClass}`}
									/>
								</div>
							))}
						</div>
					)}
				</Card>
			))}

			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white p-4">
				<span className="mr-1 text-sm font-semibold text-ink">Add a question:</span>
				{NEW_QUESTION_TYPES.map(({ type, label }) => (
					<button
						key={type}
						type="button"
						onClick={() => addQuestion(type)}
						className="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-ink hover:border-brand-blue hover:text-brand-blue cursor-pointer"
					>
						<PlusIcon className="size-4" />
						{label}
					</button>
				))}
			</div>

			{error && <ErrorBanner>{error}</ErrorBanner>}

			<div className="sticky bottom-4 flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.15)]">
				<Button
					type="submit"
					disabled={saving || !dirty}
					variant="dark" size="md" className="px-6"
				>
					{saving ? "Saving…" : "Save changes"}
				</Button>
				{dirty ? (
					<button
						type="button"
						onClick={() => { setDraft(survey); setError(null); setAddedId(null); }}
						className="h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-ink cursor-pointer hover:bg-surface-muted"
					>
						Discard
					</button>
				) : savedAt ? (
					<span role="status" className="text-sm text-green-700">Saved.</span>
				) : null}
			</div>

			{confirmingSave && (
				<ConfirmDialog
					title="Save changes to this survey?"
					message={`${responseCount} participant${responseCount === 1 ? " has" : "s have"} already answered. Their answers stay as they are, and answers to questions you've changed or removed will be flagged. Anyone answering from now on sees the new version.`}
					confirmLabel="Save changes"
					onConfirm={save}
					onCancel={() => setConfirmingSave(false)}
				/>
			)}
		</form>
	);
}

function formatAnswer(value: number | string | undefined) {
	return value === undefined || value === "" ? "—" : String(value);
}

type Column = SurveyQuestion & { removed?: boolean };

/** Hover text for an answer given to an earlier version of its question, or null if it's current. */
function changeNote(response: AdminSurveyResponse, questionId: string) {
	const change = response.question_changes?.[questionId];
	if (!change) return null;
	if (change.status === "added") return { flagged: false, note: "Added after this response was submitted" };
	const before = change.previous?.text ? `: "${change.previous.text}"` : "";
	return {
		flagged: true,
		note: change.status === "removed"
			? `Question since removed. They answered${before}`
			: `Answered before this question was changed. They saw${before}`,
	};
}

function ResponsesView({ survey, responses }: { survey: Survey; responses: AdminSurveyResponse[] }) {
	const [expanded, setExpanded] = useState<number | null>(null);

	// Current questions, then any removed ones that still hold answers.
	const columns = useMemo<Column[]>(() => {
		const current = new Set(survey.questions.map((q) => q.id));
		const removed = new Map<string, Column>();
		for (const r of responses) {
			for (const [id, change] of Object.entries(r.question_changes ?? {})) {
				if (change.status === "removed" && change.previous && !current.has(id) && !removed.has(id)) {
					removed.set(id, { ...change.previous, removed: true });
				}
			}
		}
		return [...survey.questions, ...removed.values()];
	}, [survey.questions, responses]);

	const summaries = useMemo(
		() =>
			columns.map((q) => {
				const values = responses.map((r) => r.answers[q.id]).filter((v) => v !== undefined && v !== "");
				const numbers = values.filter((v): v is number => typeof v === "number");
				const mean = numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null;
				const earlier = responses.filter((r) => changeNote(r, q.id)?.flagged).length;
				return { q, answered: values.length, mean, earlier };
			}),
		[columns, responses],
	);
	const anyFlagged = summaries.some((s) => s.earlier > 0);

	return (
		<div className="flex flex-col gap-4">
			<Card className="p-5">
				<SurveyExport surveyId={survey.id} />
			</Card>

			{responses.length === 0 ? (
				<Card as="p" className="p-6 text-sm text-muted">No responses yet.</Card>
			) : (
				<>
					<Card className="p-5">
						<h2 className="text-sm font-bold uppercase tracking-wide text-muted">Summary</h2>
						<div role="region" aria-label="Summary table" tabIndex={0} className="mt-3 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">
							<table className="w-full text-left text-sm">
								<thead>
									<tr className="text-xs font-semibold uppercase tracking-wide text-muted">
										<th className="py-2 pr-4">Question</th>
										<th className="py-2 pr-4">Answered</th>
										<th className="py-2 pr-4">Average</th>
									</tr>
								</thead>
								<tbody>
									{summaries.map(({ q, answered, mean, earlier }) => (
										<tr key={q.id} className="border-t border-gray-100 align-top">
											<td className="py-2 pr-4 text-ink">
												<span className="mr-2 font-mono text-xs font-bold text-brand-blue">{q.id}</span>
												{q.text}
												{q.removed && <span className="ml-2 text-xs font-semibold text-muted">(removed)</span>}
											</td>
											<td className="whitespace-nowrap py-2 pr-4 text-ink-soft">
												{answered}/{responses.length}
												{earlier > 0 && (
													<span className="ml-2 text-xs font-semibold text-amber-700">
														{earlier} on an earlier version
													</span>
												)}
											</td>
											<td className="whitespace-nowrap py-2 pr-4 text-ink-soft">
												{mean === null ? "—" : `${mean.toFixed(1)}${q.unit ? ` ${q.unit}` : ""}`}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</Card>

					{anyFlagged && (
						<p className="flex items-center gap-2 text-sm text-ink-soft">
							<span aria-hidden="true" className="size-3 shrink-0 rounded-sm border border-amber-300 bg-amber-100" />
							Highlighted answers were given before their question was changed or removed. Hover one to see the
							wording that participant saw.
						</p>
					)}

					<Card role="region" aria-label="Responses table" tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">
						<table className="w-full text-left text-sm">
							<thead>
								<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
									<th className="px-4 py-3">Participant</th>
									<th className="px-4 py-3">Cohort</th>
									<th className="px-4 py-3">Submitted</th>
									{columns.map((q) => (
										<th key={q.id} className="px-4 py-3 font-mono normal-case" title={q.text}>
											{q.id}
											{q.removed && <span className="ml-1 font-sans text-2xs uppercase">(removed)</span>}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{responses.map((r) => (
									<tr key={r.id} className="border-b border-gray-100 align-top last:border-0">
										<td className="px-4 py-3">
											<Link href={`/admin/users/${r.participant_id}`} className="group block">
												<p className="whitespace-nowrap font-semibold text-ink group-hover:text-brand-blue group-hover:underline">{r.full_name || `#${r.participant_id}`}</p>
												<p className="whitespace-nowrap text-xs text-muted">{r.email}</p>
											</Link>
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-ink-soft">{r.cohort || "—"}</td>
										<td className="whitespace-nowrap px-4 py-3 text-ink-soft">
											{formatDateTime(r.submitted_at)}
										</td>
										{columns.map((q) => {
											const change = changeNote(r, q.id);
											const flag = change?.flagged ? "bg-amber-50 shadow-[inset_3px_0_0_var(--color-amber-300)]" : "";
											const changeLabel = change && <span className="sr-only"> ({change.note})</span>;
											return q.type === "longtext" ? (
												<td key={q.id} title={change?.note} className={`min-w-64 max-w-md px-4 py-3 text-ink-soft ${flag}`}>
													<button
														type="button"
														onClick={() => setExpanded((id) => (id === r.id ? null : r.id))}
														aria-expanded={expanded === r.id}
														className="block w-full text-left"
													>
														{/* Clamp an inner span: Safari ignores line-clamp on a <button> itself. */}
														<span
															className={`whitespace-pre-wrap wrap-anywhere ${expanded === r.id ? "block max-h-80 overflow-y-auto" : "line-clamp-2"}`}
														>
															{formatAnswer(r.answers[q.id])}
														</span>
														{changeLabel}
													</button>
												</td>
											) : (
												<td key={q.id} title={change?.note} className={`px-4 py-3 text-center text-ink-soft ${flag}`}>
													{formatAnswer(r.answers[q.id])}
													{changeLabel}
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
					</Card>
				</>
			)}
		</div>
	);
}

export default function AdminSurveyPage() {
	const router = useRouter();
	const surveyId = router.query.surveyId;
	const validId = typeof surveyId === "string";
	const surveyState = useAsync(() => getSurveyAdmin(Number(surveyId)), [surveyId], null as Survey | null, {
		enabled: validId,
		errorFallback: "Failed to load survey",
	});
	const responsesState = useAsync(() => listSurveyResponses(Number(surveyId)), [surveyId], [] as AdminSurveyResponse[], {
		enabled: validId,
		errorFallback: "Failed to load survey",
	});
	const { data: survey, setData: setSurvey } = surveyState;
	const responses = responsesState.data;
	const loading = surveyState.loading || responsesState.loading;
	const error = surveyState.error ?? responsesState.error;
	const [tab, setTab] = useState<Tab>("questions");
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const answeredIds = useMemo(() => [...new Set(responses.flatMap((r) => Object.keys(r.answers)))], [responses]);

	async function handleSaved(updated: Survey) {
		setSurvey(updated);
		// Which answers are flagged depends on the questions, so fetch the flags again.
		try {
			responsesState.setData(await listSurveyResponses(updated.id));
		} catch {
			// The saved questions are shown either way; flags refresh on the next page load.
		}
	}

	async function handleDelete() {
		if (!survey) return;
		setConfirmingDelete(false);
		setDeleteError(null);
		try {
			await deleteSurvey(survey.id);
			router.push("/admin/surveys");
		} catch (err) {
			setDeleteError(errorMessage(err, "Failed to delete survey"));
		}
	}

	if (loading || error || !survey) {
		return (
			<AdminLayout>
				{loading ? (
					<LoadingState />
				) : (
					<p className="text-sm text-red-600">{error ?? "Survey not found."}</p>
				)}
			</AdminLayout>
		);
	}

	const tabs: { id: Tab; label: string }[] = [
		{ id: "questions", label: `Questions (${survey.questions.length})` },
		{ id: "responses", label: `Responses (${responses.length})` },
	];

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle(survey.title)}</title>
			</Head>

			<AdminPageHeader
				title={survey.title}
				back={{ href: "/admin/surveys", label: "All surveys" }}
				description={<>{SURVEY_TYPE_LABELS[survey.type]} survey · <span className="font-mono">{survey.code}</span></>}
			/>

			<Tabs tabs={tabs} active={tab} onChange={setTab} label="Survey sections" className="mt-5" />

			{/* Both panels stay mounted so unsaved question edits survive a tab switch. */}
			<div className="mt-5" role="tabpanel" hidden={tab !== "questions"}>
				<QuestionsEditor
					survey={survey}
					responseCount={responses.length}
					answeredIds={answeredIds}
					onSaved={handleSaved}
				/>
			</div>
			<div className="mt-5" role="tabpanel" hidden={tab !== "responses"}>
				<ResponsesView survey={survey} responses={responses} />
			</div>

			{responses.length === 0 && (
				<DangerZone
					description="Delete this survey. Surveys can only be deleted before anyone has responded."
					actionLabel="Delete survey"
					onAction={() => setConfirmingDelete(true)}
					className="mt-6"
				/>
			)}
			{deleteError && <ErrorBanner className="mt-4">{deleteError}</ErrorBanner>}

			{confirmingDelete && (
				<ConfirmDialog
					title={`Delete "${survey.title}"?`}
					message="Participants will no longer see this survey. This can't be undone."
					confirmLabel="Delete survey"
					danger
					onConfirm={handleDelete}
					onCancel={() => setConfirmingDelete(false)}
				/>
			)}
		</AdminLayout>
	);
}

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import AdminLayout from "@/components/admin/AdminLayout";
import SurveyExport from "@/components/admin/SurveyExport";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { deleteSurvey, getSurveyAdmin, listSurveyResponses, updateSurvey } from "@/lib/api";
import { SURVEY_TYPE_LABELS, describeAnswerFormat } from "@/lib/surveys";
import type { AdminSurvey, AdminSurveyResponse, SurveyQuestion } from "@/types/admin";

type Survey = Omit<AdminSurvey, "response_count">;
type Tab = "questions" | "responses";

const fieldClass =
	"rounded-xl border border-gray-200 px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-brand-blue";

function QuestionsEditor({
	survey,
	responseCount,
	onSaved,
}: {
	survey: Survey;
	responseCount: number;
	onSaved: (survey: Survey) => void;
}) {
	const [draft, setDraft] = useState(survey);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [savedAt, setSavedAt] = useState<Date | null>(null);
	const [confirmingSave, setConfirmingSave] = useState(false);
	const dirty = JSON.stringify(draft) !== JSON.stringify(survey);

	function updateQuestion(index: number, changes: Partial<SurveyQuestion>) {
		setDraft((d) => ({ ...d, questions: d.questions.map((q, i) => (i === index ? { ...q, ...changes } : q)) }));
		setSavedAt(null);
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		// Edits reach participants who've already answered, so double-check before changing a live survey.
		if (responseCount > 0) {
			setConfirmingSave(true);
			return;
		}
		save();
	}

	async function save() {
		setConfirmingSave(false);
		setSaving(true);
		setError(null);
		try {
			const token = localStorage.getItem("token") ?? "";
			const updated = await updateSurvey(
				survey.id,
				{ title: draft.title, code: draft.code, questions: draft.questions },
				token,
			);
			onSaved(updated);
			setDraft(updated);
			setSavedAt(new Date());
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save survey");
		} finally {
			setSaving(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			{responseCount > 0 && (
				<p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
					{responseCount} participant{responseCount === 1 ? " has" : "s have"} already answered this survey.
					Fixing typos and clarifying wording is fine, but changing what a question asks will make earlier
					answers hard to compare.
				</p>
			)}

			<div className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-5 sm:grid-cols-2">
				<div className="flex flex-col gap-2">
					<label htmlFor="survey-title" className="text-sm font-semibold text-ink">Title</label>
					<input
						id="survey-title"
						required
						maxLength={200}
						value={draft.title}
						onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
						className={`h-11 ${fieldClass}`}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<label htmlFor="survey-code" className="text-sm font-semibold text-ink">
						Code <span className="font-normal text-muted">(used in the CSV export)</span>
					</label>
					<input
						id="survey-code"
						required
						maxLength={50}
						value={draft.code}
						onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
						className={`h-11 font-mono ${fieldClass}`}
					/>
				</div>
			</div>

			{draft.questions.map((q, index) => (
				<div key={q.id} className="rounded-2xl border border-gray-200 bg-white p-5">
					<div className="flex flex-wrap items-center gap-2">
						<span className="rounded-full bg-brand-blue/10 px-2.5 py-0.5 font-mono text-xs font-bold text-brand-blue">
							{q.id}
						</span>
						<span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-muted">
							{describeAnswerFormat(q)}
						</span>
						{q.skip_if && (
							<span className="text-xs text-muted">
								Skipped when {q.skip_if.question_id} = {q.skip_if.value}
							</span>
						)}
					</div>

					{q.section !== undefined && (
						<div className="mt-4 flex flex-col gap-2">
							<label htmlFor={`section-${q.id}`} className="text-sm font-semibold text-ink">
								Section heading <span className="font-normal text-muted">(shown above this question)</span>
							</label>
							<textarea
								id={`section-${q.id}`}
								rows={2}
								maxLength={1000}
								value={q.section}
								onChange={(e) => updateQuestion(index, { section: e.target.value })}
								className={`resize-y py-2.5 ${fieldClass}`}
							/>
						</div>
					)}

					<div className="mt-4 flex flex-col gap-2">
						<label htmlFor={`text-${q.id}`} className="text-sm font-semibold text-ink">Question</label>
						<textarea
							id={`text-${q.id}`}
							rows={2}
							required
							maxLength={1000}
							value={q.text}
							onChange={(e) => updateQuestion(index, { text: e.target.value })}
							className={`resize-y py-2.5 ${fieldClass}`}
						/>
					</div>
				</div>
			))}

			{error && (
				<p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600" role="alert">
					{error}
				</p>
			)}

			<div className="sticky bottom-4 flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.15)]">
				<button
					type="submit"
					disabled={saving || !dirty}
					className="h-11 rounded-xl bg-brand-blue-dark px-6 text-sm font-bold text-white disabled:opacity-50"
				>
					{saving ? "Saving…" : "Save changes"}
				</button>
				{dirty ? (
					<button
						type="button"
						onClick={() => { setDraft(survey); setError(null); }}
						className="h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-ink"
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
					message={`${responseCount} participant${responseCount === 1 ? " has" : "s have"} already answered. Their answers stay as they are, but anyone answering from now on will see the new wording.`}
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

function ResponsesView({ survey, responses }: { survey: Survey; responses: AdminSurveyResponse[] }) {
	const [expanded, setExpanded] = useState<number | null>(null);

	const summaries = useMemo(
		() =>
			survey.questions.map((q) => {
				const values = responses.map((r) => r.answers[q.id]).filter((v) => v !== undefined && v !== "");
				const numbers = values.filter((v): v is number => typeof v === "number");
				const mean = numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null;
				return { q, answered: values.length, mean };
			}),
		[survey.questions, responses],
	);

	return (
		<div className="flex flex-col gap-4">
			<div className="rounded-2xl border border-gray-200 bg-white p-5">
				<SurveyExport surveyId={survey.id} />
			</div>

			{responses.length === 0 ? (
				<p className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-muted">No responses yet.</p>
			) : (
				<>
					<div className="rounded-2xl border border-gray-200 bg-white p-5">
						<h2 className="text-sm font-bold uppercase tracking-wide text-muted">Summary</h2>
						<div className="mt-3 overflow-x-auto">
							<table className="w-full text-left text-sm">
								<thead>
									<tr className="text-xs font-semibold uppercase tracking-wide text-muted">
										<th className="py-2 pr-4">Question</th>
										<th className="py-2 pr-4">Answered</th>
										<th className="py-2 pr-4">Average</th>
									</tr>
								</thead>
								<tbody>
									{summaries.map(({ q, answered, mean }) => (
										<tr key={q.id} className="border-t border-gray-100 align-top">
											<td className="py-2 pr-4 text-ink">
												<span className="mr-2 font-mono text-xs font-bold text-brand-blue">{q.id}</span>
												{q.text}
											</td>
											<td className="whitespace-nowrap py-2 pr-4 text-ink-soft">{answered}/{responses.length}</td>
											<td className="whitespace-nowrap py-2 pr-4 text-ink-soft">
												{mean === null ? "—" : `${mean.toFixed(1)}${q.unit ? ` ${q.unit}` : ""}`}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>

					<div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
						<table className="w-full text-left text-sm">
							<thead>
								<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
									<th className="px-4 py-3">Participant</th>
									<th className="px-4 py-3">Cohort</th>
									<th className="px-4 py-3">Submitted</th>
									{survey.questions.map((q) => (
										<th key={q.id} className="px-4 py-3 font-mono normal-case" title={q.text}>{q.id}</th>
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
											{new Date(r.submitted_at).toLocaleString()}
										</td>
										{survey.questions.map((q) =>
											q.type === "longtext" ? (
												<td key={q.id} className="min-w-64 max-w-md px-4 py-3 text-ink-soft">
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
													</button>
												</td>
											) : (
												<td key={q.id} className="px-4 py-3 text-center text-ink-soft">{formatAnswer(r.answers[q.id])}</td>
											),
										)}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			)}
		</div>
	);
}

export default function AdminSurveyPage() {
	const router = useRouter();
	const surveyId = router.query.surveyId;
	const [survey, setSurvey] = useState<Survey | null>(null);
	const [responses, setResponses] = useState<AdminSurveyResponse[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>("questions");
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	useEffect(() => {
		if (!surveyId || Array.isArray(surveyId)) return;
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const [surveyData, responseData] = await Promise.all([
					getSurveyAdmin(Number(surveyId), token),
					listSurveyResponses(Number(surveyId), token),
				]);
				if (!cancelled) {
					setSurvey(surveyData);
					setResponses(responseData);
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load survey");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, [surveyId]);

	async function handleDelete() {
		if (!survey) return;
		setConfirmingDelete(false);
		setDeleteError(null);
		try {
			await deleteSurvey(survey.id, localStorage.getItem("token") ?? "");
			router.push("/admin/surveys");
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : "Failed to delete survey");
		}
	}

	if (loading || error || !survey) {
		return (
			<AdminLayout>
				{loading ? (
					<div className="flex justify-center py-16">
						<span className="text-sm text-muted">Loading…</span>
					</div>
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
				<title>{`${survey.title} — Admin`}</title>
			</Head>

			<Link href="/admin/surveys" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-brand-blue">
				<ChevronLeftIcon className="size-4" />
				All surveys
			</Link>
			<h1 className="mt-2 text-2xl font-extrabold wrap-anywhere text-ink">{survey.title}</h1>
			<p className="mt-1 text-sm text-muted">
				{SURVEY_TYPE_LABELS[survey.type]} survey · <span className="font-mono">{survey.code}</span>
			</p>

			<div role="tablist" aria-label="Survey sections" className="mt-5 flex gap-2 border-b border-gray-200">
				{tabs.map((t) => (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={tab === t.id}
						onClick={() => setTab(t.id)}
						className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
							tab === t.id ? "border-brand-blue text-brand-blue" : "border-transparent text-muted hover:text-ink"
						}`}
					>
						{t.label}
					</button>
				))}
			</div>

			{/* Both panels stay mounted so unsaved question edits survive a tab switch. */}
			<div className="mt-5" role="tabpanel" hidden={tab !== "questions"}>
				<QuestionsEditor survey={survey} responseCount={responses.length} onSaved={setSurvey} />
			</div>
			<div className="mt-5" role="tabpanel" hidden={tab !== "responses"}>
				<ResponsesView survey={survey} responses={responses} />
			</div>

			{responses.length === 0 && (
				<div className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-4">
					<div>
						<p className="text-sm font-semibold text-red-700">Danger zone</p>
						<p className="text-xs text-red-600">
							Delete this survey. Surveys can only be deleted before anyone has responded.
						</p>
					</div>
					<button
						type="button"
						onClick={() => setConfirmingDelete(true)}
						className="h-10 shrink-0 rounded-xl border border-red-300 px-4 text-sm font-bold text-red-600 hover:bg-red-100"
					>
						Delete survey
					</button>
				</div>
			)}
			{deleteError && (
				<p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600" role="alert">
					{deleteError}
				</p>
			)}

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

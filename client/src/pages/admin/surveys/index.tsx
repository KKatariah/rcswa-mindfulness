import { useEffect, useState, type FormEvent } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import AdminLayout from "@/components/admin/AdminLayout";
import SurveyExport from "@/components/admin/SurveyExport";
import Modal from "@/components/main/Modal";
import Select from "@/components/ui/Select";
import { PlusIcon } from "@/components/ui/icons";
import { createSurvey, listModulesAdmin, listSurveysAdmin } from "@/lib/api";
import { SURVEY_TYPE_LABELS } from "@/lib/surveys";
import type { AdminModule, AdminSurvey, SurveyType } from "@/types/admin";
import { weekLabel } from "@/lib/weeks";
import { adminPageTitle } from "@/lib/pageTitle";

type SurveyFormState = { title: string; code: string; type: SurveyType; module: string; copyFrom: string };

export default function AdminSurveysPage() {
	const router = useRouter();
	const [surveys, setSurveys] = useState<AdminSurvey[]>([]);
	const [modules, setModules] = useState<AdminModule[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	const [form, setForm] = useState<SurveyFormState | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const [surveyData, moduleData] = await Promise.all([listSurveysAdmin(token), listModulesAdmin(token)]);
				if (!cancelled) {
					setSurveys(surveyData);
					setModules(moduleData);
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load surveys");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, []);

	const weekOf = (moduleId: number | null) => modules.find((m) => m.id === moduleId)?.week_number;

	function openNewSurvey() {
		// Default to the next week without a survey, copying the latest survey's questions.
		const taken = new Set(surveys.map((s) => s.module));
		const nextModule = modules.find((m) => !taken.has(m.id));
		const template = surveys[surveys.length - 1];
		setForm({
			title: nextModule ? `Week ${nextModule.week_number}` : "",
			code: nextModule ? `weekly-maq-w${nextModule.week_number}` : "",
			type: "weekly",
			module: nextModule ? String(nextModule.id) : "",
			copyFrom: template ? String(template.id) : "",
		});
		setFormError(null);
		setModalOpen(true);
	}

	async function handleCreate(e: FormEvent) {
		e.preventDefault();
		if (!form) return;
		const template = surveys.find((s) => String(s.id) === form.copyFrom);
		if (!template) {
			setFormError("Choose a survey to copy the questions from.");
			return;
		}
		setFormError(null);
		setSubmitting(true);
		try {
			const token = localStorage.getItem("token") ?? "";
			const created = await createSurvey(
				{
					title: form.title,
					code: form.code,
					type: form.type,
					module: form.module ? Number(form.module) : null,
					questions: template.questions,
				},
				token,
			);
			router.push(`/admin/surveys/${created.id}`);
		} catch (err) {
			setFormError(err instanceof Error ? err.message : "Failed to create survey");
			setSubmitting(false);
		}
	}

	const inputClass =
		"h-12 rounded-xl border border-gray-200 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-brand-blue";

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle("Surveys")}</title>
			</Head>

			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-extrabold text-ink">Surveys</h1>
				<button
					type="button"
					onClick={openNewSurvey}
					disabled={loading || surveys.length === 0}
					className="flex h-11 items-center gap-2 rounded-xl bg-brand-blue px-4 text-[14px] font-bold text-white disabled:opacity-50"
				>
					<PlusIcon className="size-4" />
					New Survey
				</button>
			</div>

			<div className="mt-6 overflow-x-auto rounded-2xl border border-gray-200 bg-white">
				{loading ? (
					<div className="flex justify-center py-16">
						<span className="text-sm text-muted">Loading…</span>
					</div>
				) : error ? (
					<p className="p-6 text-sm text-red-600">{error}</p>
				) : surveys.length === 0 ? (
					<p className="p-6 text-sm text-muted">No surveys yet. Load them with the weekly_survey fixture.</p>
				) : (
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
								<th className="px-5 py-3">Title</th>
								<th className="px-5 py-3">Code</th>
								<th className="px-5 py-3">Type</th>
								<th className="px-5 py-3">Module</th>
								<th className="px-5 py-3">Questions</th>
								<th className="px-5 py-3">Responses</th>
							</tr>
						</thead>
						<tbody>
							{surveys.map((s) => (
								<tr
									key={s.id}
									onClick={() => router.push(`/admin/surveys/${s.id}`)}
									className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-surface-muted"
								>
									<td className="px-5 py-3 font-semibold text-ink">{s.title}</td>
									<td className="px-5 py-3 font-mono text-xs text-ink-soft">{s.code}</td>
									<td className="px-5 py-3 text-ink-soft">{SURVEY_TYPE_LABELS[s.type]}</td>
									<td className="px-5 py-3 text-ink-soft">
										{s.module ? weekOf(s.module) === undefined ? "Week ?" : weekLabel(weekOf(s.module)!) : "—"}
									</td>
									<td className="px-5 py-3 text-ink-soft">{s.questions.length}</td>
									<td className="px-5 py-3 text-ink-soft">{s.response_count}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{!loading && !error && surveys.length > 0 && (
				<div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
					<SurveyExport surveys={surveys} />
				</div>
			)}

			<Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="New Survey">
				{form && (
					<form onSubmit={handleCreate} className="flex flex-col gap-4">
						{formError && <p className="text-sm text-red-600" role="alert">{formError}</p>}

						<div className="flex flex-col gap-2">
							<label htmlFor="survey-title" className="text-sm font-semibold text-ink">Title</label>
							<input
								id="survey-title"
								required
								value={form.title}
								onChange={(e) => setForm((f) => f && { ...f, title: e.target.value })}
								className={inputClass}
							/>
						</div>

						<div className="flex flex-col gap-2">
							<label htmlFor="survey-code" className="text-sm font-semibold text-ink">
								Code <span className="font-normal text-muted">(unique; used in the CSV export)</span>
							</label>
							<input
								id="survey-code"
								required
								value={form.code}
								onChange={(e) => setForm((f) => f && { ...f, code: e.target.value })}
								className={`${inputClass} font-mono`}
							/>
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="flex flex-col gap-2">
								<label htmlFor="survey-type" className="text-sm font-semibold text-ink">Type</label>
								<Select
									id="survey-type"
									value={form.type}
									onChange={(v) => setForm((f) => f && { ...f, type: v as SurveyType })}
									options={Object.entries(SURVEY_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
									className="h-12"
								/>
							</div>
							<div className="flex flex-col gap-2">
								<label htmlFor="survey-module" className="text-sm font-semibold text-ink">Module</label>
								<Select
									id="survey-module"
									value={form.module}
									onChange={(v) => setForm((f) => f && { ...f, module: v })}
									options={[
										{ value: "", label: "None" },
										...modules.map((m) => ({ value: String(m.id), label: `${weekLabel(m.week_number)}: ${m.title}` })),
									]}
									className="h-12"
								/>
							</div>
						</div>

						<div className="flex flex-col gap-2">
							<label htmlFor="survey-copy" className="text-sm font-semibold text-ink">Copy questions from</label>
							<Select
								id="survey-copy"
								value={form.copyFrom}
								onChange={(v) => setForm((f) => f && { ...f, copyFrom: v })}
								options={surveys.map((s) => ({ value: String(s.id), label: s.title }))}
								className="h-12"
							/>
							<p className="text-xs text-muted">You can edit the wording after the survey is created.</p>
						</div>

						<button
							type="submit"
							disabled={submitting}
							className="h-12 rounded-xl bg-brand-blue-dark text-[15px] font-bold text-white disabled:opacity-50"
						>
							{submitting ? "Saving…" : "Create"}
						</button>
					</form>
				)}
			</Modal>
		</AdminLayout>
	);
}

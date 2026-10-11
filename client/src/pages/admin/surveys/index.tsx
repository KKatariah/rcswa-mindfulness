import { useState, type FormEvent } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminPageHeader, { CreateButton } from "@/components/admin/AdminPageHeader";
import AdminTable from "@/components/admin/AdminTable";
import SurveyExport from "@/components/admin/SurveyExport";
import Modal from "@/components/main/Modal";
import Card from "@/components/ui/Card";
import { Field, FormActions, FormError, TextField } from "@/components/ui/form";
import Select from "@/components/ui/Select";
import { useAsync } from "@/hooks/useAsync";
import { createSurvey, listModulesAdmin, listSurveysAdmin } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { SURVEY_TYPE_LABELS } from "@/lib/surveys";
import { weekLabel } from "@/lib/weeks";
import type { AdminModule, AdminSurvey, SurveyType } from "@/types/admin";
import { adminPageTitle } from "@/lib/pageTitle";

type SurveyFormState = { title: string; code: string; type: SurveyType; module: string; copyFrom: string };

export default function AdminSurveysPage() {
	const router = useRouter();
	const surveysState = useAsync(listSurveysAdmin, [], [] as AdminSurvey[], { errorFallback: "Failed to load surveys" });
	const modulesState = useAsync(listModulesAdmin, [], [] as AdminModule[], { errorFallback: "Failed to load surveys" });
	const surveys = surveysState.data;
	const modules = modulesState.data;
	const loading = surveysState.loading || modulesState.loading;
	const error = surveysState.error ?? modulesState.error;
	const [modalOpen, setModalOpen] = useState(false);
	const [form, setForm] = useState<SurveyFormState | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

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
			const created = await createSurvey({
				title: form.title,
				code: form.code,
				type: form.type,
				module: form.module ? Number(form.module) : null,
				questions: template.questions,
			});
			// Stays "submitting" while the editor loads, so the form can't be sent twice.
			router.push(`/admin/surveys/${created.id}`);
		} catch (err) {
			setFormError(errorMessage(err, "Failed to create survey"));
			setSubmitting(false);
		}
	}

	return (
		<AdminLayout>
			<Head>
				<title>{adminPageTitle("Surveys")}</title>
			</Head>

			<AdminPageHeader title="Surveys">
				<CreateButton onClick={openNewSurvey} disabled={loading || surveys.length === 0}>
					New Survey
				</CreateButton>
			</AdminPageHeader>

			<AdminTable
				columns={["Title", "Code", "Type", "Module", "Questions", "Responses"]}
				scrollLabel="Surveys"
				loading={loading}
				error={error}
				empty={surveys.length === 0}
				emptyMessage="No surveys yet. Load them with the weekly_survey fixture."
			>
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
			</AdminTable>

			{!loading && !error && surveys.length > 0 && (
				<Card className="mt-6 p-5">
					<SurveyExport surveys={surveys} />
				</Card>
			)}

			<Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="New Survey">
				{form && (
					<form onSubmit={handleCreate} className="flex flex-col gap-4">
						<FormError message={formError} />

						<TextField
							id="survey-title"
							label="Title"
							required
							value={form.title}
							onChange={(e) => setForm((f) => f && { ...f, title: e.target.value })}
						/>

						<TextField
							id="survey-code"
							label={
								<>
									Code <span className="font-normal text-muted">(unique; used in the CSV export)</span>
								</>
							}
							required
							value={form.code}
							onChange={(e) => setForm((f) => f && { ...f, code: e.target.value })}
							className="font-mono"
						/>

						<div className="grid gap-4 sm:grid-cols-2">
							<Field id="survey-type" label="Type">
								<Select
									id="survey-type"
									value={form.type}
									onChange={(v) => setForm((f) => f && { ...f, type: v as SurveyType })}
									options={Object.entries(SURVEY_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
									className="h-12"
								/>
							</Field>
							<Field id="survey-module" label="Module">
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
							</Field>
						</div>

						<Field id="survey-copy" label="Copy questions from">
							<Select
								id="survey-copy"
								value={form.copyFrom}
								onChange={(v) => setForm((f) => f && { ...f, copyFrom: v })}
								options={surveys.map((s) => ({ value: String(s.id), label: s.title }))}
								className="h-12"
							/>
							<p className="text-xs text-muted">You can edit the wording after the survey is created.</p>
						</Field>

						<FormActions submitting={submitting} submitLabel="Create" className="" />
					</form>
				)}
			</Modal>
		</AdminLayout>
	);
}

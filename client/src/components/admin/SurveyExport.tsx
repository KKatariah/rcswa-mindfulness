import { useState } from "react";
import Select from "@/components/ui/Select";
import { downloadSurveyResponsesCsv } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

type Props =
	// Lets the admin pick one survey or all of them.
	| { surveys: { id: number; title: string }[]; surveyId?: never }
	// Exports one fixed survey.
	| { surveyId: number; surveys?: never };

export default function SurveyExport(props: Props) {
	const [selectedId, setSelectedId] = useState("");
	const [includeIdentity, setIncludeIdentity] = useState(false);
	const [downloading, setDownloading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleDownload() {
		setDownloading(true);
		setError(null);
		try {
			await downloadSurveyResponsesCsv({
				surveyId: props.surveyId ?? (selectedId ? Number(selectedId) : undefined),
				includeIdentity,
			});
		} catch (e) {
			setError(errorMessage(e, "Export failed"));
		} finally {
			setDownloading(false);
		}
	}

	return (
		<div>
			<h2 className="text-sm font-bold text-ink">Export responses</h2>
			<div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
				{props.surveys && (
					<Select
						id="export-survey"
						value={selectedId}
						onChange={setSelectedId}
						options={[
							{ value: "", label: "All surveys" },
							...props.surveys.map((s) => ({ value: String(s.id), label: s.title })),
						]}
						className="h-11 sm:w-64"
					/>
				)}
				<label className="flex items-center gap-2 text-sm text-ink">
					<input
						type="checkbox"
						checked={includeIdentity}
						onChange={(e) => setIncludeIdentity(e.target.checked)}
						className="size-4 accent-brand-blue"
					/>
					Include names and emails
				</label>
				<button
					type="button"
					onClick={handleDownload}
					disabled={downloading}
					className="h-11 rounded-xl bg-brand-blue px-4 text-[14px] font-bold text-white disabled:opacity-50 sm:ml-auto"
				>
					{downloading ? "Preparing…" : "Download CSV"}
				</button>
			</div>
			<p className="mt-2 text-xs text-muted">
				Participants are identified by ID unless names and emails are included. Treat the file as confidential research data.
			</p>
			{error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
		</div>
	);
}

import type { SurveyQuestion, SurveyType } from "@/types/admin";

export const SURVEY_TYPE_LABELS: Record<SurveyType, string> = {
	intake: "Intake",
	weekly: "Weekly",
	end: "End",
	followup: "Follow-up",
};

/** Short description of how a question is answered, e.g. "Scale 0–6 (Never → Always)". */
export function describeAnswerFormat(q: SurveyQuestion): string {
	if (q.type === "integer") return q.unit ? `Number (${q.unit})` : "Number";
	if (q.type === "likert") {
		const lo = q.scale_labels?.[String(q.min)];
		const hi = q.scale_labels?.[String(q.max)];
		return `Scale ${q.min}–${q.max}${lo && hi ? ` (${lo} → ${hi})` : ""}`;
	}
	return "Free text";
}

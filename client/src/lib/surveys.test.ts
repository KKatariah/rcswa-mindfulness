import { describe, expect, it } from "vitest";
import { describeAnswerFormat, SURVEY_TYPE_LABELS } from "@/lib/surveys";
import type { SurveyQuestion } from "@/types/admin";

const question = (q: Partial<SurveyQuestion>): SurveyQuestion => ({ id: "q1", text: "?", type: "longtext", ...q });

describe("describeAnswerFormat", () => {
	it("describes numbers, with their unit when there is one", () => {
		expect(describeAnswerFormat(question({ type: "integer" }))).toBe("Number");
		expect(describeAnswerFormat(question({ type: "integer", unit: "minutes" }))).toBe("Number (minutes)");
	});

	it("describes a Likert scale with its end labels", () => {
		const q = question({ type: "likert", min: 0, max: 6, scale_labels: { "0": "Never", "6": "Always" } });
		expect(describeAnswerFormat(q)).toBe("Scale 0–6 (Never → Always)");
	});

	it("leaves the labels off a Likert scale missing either end label", () => {
		expect(describeAnswerFormat(question({ type: "likert", min: 1, max: 5 }))).toBe("Scale 1–5");
		const oneEnd = question({ type: "likert", min: 1, max: 5, scale_labels: { "1": "Low" } });
		expect(describeAnswerFormat(oneEnd)).toBe("Scale 1–5");
	});

	it("describes free-text questions", () => {
		expect(describeAnswerFormat(question({ type: "longtext" }))).toBe("Free text");
	});
});

describe("SURVEY_TYPE_LABELS", () => {
	it("has a label for every survey type", () => {
		expect(SURVEY_TYPE_LABELS).toEqual({ intake: "Intake", weekly: "Weekly", end: "End", followup: "Follow-up" });
	});
});

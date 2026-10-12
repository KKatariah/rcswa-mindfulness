import { describe, expect, it } from "vitest";
import { hasMisplacedSkipRule } from "./[surveyId]";
import type { SurveyQuestion } from "@/types/admin";

const q1: SurveyQuestion = { id: "q1", type: "integer", text: "How many?" };
const q2: SurveyQuestion = {
	id: "q2",
	type: "likert",
	text: "How focused?",
	min: 0,
	max: 6,
	skip_if: { question_id: "q1", value: 0 },
};
const q3: SurveyQuestion = { id: "q3", type: "longtext", text: "Reflect." };

// A second question with its own skip rule pointing to q3.
const q4: SurveyQuestion = {
	id: "q4",
	type: "integer",
	text: "Count.",
	skip_if: { question_id: "q3", value: 0 },
};

describe("hasMisplacedSkipRule — disabled-save guard", () => {
	it("returns false when the skip target comes before its dependent", () => {
		// q1 → q2 (skip_if q1): correct order
		expect(hasMisplacedSkipRule([q1, q2, q3])).toBe(false);
	});

	it("returns true when the skip target is dragged below its dependent", () => {
		// q2 (skip_if q1) is now ABOVE q1: invalid
		expect(hasMisplacedSkipRule([q2, q1, q3])).toBe(true);
	});

	it("returns false when no questions have skip rules", () => {
		expect(hasMisplacedSkipRule([q1, q3])).toBe(false);
	});

	it("returns false for an empty list", () => {
		expect(hasMisplacedSkipRule([])).toBe(false);
	});

	it("returns true in a two-question list when skip target comes second", () => {
		expect(hasMisplacedSkipRule([q2, q1])).toBe(true);
	});

	it("returns false once the order is restored", () => {
		expect(hasMisplacedSkipRule([q1, q2])).toBe(false);
	});

	it("returns true when the referenced question doesn't appear at all", () => {
		// q2 skips based on q1, but q1 is absent from the list
		expect(hasMisplacedSkipRule([q2, q3])).toBe(true);
	});

	it("returns true when any one of multiple skip rules is misplaced", () => {
		// [q3, q4, q1, q2]: q4 skip_if q3 — q3 comes before q4 so that's fine;
		// q2 skip_if q1 — q1 comes after q2, so this is misplaced.
		expect(hasMisplacedSkipRule([q3, q4, q1, q2])).toBe(false); // q3 before q4 ✓; q1 before q2 ✓
		expect(hasMisplacedSkipRule([q3, q2, q1, q4])).toBe(true);  // q2 skip_if q1, q1 is after q2
	});
});

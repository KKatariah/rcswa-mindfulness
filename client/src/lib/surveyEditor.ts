import type { SurveyQuestion } from "@/types/admin";

/** Returns true if any question's skip_if target comes at or after that question in the list. */
export function hasMisplacedSkipRule(questions: SurveyQuestion[]): boolean {
	return questions.some((q, index) => {
		if (!q.skip_if) return false;
		return !questions.slice(0, index).some(e => e.id === q.skip_if!.question_id);
	});
}

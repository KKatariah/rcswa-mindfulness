import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SurveyQuestions from "@/components/surveys/SurveyQuestions";
import type { SurveyQuestion } from "@/types/admin";

const scale = (n: number, text: string, extra: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
	id: `q${n}`,
	type: "likert",
	text,
	min: 0,
	max: 6,
	scale_labels: { "0": "Never", "6": "Always" },
	...extra,
});
const skipIfNoPractice = { skip_if: { question_id: "q1", value: 0 } };

/** Same shape as the standard weekly survey (app/survey_template.py). */
const STANDARD: SurveyQuestion[] = [
	{ id: "q1", type: "integer", text: "Times meditated?", unit: "times", section: "About your formal practice" },
	{ id: "q2", type: "integer", text: "Minutes per session?", unit: "minutes", ...skipIfNoPractice },
	...[3, 4, 5, 6].map((n) => scale(n, `Formal ${n}`, skipIfNoPractice)),
	scale(7, "Informal 7", { section: "About your informal practice" }),
	...[8, 9, 10, 11, 12].map((n) => scale(n, `Informal ${n}`)),
	{
		id: "q13",
		type: "longtext",
		text: "How are you feeling this week? What has been your experience with the mindfulness intervention this week?",
	},
];

function renderSurvey(props: Partial<Parameters<typeof SurveyQuestions>[0]> = {}) {
	const onSubmit = vi.fn();
	render(<SurveyQuestions questions={STANDARD} onSubmit={onSubmit} {...props} />);
	return { onSubmit, user: userEvent.setup() };
}

/** The radio for `value` on the scale question numbered `n`. */
const rating = (n: number, value: number) =>
	document.querySelector<HTMLInputElement>(`input[name="question-${n}"][value="${value}"]`)!;
const journal = () => screen.getByPlaceholderText("Enter reflection...");

describe("SurveyQuestions", () => {
	it("shows two number questions and ten 0–6 rating questions", () => {
		renderSurvey();
		expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
		expect(screen.getAllByRole("group")).toHaveLength(10);
		for (const group of screen.getAllByRole("group")) {
			expect(within(group).getAllByRole("radio")).toHaveLength(7);
		}
	});

	it("submits every answer keyed by question id", async () => {
		const { onSubmit, user } = renderSurvey();
		const [times, minutes] = screen.getAllByRole("spinbutton");
		await user.type(times, "5");
		await user.type(minutes, "20");
		await user.click(rating(3, 4));
		await user.click(rating(12, 6));
		await user.type(journal(), "Calmer this week.");

		await user.click(screen.getByRole("button", { name: "Submit survey" }));

		expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ q1: 5, q2: 20, q3: 4, q12: 6, q13: "Calmer this week." });
	});

	it("can be submitted having done no meditation, skipping questions 2–6", async () => {
		const { onSubmit, user } = renderSurvey();
		await user.click(rating(3, 2));
		await user.type(screen.getAllByRole("spinbutton")[0], "0");
		expect(screen.getAllByRole("spinbutton")[1]).toBeDisabled();
		expect(rating(4, 1)).toBeDisabled();
		await user.click(rating(7, 3));

		await user.click(screen.getByRole("button", { name: "Submit survey" }));

		// The rating given before q1 was set to 0 is dropped along with the skipped questions.
		expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ q1: 0, q7: 3 });
	});

	it("keeps one rating per question", async () => {
		const { onSubmit, user } = renderSurvey();
		await user.click(rating(5, 1));
		await user.click(rating(5, 5));
		expect(rating(5, 1)).not.toBeChecked();
		expect(rating(5, 5)).toBeChecked();

		await user.click(screen.getByRole("button", { name: "Submit survey" }));
		expect(onSubmit.mock.calls[0][0]).toEqual({ q5: 5 });
	});

	it("doesn't submit twice while a submission is in progress", async () => {
		const { onSubmit, user } = renderSurvey({ isSubmitting: true });
		const submit = screen.getByRole("button", { name: "Submitting..." });
		expect(submit).toBeDisabled();
		await user.click(submit);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("counts journal words as they're typed", async () => {
		const { user } = renderSurvey();
		expect(journal()).toHaveAccessibleDescription("0 words (aim for 100-250)");
		await user.type(journal(), "one");
		expect(journal()).toHaveAccessibleDescription("1 word (aim for 100-250)");
		await user.type(journal(), "  two\nthree ");
		expect(journal()).toHaveAccessibleDescription("3 words (aim for 100-250)");
	});

	it("caps the journal at the server's 5000-character limit", () => {
		renderSurvey();
		expect(journal()).toHaveAttribute("maxlength", "5000");
	});

	describe("clearing selections", () => {
		it("is only offered once a rating has been chosen", async () => {
			const { user } = renderSurvey();
			const clear = screen.getByRole("button", { name: "Clear selections" });
			expect(clear).toBeDisabled();
			await user.click(rating(3, 2));
			expect(clear).toBeEnabled();
		});

		it("asks first, then clears only the ratings", async () => {
			const { onSubmit, user } = renderSurvey();
			await user.type(screen.getAllByRole("spinbutton")[0], "3");
			await user.click(rating(3, 2));
			await user.click(rating(9, 4));
			await user.type(journal(), "Keep me");

			await user.click(screen.getByRole("button", { name: "Clear selections" }));
			const confirm = screen.getByRole("alertdialog", { name: "Clear selections?" });
			await user.click(within(confirm).getByRole("button", { name: "Clear" }));

			expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
			expect(rating(3, 2)).not.toBeChecked();
			expect(rating(9, 4)).not.toBeChecked();
			await user.click(screen.getByRole("button", { name: "Submit survey" }));
			expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ q1: 3, q13: "Keep me" });
		});

		it("keeps the ratings if the user cancels", async () => {
			const { user } = renderSurvey();
			await user.click(rating(4, 6));
			await user.click(screen.getByRole("button", { name: "Clear selections" }));
			await user.keyboard("{Escape}");
			expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
			expect(rating(4, 6)).toBeChecked();
		});
	});

	describe("survey-defined questions", () => {
		it("uses the survey's own question and section text", () => {
			renderSurvey();
			expect(screen.getByText(/^1\. Times meditated\?/)).toBeInTheDocument();
			expect(screen.getByRole("heading", { name: "About your formal practice" })).toBeInTheDocument();
			expect(screen.getByRole("heading", { name: "About your informal practice" })).toBeInTheDocument();
			expect(screen.getByRole("group", { name: /Formal 3$/ })).toBeInTheDocument();
		});

		it("explains the skip rule under the question that triggers it", () => {
			renderSurvey();
			expect(screen.getByText(/If you answer 0 to question 1, skip to question 7\./)).toBeInTheDocument();
		});

		it("lists each question in the journal prompt separately", () => {
			renderSurvey();
			expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
				"How are you feeling this week?",
				"What has been your experience with the mindfulness intervention this week?",
			]);
		});

		it("sizes each rating scale from the question's range", () => {
			renderSurvey({ questions: [scale(1, "Five point", { min: 1, max: 5 })] });
			expect(within(screen.getByRole("group")).getAllByRole("radio")).toHaveLength(5);
		});
	});
});

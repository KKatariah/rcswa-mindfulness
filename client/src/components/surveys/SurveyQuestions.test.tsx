import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SurveyQuestions from "@/components/surveys/SurveyQuestions";

function renderSurvey(props: Partial<Parameters<typeof SurveyQuestions>[0]> = {}) {
	const onSubmit = vi.fn();
	render(<SurveyQuestions onSubmit={onSubmit} {...props} />);
	return { onSubmit, user: userEvent.setup() };
}

/** The radio for `value` on scale question `id`. */
const rating = (id: number, value: number) =>
	document.querySelector<HTMLInputElement>(`input[name="question-${id}"][value="${value}"]`)!;

describe("SurveyQuestions", () => {
	it("shows two number questions and ten 0–6 rating questions", () => {
		renderSurvey();
		expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
		expect(screen.getAllByRole("group")).toHaveLength(10);
		for (const group of screen.getAllByRole("group")) {
			expect(within(group).getAllByRole("radio")).toHaveLength(7);
		}
	});

	it("submits every answer keyed by question number", async () => {
		const { onSubmit, user } = renderSurvey();
		const [times, minutes] = screen.getAllByRole("spinbutton");
		await user.type(times, "5");
		await user.type(minutes, "20");
		await user.click(rating(3, 4));
		await user.click(rating(12, 6));
		await user.type(screen.getByPlaceholderText("Enter reflection..."), "Calmer this week.");

		await user.click(screen.getByRole("button", { name: "Submit survey" }));

		expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ 1: 5, 2: 20, 3: 4, 12: 6, 13: "Calmer this week." });
	});

	it("can be submitted having done no meditation, skipping questions 2–6", async () => {
		const { onSubmit, user } = renderSurvey();
		await user.type(screen.getAllByRole("spinbutton")[0], "0");
		await user.click(rating(7, 3));

		await user.click(screen.getByRole("button", { name: "Submit survey" }));

		expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ 1: 0, 7: 3 });
	});

	it("keeps one rating per question", async () => {
		const { onSubmit, user } = renderSurvey();
		await user.click(rating(5, 1));
		await user.click(rating(5, 5));
		expect(rating(5, 1)).not.toBeChecked();
		expect(rating(5, 5)).toBeChecked();

		await user.click(screen.getByRole("button", { name: "Submit survey" }));
		expect(onSubmit.mock.calls[0][0]).toEqual({ 5: 5 });
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
		const journal = screen.getByRole("textbox", { name: "Reflective Journal" });
		expect(journal).toHaveAccessibleDescription("0 words (aim for 100-250)");
		await user.type(journal, "one");
		expect(journal).toHaveAccessibleDescription("1 word (aim for 100-250)");
		await user.type(journal, "  two\nthree ");
		expect(journal).toHaveAccessibleDescription("3 words (aim for 100-250)");
	});

	it("caps the journal at the server's 5000-character limit", () => {
		renderSurvey();
		expect(screen.getByRole("textbox", { name: "Reflective Journal" })).toHaveAttribute("maxlength", "5000");
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
			await user.type(screen.getByPlaceholderText("Enter reflection..."), "Keep me");

			await user.click(screen.getByRole("button", { name: "Clear selections" }));
			const confirm = screen.getByRole("alertdialog", { name: "Clear selections?" });
			await user.click(within(confirm).getByRole("button", { name: "Clear" }));

			expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
			expect(rating(3, 2)).not.toBeChecked();
			expect(rating(9, 4)).not.toBeChecked();
			await user.click(screen.getByRole("button", { name: "Submit survey" }));
			expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ 1: 3, 13: "Keep me" });
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

	describe("admin-edited wording", () => {
		it("uses the survey's own question and section text", () => {
			renderSurvey({
				questionText: { 1: "Sessions this week?", 2: "Minutes per session?" },
				sectionText: { 1: "About your sitting practice", 7: "About everyday mindfulness" },
				formalQuestions: [{ id: 3, text: "Custom focus question" }],
			});
			expect(screen.getByText("1. Sessions this week?")).toBeInTheDocument();
			expect(screen.getByText("2. Minutes per session?")).toBeInTheDocument();
			expect(screen.getByRole("heading", { name: "About your sitting practice" })).toBeInTheDocument();
			expect(screen.getByRole("heading", { name: "About everyday mindfulness" })).toBeInTheDocument();
			expect(screen.getByRole("group", { name: /Custom focus question$/ })).toBeInTheDocument();
		});

		it("lists each question in the journal prompt separately", () => {
			renderSurvey({ questionText: { 13: "How was your week? What did you notice? Anything else" } });
			const prompts = screen.getAllByRole("listitem").map((item) => item.textContent);
			expect(prompts).toEqual(["How was your week?", "What did you notice?", "Anything else"]);
		});

		it("falls back to the standard journal prompts", () => {
			renderSurvey();
			expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
				"How are you feeling this week?",
				"What has been your experience with the mindfulness intervention this week?",
			]);
		});
	});
});

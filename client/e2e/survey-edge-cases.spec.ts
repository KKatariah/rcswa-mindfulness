import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { ADMIN, API, apiToken, loginAs, OTHER } from "./helpers";

// Each test builds its own follow-up survey (no module, so always unlocked) through the API,
// so tests don't depend on each other or on the seeded weekly surveys.

const READER = "reader@e2e.local";

type Question = Record<string, unknown> & { id: string; type: string; text: string };

const COUNT: Question = { id: "q1", type: "integer", text: "How many sessions?", unit: "times" };
const FOCUS: Question = {
	id: "q2", type: "likert", text: "How focused were you?", min: 1, max: 5,
	scale_labels: { "1": "Not at all", "5": "Completely" }, skip_if: { question_id: "q1", value: 0 },
};
const REFLECT: Question = { id: "q3", type: "longtext", text: "Anything else?" };

let counter = 0;

async function createSurvey(request: APIRequestContext, questions: Question[]): Promise<number> {
	const token = await apiToken(request, ADMIN);
	const res = await request.post(`${API}/surveys/`, {
		headers: { Authorization: `Token ${token}` },
		data: { code: `edge-${Date.now()}-${counter++}`, title: "Edge survey", type: "followup", module: null, questions },
	});
	if (!res.ok()) throw new Error(`create survey failed: ${await res.text()}`);
	return (await res.json()).id;
}

async function respond(request: APIRequestContext, surveyId: number, answers: Record<string, unknown>) {
	const token = await apiToken(request, OTHER);
	const res = await request.post(`${API}/survey-responses/`, {
		headers: { Authorization: `Token ${token}` },
		data: { survey: surveyId, answers },
	});
	if (!res.ok()) throw new Error(`respond failed: ${await res.text()}`);
}

async function savedQuestions(request: APIRequestContext, surveyId: number): Promise<Question[]> {
	const token = await apiToken(request, ADMIN);
	const res = await request.get(`${API}/surveys/${surveyId}/`, { headers: { Authorization: `Token ${token}` } });
	return (await res.json()).questions;
}

/** Save, confirming the prompt shown when the survey already has responses. */
async function save(page: Page) {
	await page.getByRole("button", { name: "Save changes" }).click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog.or(page.getByRole("status")).or(page.locator("p[role=alert]:not(#__next-route-announcer__)"))).toBeVisible();
	if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Save changes" }).click();
}

/**
 * Pick an option from the custom Select. It closes on any scroll, so centre the trigger first:
 * otherwise the sticky save bar can cover it and Playwright's retry scroll shuts the menu.
 */
async function choose(page: Page, trigger: Locator, option: string) {
	await trigger.evaluate((el) => el.scrollIntoView({ block: "center" }));
	await page.waitForTimeout(100);
	await trigger.click();
	await page.getByRole("option", { name: option, exact: true }).click();
}

const card = (page: Page, id: string) => page.locator(`[data-reorder-id="${id}"]`);

// ── Participant form ──────────────────────────────────────────────────────────

test.describe("participant form", () => {
	test("a 1–5 scale offers exactly 1 to 5, with the labels in the hint", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, FOCUS, REFLECT]);
		await loginAs(page, request, READER);
		await page.goto(`/surveys/${id}`);
		const radios = page.locator('input[name="question-2"]');
		await expect(radios).toHaveCount(5);
		await expect(radios.first()).toHaveAttribute("value", "1");
		await expect(radios.last()).toHaveAttribute("value", "5");
		await expect(page.getByText(/\(1 - not at all, 5 - completely\)/)).toBeVisible();
		await expect(page.getByText("If you answer 0 to question 1, skip to question 3.")).toBeVisible();
	});

	test("answers to skipped questions are disabled and not sent", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, FOCUS, REFLECT]);
		await loginAs(page, request, READER);
		await page.goto(`/surveys/${id}`);
		const count = page.getByRole("spinbutton");
		await count.fill("2");
		await page.locator('input[name="question-2"][value="4"]').check();
		await count.fill("0");
		await expect(page.locator('input[name="question-2"]').first()).toBeDisabled();
		await page.getByPlaceholder("Enter reflection...").fill("Quiet week.");

		const sent = page.waitForRequest((r) => r.url().includes("/survey-responses/") && r.method() === "POST");
		await page.getByRole("button", { name: "Submit survey" }).click();
		expect((await sent).postDataJSON().answers).toEqual({ q1: 0, q3: "Quiet week." });
		await expect(page.getByRole("status")).toContainText(/survey has been submitted/i);
	});

	test("clearing a number box removes the answer instead of sending 0", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, REFLECT]);
		await loginAs(page, request, READER);
		await page.goto(`/surveys/${id}`);
		await page.getByRole("spinbutton").fill("3");
		await page.getByRole("spinbutton").fill("");
		await page.getByPlaceholder("Enter reflection...").fill("Hi.");
		await page.getByRole("button", { name: "Submit survey" }).click();
		await expect(page.getByRole("dialog")).toContainText("'q1' is required");
	});

	test("a free-text-only survey with its own heading isn't styled as the journal", async ({ page, request }) => {
		const id = await createSurvey(request, [{ ...REFLECT, section: "Final thoughts" }]);
		await loginAs(page, request, READER);
		await page.goto(`/surveys/${id}`);
		await expect(page.getByRole("heading", { name: "Final thoughts" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "Reflective Journal" })).toHaveCount(0);
		await expect(page.getByText(/aim for 100-250/)).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Clear selections" })).toHaveCount(0);
	});

	test("questions show in the saved order and are numbered by position", async ({ page, request }) => {
		const id = await createSurvey(request, [REFLECT, COUNT]);
		await loginAs(page, request, READER);
		await page.goto(`/surveys/${id}`);
		await expect(page.getByText("2. How many sessions?")).toBeVisible();
	});
});

// ── Admin editor ──────────────────────────────────────────────────────────────

test.describe("admin editor", () => {
	test("removing a skip trigger clears the rule that depended on it", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, FOCUS, REFLECT]);
		await loginAs(page, request, ADMIN);
		await page.goto(`/admin/surveys/${id}`);
		await expect(card(page, "q2").locator("#skip-q2")).toHaveText("Question 1 (q1)");
		await page.getByRole("button", { name: "Remove question q1" }).click();
		await save(page);
		await expect(page.getByRole("status")).toHaveText("Saved.");
		expect((await savedQuestions(request, id))[0]).not.toHaveProperty("skip_if");
	});

	test("making a skip trigger free text clears the rules that depended on it", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, FOCUS, REFLECT]);
		await loginAs(page, request, ADMIN);
		await page.goto(`/admin/surveys/${id}`);
		await choose(page, card(page, "q1").locator("#type-q1"), "Free text");
		// With no number or rating question above it, there's no rule left to offer.
		await expect(card(page, "q2").locator("#skip-q2")).toHaveCount(0);
		await save(page);
		await expect(page.getByRole("status")).toHaveText("Saved.");
		expect((await savedQuestions(request, id))[1]).not.toHaveProperty("skip_if");
	});

	test("the last remaining question can't be removed", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, REFLECT]);
		await loginAs(page, request, ADMIN);
		await page.goto(`/admin/surveys/${id}`);
		await page.getByRole("button", { name: "Remove question q1" }).click();
		await expect(page.getByRole("button", { name: "Remove question q3" })).toBeDisabled();
	});

	test("discard undoes adds, removals, reorders and type changes", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, FOCUS, REFLECT]);
		await loginAs(page, request, ADMIN);
		await page.goto(`/admin/surveys/${id}`);
		await page.getByRole("button", { name: "Remove question q2" }).click();
		await page.getByRole("button", { name: "Number" }).click();
		await page.getByRole("button", { name: "Move question 1" }).focus();
		await page.keyboard.press("ArrowDown");
		await choose(page, card(page, "q3").locator("#type-q3"), "Rating scale");
		await page.getByRole("button", { name: "Discard" }).click();
		await expect(page.locator("[data-reorder-id]")).toHaveCount(3);
		const ids = await page.locator("[data-reorder-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-reorder-id")));
		expect(ids).toEqual(["q1", "q2", "q3"]);
		await expect(card(page, "q3").locator("#type-q3")).toHaveText("Free text");
		await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
	});

	test("switching type and back before saving restores the scale and needs no new id", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, FOCUS, REFLECT]);
		await respond(request, id, { q1: 2, q2: 4, q3: "Fine" });
		await loginAs(page, request, ADMIN);
		await page.goto(`/admin/surveys/${id}`);
		const focus = card(page, "q2");
		await choose(page, focus.locator("#type-q2"), "Free text");
		await expect(focus.getByText(/will be kept with the old version/)).toBeVisible();
		await choose(page, focus.locator("#type-q2"), "Rating scale");
		await expect(focus.getByText(/will be kept with the old version/)).toHaveCount(0);
		await expect(focus.getByLabel("Highest")).toHaveValue("5");
		await expect(focus.getByLabel("Label for 5")).toHaveValue("Completely");
		await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
	});

	test("an answered, removed id isn't reused for a new question", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, FOCUS, REFLECT]);
		await respond(request, id, { q1: 2, q2: 4, q3: "Fine" });
		await loginAs(page, request, ADMIN);
		await page.goto(`/admin/surveys/${id}`);
		await page.getByRole("button", { name: "Remove question q3" }).click();
		await save(page);
		await expect(page.getByRole("status")).toHaveText("Saved.");
		await page.getByRole("button", { name: "Free text" }).click();
		await expect(page.locator("[data-reorder-id]").last()).toHaveAttribute("data-reorder-id", "q4");
	});

	test("retyping an answered skip trigger moves its dependents' rules to the new id", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, FOCUS, REFLECT]);
		await respond(request, id, { q1: 2, q2: 4, q3: "Fine" });
		await loginAs(page, request, ADMIN);
		await page.goto(`/admin/surveys/${id}`);
		await choose(page, card(page, "q1").locator("#type-q1"), "Rating scale");
		await save(page);
		await expect(page.getByRole("status")).toHaveText("Saved.");
		const [first, second] = await savedQuestions(request, id);
		expect(first).toMatchObject({ id: "q4", type: "likert" });
		expect(second.skip_if).toEqual({ question_id: "q4", value: 0 });
	});

	test("retyping a question nobody has answered keeps its id", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, FOCUS, REFLECT]);
		await loginAs(page, request, ADMIN);
		await page.goto(`/admin/surveys/${id}`);
		await choose(page, card(page, "q3").locator("#type-q3"), "Number");
		await expect(card(page, "q3").getByText(/will be kept with the old version/)).toHaveCount(0);
		await save(page);
		await expect(page.getByRole("status")).toHaveText("Saved.");
		expect((await savedQuestions(request, id))[2]).toMatchObject({ id: "q3", type: "integer" });
	});

	test("moving a skip trigger below its dependent warns, and the server refuses to save", async ({ page, request }) => {
		const id = await createSurvey(request, [COUNT, FOCUS, REFLECT]);
		await loginAs(page, request, ADMIN);
		await page.goto(`/admin/surveys/${id}`);
		await page.getByRole("button", { name: "Move question 1" }).focus();
		await page.keyboard.press("ArrowDown");
		await expect(card(page, "q2").getByText(/depends on is now below it/)).toBeVisible();
		await save(page);
		await expect(page.locator("p[role=alert]:not(#__next-route-announcer__)")).toContainText("skip_if");
	});

	test("custom scale bounds re-key the end labels, and clearing a bound doesn't break it", async ({ page, request }) => {
		const id = await createSurvey(request, [FOCUS, REFLECT].map((q) => ({ ...q, skip_if: undefined })));
		await loginAs(page, request, ADMIN);
		await page.goto(`/admin/surveys/${id}`);
		const focus = card(page, "q2");
		await focus.getByLabel("Highest").fill("7");
		await expect(focus.getByLabel("Label for 7")).toHaveValue("Completely");
		await focus.getByLabel("Lowest").fill("");
		await expect(focus.getByLabel("Label for 1")).toHaveValue("Not at all");
		await save(page);
		await expect(page.getByRole("status")).toHaveText("Saved.");
		expect((await savedQuestions(request, id))[0]).toMatchObject({
			min: 1, max: 7, scale_labels: { "1": "Not at all", "7": "Completely" },
		});
	});

	test("a scale wider than 11 points is refused with a readable error", async ({ page, request }) => {
		const id = await createSurvey(request, [{ ...FOCUS, skip_if: undefined }]);
		await loginAs(page, request, ADMIN);
		await page.goto(`/admin/surveys/${id}`);
		await card(page, "q2").getByLabel("Highest").fill("20");
		await save(page);
		await expect(page.locator("p[role=alert]:not(#__next-route-announcer__)")).toContainText("at most 10 apart");
	});
});

// ── Responses view ────────────────────────────────────────────────────────────

test("responses view: removed columns, earlier-version counts and not-asked questions", async ({ page, request }) => {
	const id = await createSurvey(request, [COUNT, FOCUS, REFLECT]);
	await respond(request, id, { q1: 2, q2: 4, q3: "Before the change" });
	await loginAs(page, request, ADMIN);
	await page.goto(`/admin/surveys/${id}`);
	await card(page, "q2").getByLabel("Question", { exact: true }).fill("How focused, honestly?");
	await page.getByRole("button", { name: "Remove question q3" }).click();
	await page.getByRole("button", { name: "Number" }).click();
	await page.getByLabel("Question", { exact: true }).last().fill("Minutes per session?");
	await save(page);
	await expect(page.getByRole("status")).toHaveText("Saved.");

	await page.getByRole("tab", { name: /Responses/ }).click();
	await expect(page.getByRole("columnheader", { name: /q3.*removed/i })).toBeVisible();
	await expect(page.getByRole("row").filter({ hasText: "How focused, honestly?" })).toContainText("1 on an earlier version");
	await expect(page.getByRole("row").filter({ hasText: "How many sessions?" })).not.toContainText("earlier version");
	await expect(page.locator('td[title^="Answered before this question was changed"]')).toContainText("4");
	await expect(page.locator('td[title^="Question since removed"]')).toContainText("Before the change");
	await expect(page.locator('td[title="Added after this response was submitted"]')).toHaveText(/—/);
});

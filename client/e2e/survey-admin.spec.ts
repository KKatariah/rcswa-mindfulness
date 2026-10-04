import { expect, test, type Page } from "@playwright/test";
import { ADMIN, API, apiToken, loginAs, STUDENT } from "./helpers";

const READER = "reader@e2e.local";

/** Save the open survey, confirming the prompt shown when it already has responses. */
async function saveSurvey(page: Page) {
	await page.getByRole("button", { name: "Save changes" }).click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog.or(page.getByRole("status"))).toBeVisible();
	if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Save changes" }).click();
}

test("admin views a survey's responses", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/surveys");
	await expect(page.getByRole("heading", { name: "Surveys" })).toBeVisible();

	await page.getByRole("row", { name: /weekly-maq-w2/ }).click();
	await expect(page.getByRole("heading", { name: "Week 2" })).toBeVisible();
	await page.getByRole("tab", { name: "Responses (1)" }).click();
	await expect(page.getByText("Rae Responder")).toBeVisible();
	await expect(page.getByText("Seeded reflection for export.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Download CSV" })).toBeVisible();
	// Surveys with responses can't be deleted.
	await expect(page.getByRole("button", { name: "Delete survey" })).toHaveCount(0);
});

test("admin edits question wording and participants see it", async ({ browser, page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/surveys/1");
	const q1 = page.getByLabel("Question", { exact: true }).first();
	const original = await q1.inputValue();
	await q1.fill("How many times did you sit and meditate this week?");
	await saveSurvey(page);
	await expect(page.getByRole("status")).toHaveText("Saved.");

	const reader = await browser.newPage();
	await loginAs(reader, request, READER);
	await reader.goto("/surveys/1");
	await expect(reader.getByText("How many times did you sit and meditate this week?")).toBeVisible();
	await reader.close();

	await q1.fill(original);
	await saveSurvey(page);
	await expect(page.getByRole("status")).toHaveText("Saved.");
});

test("admin creates a survey by copying one, then deletes it", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/surveys");
	await page.getByRole("button", { name: "New Survey" }).click();
	await page.getByLabel("Title").fill("Follow-up check-in");
	await page.getByLabel(/^Code/).fill("followup-e2e");
	await page.getByRole("button", { name: "Create" }).click();

	await expect(page.getByRole("heading", { name: "Follow-up check-in" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "Questions (13)" })).toBeVisible();
	await page.getByRole("button", { name: "Delete survey" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Delete survey" }).click();
	await expect(page).toHaveURL(/\/admin\/surveys$/);
	await expect(page.getByText("followup-e2e")).toHaveCount(0);
});

test("student is refused on admin survey pages", async ({ page, request }) => {
	await loginAs(page, request, STUDENT);
	for (const path of ["/admin/surveys", "/admin/surveys/1"]) {
		await page.goto(path);
		await expect(page.getByText("You don't have access to this page.")).toBeVisible();
	}
});

test("unknown survey id shows an error, not a crash", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto("/admin/surveys/99999");
	await expect(page.getByText(/No Survey matches/)).toBeVisible();
	await page.goto("/admin/surveys/abc");
	await expect(page.getByText(/Not found/)).toBeVisible();
	expect(errors).toEqual([]);
});

test("dirty state, discard, and server errors", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/surveys/2");
	const save = page.getByRole("button", { name: "Save changes" });
	await expect(save).toBeDisabled();
	const q1 = page.getByLabel("Question", { exact: true }).first();
	const original = await q1.inputValue();
	await q1.fill("changed");
	await expect(save).toBeEnabled();
	await page.getByRole("button", { name: "Discard" }).click();
	await expect(q1).toHaveValue(original);
	await expect(save).toBeDisabled();

	// Whitespace passes the HTML `required` check, so the server must reject it visibly.
	await q1.fill("   ");
	await save.click();
	// This survey already has a response, so saving asks first.
	await page.getByRole("alertdialog").getByRole("button", { name: "Save changes" }).click();
	await expect(page.locator("p[role=alert]:not(#__next-route-announcer__)")).toContainText("text is required");
	await page.getByRole("button", { name: "Discard" }).click();
});

test("unsaved edits survive switching tabs", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/surveys/2");
	const q1 = page.getByLabel("Question", { exact: true }).first();
	await q1.fill("draft in progress");
	await page.getByRole("tab", { name: /Responses/ }).click();
	await page.getByRole("tab", { name: /Questions/ }).click();
	await expect(q1).toHaveValue("draft in progress");
});

test("create: invalid and duplicate codes show errors in the modal", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/surveys");
	await page.getByRole("button", { name: "New Survey" }).click();
	await page.getByLabel("Title").fill("Dup");
	await page.getByLabel(/^Code/).fill("weekly-maq-w1");
	await page.getByRole("button", { name: "Create" }).click();
	await expect(page.locator("p[role=alert]:not(#__next-route-announcer__)")).toContainText("already exists");
	await page.getByLabel(/^Code/).fill("has space");
	await page.getByRole("button", { name: "Create" }).click();
	await expect(page.locator("p[role=alert]:not(#__next-route-announcer__)")).toContainText("letters, digits");
});

test("long, hostile and identity-less responses render safely", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	const long = "Calm. ".repeat(800);
	await page.route("**/api/surveys/2/responses/", (route) =>
		route.fulfill({
			json: [
				{ id: 1, participant_id: 7, full_name: "", email: "", cohort: "", submitted_at: "2026-10-01T10:00:00Z",
					answers: { q1: 3, q13: long } },
				{ id: 2, participant_id: 8, full_name: "<img src=x onerror=window.__xss=1>", email: "x@y.z", cohort: "C",
					submitted_at: "2026-10-01T10:00:00Z", answers: { q1: "not a number", q2: 4, q99: "legacy" } },
			],
		}),
	);
	await page.goto("/admin/surveys/2");
	await page.getByRole("tab", { name: "Responses (2)" }).click();
	await expect(page.getByText("#7")).toBeVisible();
	const cell = page.getByRole("button", { name: /^Calm\. Calm\./ });
	const collapsed = (await cell.boundingBox())!.height;
	await cell.click();
	const expanded = (await cell.boundingBox())!.height;
	expect(expanded).toBeGreaterThan(collapsed * 3);
	expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
	// Mean ignores non-numeric junk: q1 values are 3 and "not a number".
	await expect(page.getByRole("row").filter({ hasText: "How many times" })).toContainText("3.0");
});

test("participant sees edited section heading and a multi-question journal prompt", async ({ page, request }) => {
	const token = await apiToken(request, ADMIN);
	const survey = await (await request.get(`${API}/surveys/1/`, { headers: { Authorization: `Token ${token}` } })).json();
	const edited = structuredClone(survey.questions);
	edited[0].section = "Edited formal heading.";
	edited[12].text = "First prompt? Second prompt? A closing line.";
	const res = await request.patch(`${API}/surveys/1/`, {
		headers: { Authorization: `Token ${token}` },
		data: { questions: edited },
	});
	expect(res.ok()).toBe(true);
	try {
		await loginAs(page, request, "reader@e2e.local");
		await page.goto("/surveys/1");
		await expect(page.getByText("Edited formal heading.")).toBeVisible();
		const items = page.locator("ol li");
		await expect(items).toHaveText(["First prompt?", "Second prompt?", "A closing line."]);
		} finally {
		await request.patch(`${API}/surveys/1/`, {
			headers: { Authorization: `Token ${token}` },
			data: { questions: survey.questions },
		});
	}
});

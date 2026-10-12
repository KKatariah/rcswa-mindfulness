import { expect, test } from "@playwright/test";
import { ADMIN, API, loginAs, STUDENT } from "./helpers";

test("week 3 is locked in the list and its page refuses to open", async ({ page, request }) => {
	const token = await loginAs(page, request, STUDENT);
	await page.goto("/modules");

	const week3 = page.locator("li", { hasText: "Week 3" });
	await expect(week3.locator('[aria-disabled="true"]')).toBeVisible();
	await expect(page.locator("li", { hasText: "Week 1" }).getByRole("link")).toBeVisible();

	const modules = await (await request.get(`${API}/modules/`, { headers: { Authorization: `Token ${token}` } })).json();
	const week3Id = modules.find((m: { week_number: number }) => m.week_number === 3).id;
	await page.goto(`/modules/${week3Id}`);
	await expect(page.getByText(/not available yet/i)).toBeVisible();
});

test("submits the week 1 survey and shows a confirmation", async ({ page, request }) => {
	await loginAs(page, request, STUDENT);
	await page.goto("/surveys/1");

	const numbers = page.locator('input[type="number"]');
	await numbers.nth(0).fill("3");
	await numbers.nth(1).fill("15");
	for (let q = 3; q <= 12; q++) {
		await page.locator(`input[name="question-${q}"][value="4"]`).check();
	}
	await page.getByPlaceholder("Enter reflection...").fill("Calmer this week and more aware of my breathing.");
	await page.getByRole("button", { name: "Submit survey" }).click();

	await expect(page.getByRole("status")).toContainText(/survey has been submitted/i);

	// Reloading still shows it as done instead of a blank form.
	await page.reload();
	await expect(page.getByRole("status")).toContainText(/survey has been submitted/i);
});

test("resources page asks logged-out visitors to log in", async ({ page }) => {
	await page.goto("/resources");
	await expect(page.getByText(/to view resources/i)).toBeVisible();
	await expect(page.getByRole("heading", { name: "Resources" })).toHaveCount(0);
});

test("resources page lists resources for a logged-in user", async ({ page, request }) => {
	await loginAs(page, request, STUDENT);
	await page.goto("/resources");
	await expect(page.getByRole("heading", { name: "Resources", level: 1 })).toBeVisible();
	// The data migration seeds the default reading list.
	await expect(page.getByRole("region", { name: "Books" })).toContainText("My Year of Living Mindfully");
});

test("home page shows the program and a logged-out visitor sees no profile link", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByText("Unable to load the program right now.")).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "The 8-Week Program" })).toBeVisible();
	await expect(page.getByRole("link", { name: /profile picture/ })).toHaveCount(0);
});

test("with nothing left to unlock, Next Session points at the first unfinished week", async ({ page, request }) => {
	// The right-hand column (and its Next Session card) only shows on screens 1280px and wider.
	test.skip((page.viewportSize()?.width ?? 0) < 1280, "Next Session is hidden on phones and tablets");
	// The admin has no cohort schedule and hasn't completed anything.
	await loginAs(page, request, ADMIN);
	for (const path of ["/modules", "/surveys"]) {
		await page.goto(path);
		const card = page.locator("section", { hasText: "Next Session" });
		await expect(card).toContainText("Introduction");
		await expect(card).toContainText("Available now");
	}
});

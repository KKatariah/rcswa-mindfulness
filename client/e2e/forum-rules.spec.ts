import { expect, type Page, test } from "@playwright/test";
import { ADMIN, API, apiToken, loginAs } from "./helpers";

// Never agrees to the rules (see seed.py); every test here must leave it that way.
const HOLDOUT = "holdout@e2e.local";
// Body of the thread seeded in seed.py: must never reach a student who hasn't agreed.
const SEEDED_THREAD = "Seeded thread";

async function expectStillUnaccepted(request: Parameters<typeof apiToken>[0]) {
	const token = await apiToken(request, HOLDOUT);
	const res = await request.get(`${API}/forum/threads/`, { headers: { Authorization: `Token ${token}` } });
	expect(res.status()).toBe(403);
	expect(await res.text()).not.toContain(SEEDED_THREAD);
}

async function expectNoForumContent(page: Page) {
	await expect(page.getByText(SEEDED_THREAD)).toHaveCount(0);
	await expect(page.getByPlaceholder(/share your thoughts/i)).toHaveCount(0);
}

test("the continue button stays disabled until the box is ticked", async ({ page, request }) => {
	await loginAs(page, request, HOLDOUT);
	await page.goto("/forum");
	const dialog = page.getByRole("dialog");
	const accept = dialog.getByRole("button", { name: "Continue to forum" });
	await expect(accept).toBeDisabled();
	await accept.click({ force: true });
	await expect(dialog).toBeVisible();
	await expectNoForumContent(page);
	await expectStillUnaccepted(request);
});

for (const how of ["Not now", "close button", "Escape"] as const) {
	test(`dismissing with ${how} leaves the forum and saves nothing`, async ({ page, request }) => {
		await loginAs(page, request, HOLDOUT);
		await page.goto("/forum");
		const dialog = page.getByRole("dialog");
		await expect(dialog).toContainText("Forum Rules");
		if (how === "Not now") await dialog.getByRole("button", { name: "Not now" }).click();
		else if (how === "close button") await dialog.getByRole("button", { name: "Close" }).click();
		else await page.keyboard.press("Escape");

		await expect(page).toHaveURL(/\/modules/);
		await expectStillUnaccepted(request);

		// Coming back (e.g. with the browser's back button) asks again.
		await page.goBack();
		await expect(page.getByRole("dialog")).toContainText("Forum Rules");
		await expectNoForumContent(page);
	});
}

test("faking the accepted flag in localStorage doesn't skip the rules", async ({ page, request }) => {
	await loginAs(page, request, HOLDOUT);
	await page.addInitScript(() => {
		if (window !== window.top) return;
		window.localStorage.setItem(
			"user",
			JSON.stringify({ id: 0, email: "x", full_name: "x", role: "admin", forum_rules_accepted: true }),
		);
	});
	await page.goto("/forum");
	// The app re-reads the user from the server, so the real (unaccepted) state wins.
	await expect(page.getByRole("dialog")).toContainText("Forum Rules");
	await expectNoForumContent(page);
	await expectStillUnaccepted(request);
});

test("a client that lies about being accepted still gets no forum data", async ({ page, request }) => {
	await loginAs(page, request, HOLDOUT);
	// Simulates a tampered client: the browser is told the user has agreed (and is an admin),
	// but the forum API itself is untouched.
	await page.route("**/api/user/", async (route) => {
		const res = await route.fetch();
		const body = await res.json();
		body.user.forum_rules_accepted = true;
		body.user.role = "admin";
		await route.fulfill({ response: res, json: body });
	});
	await page.goto("/forum");
	await expect(page.getByText(/forum rules/i).first()).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByText("Something went wrong")).toBeVisible();
	await expect(page.getByText(SEEDED_THREAD)).toHaveCount(0);
	await expectStillUnaccepted(request);
});

test("admins go straight to the forum without the rules popup", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/forum");
	await expect(page.getByText(SEEDED_THREAD).first()).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the sidebar's full rules view is read-only", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/forum");
	await page.getByRole("button", { name: "Read full rules" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText("Report, don't retaliate");
	await expect(dialog.getByRole("checkbox")).toHaveCount(0);
	await dialog.getByRole("button", { name: "Got it" }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page).toHaveURL(/\/forum/);
});

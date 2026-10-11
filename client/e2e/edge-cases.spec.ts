import { expect, test } from "@playwright/test";
import { loginAs, openNavMenu, OTHER, STUDENT } from "./helpers";

test("survey submits with no meditation (q1 = 0) and the follow-ups left blank", async ({ page, request }) => {
	await loginAs(page, request, OTHER);
	await page.goto("/surveys/1");

	await page.locator('input[type="number"]').first().fill("0");
	for (let q = 7; q <= 12; q++) {
		await page.locator(`input[name="question-${q}"][value="3"]`).check();
	}
	const journal = page.getByPlaceholder("Enter reflection...");
	await journal.fill("A busy week, but I noticed my breathing a few times.");
	await expect(page.getByText(/^11 words/)).toBeVisible();
	await expect(journal).toHaveAttribute("maxlength", "5000");

	await page.getByRole("button", { name: "Submit survey" }).click();
	await expect(page.getByRole("status")).toContainText(/survey has been submitted/i);
});

test("an expired session returns to the home page instead of a broken page", async ({ page }) => {
	// Plant a stale token once (an init script would re-add it after the redirect).
	await page.goto("/about");
	await page.evaluate(() => window.localStorage.setItem("token", "not-a-real-token"));
	await page.goto("/forum");
	await expect(page).toHaveURL(/\/$/);
	await openNavMenu(page);
	await expect(page.getByRole("button", { name: "Log In" }).filter({ visible: true })).toBeVisible();
	expect(await page.evaluate(() => window.localStorage.getItem("token"))).toBeNull();
});

test("a very long word in a forum post wraps instead of widening the page", async ({ page, request }) => {
	await loginAs(page, request, STUDENT);
	await page.goto("/forum");
	await page.getByPlaceholder(/share your thoughts/i).fill("x".repeat(3000));
	await page.getByRole("button", { name: "Post", exact: true }).click();
	await expect(page.getByText(/^x{50}/).first()).toBeVisible();

	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
});

test("hitting the server's post limit shows a readable message", async ({ page, request }) => {
	await loginAs(page, request, STUDENT);
	// Simulate the server limit (e.g. posting from a second tab, which the page's own cooldown can't see).
	await page.route("**/api/forum/threads/", (route) =>
		route.request().method() === "POST"
			? route.fulfill({ status: 429, json: { detail: "Request was throttled. Expected available in 42 seconds." } })
			: route.continue(),
	);
	await page.goto("/forum");
	await page.getByPlaceholder(/share your thoughts/i).fill("One more post");
	await page.getByRole("button", { name: "Post", exact: true }).click();
	await expect(page.getByText("You're doing that too often. Please wait 42 seconds and try again.")).toBeVisible();
});

test("the forum shows threads a page at a time and searches on the server", async ({ page, request }) => {
	await loginAs(page, request, STUDENT);
	const fakeThread = (id: number, body: string) => ({
		id, title: body, module: null, content_item: null, author_name: "Someone", author_avatar_url: "",
		created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", edited_at: null,
		body, reply_count: 0, can_edit: false, is_own: false, is_pinned: false, pin_order: null, can_pin: false,
	});
	// 30 threads in all; the page asks for 25 at a time.
	const all = Array.from({ length: 30 }, (_, i) => fakeThread(i + 1, `Fake thread ${i + 1}`));
	const searches: string[] = [];
	await page.route(
		(url) => url.pathname === "/api/forum/threads/",
		(route) => {
			if (route.request().method() !== "GET") return route.continue();
			const url = new URL(route.request().url());
			const search = url.searchParams.get("search") ?? "";
			if (search) searches.push(search);
			const matches = search ? all.filter((t) => t.body.endsWith(` ${search}`)) : all;
			const offset = Number(url.searchParams.get("offset") ?? 0);
			const limit = Number(url.searchParams.get("limit") ?? 25);
			return route.fulfill({ json: { count: matches.length, next: null, previous: null, results: matches.slice(offset, offset + limit) } });
		},
	);
	await page.goto("/forum");

	await expect(page.getByText("Fake thread 25", { exact: true })).toBeVisible();
	await expect(page.getByText("Fake thread 26", { exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Load more" }).click();
	await expect(page.getByText("Fake thread 30", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);

	await page.getByRole("searchbox", { name: "Search forum threads" }).fill("7");
	await expect(page.getByText("Fake thread 7", { exact: true })).toBeVisible();
	await expect(page.getByText("Fake thread 1", { exact: true })).toHaveCount(0);
	expect(searches).toContain("7");
});

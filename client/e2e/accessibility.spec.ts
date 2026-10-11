import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, loginAs, openNavMenu, STUDENT } from "./helpers";

// WCAG 2.1 A and AA: the level Australian government and education sites are expected to meet.
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// Known issue: the brand blue (#5096cf) is 3.17:1 on white, below AA's 4.5:1 for normal text.
// It is checked on its own below so every other rule still gates changes.
const KNOWN_FAILING_RULES = ["color-contrast"];

/** One line per problem, e.g. "label (critical): 1× — #search". */
async function violations(page: Page, { only }: { only?: string[] } = {}) {
	// Wait for data to load, so the scan sees the real page rather than a spinner.
	await page.waitForLoadState("networkidle");
	// Next sets the title after hydration; scanning before then reports a missing <title>.
	await expect(page).toHaveTitle(/\S/);
	const builder = new AxeBuilder({ page })
		// Third-party players are outside our control.
		.exclude("iframe");
	if (only) builder.withRules(only);
	else builder.withTags(WCAG_TAGS).disableRules(KNOWN_FAILING_RULES);
	const results = await builder.analyze();
	return results.violations.map(
		(v) => `${v.id} (${v.impact}): ${v.nodes.length}× — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`,
	);
}

const PUBLIC_PAGES = ["/", "/about"];
const STUDENT_PAGES = ["/modules", "/modules/1", "/surveys", "/surveys/1", "/forum", "/resources", "/profile"];
const ADMIN_PAGES = ["/admin", "/admin/users", "/admin/approvals", "/admin/cohorts", "/admin/modules", "/admin/surveys", "/admin/resources"];

for (const path of PUBLIC_PAGES) {
	test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
		await page.goto(path);
		expect(await violations(page)).toEqual([]);
	});
}

for (const path of STUDENT_PAGES) {
	test(`${path} has no WCAG A/AA violations for a student`, async ({ page, request }) => {
		await loginAs(page, request, STUDENT);
		await page.goto(path);
		expect(await violations(page)).toEqual([]);
	});
}

for (const path of ADMIN_PAGES) {
	test(`${path} has no WCAG A/AA violations for an admin`, async ({ page, request }) => {
		await loginAs(page, request, ADMIN);
		await page.goto(path);
		expect(await violations(page)).toEqual([]);
	});
}

test("the log-in dialog has no WCAG A/AA violations", async ({ page }) => {
	await page.goto("/");
	await openNavMenu(page);
	await page.getByRole("button", { name: "Log In" }).filter({ visible: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	expect(await violations(page)).toEqual([]);
});

// Expected to fail until the brand blue is darkened (e.g. to #2e71a7, which passes on white, the grey
// panels and the pale-blue badges). Playwright flags it as soon as it starts passing, so the marker can go.
test("text colours meet WCAG AA contrast", async ({ page, request }) => {
	test.fail(true, "brand blue #5096cf is below 4.5:1 contrast");
	const problems: string[] = [];
	for (const path of PUBLIC_PAGES) {
		await page.goto(path);
		problems.push(...(await violations(page, { only: KNOWN_FAILING_RULES })).map((v) => `${path} ${v}`));
	}
	await loginAs(page, request, ADMIN);
	for (const path of [...STUDENT_PAGES, ...ADMIN_PAGES]) {
		await page.goto(path);
		problems.push(...(await violations(page, { only: KNOWN_FAILING_RULES })).map((v) => `${path} ${v}`));
	}
	expect(problems).toEqual([]);
});

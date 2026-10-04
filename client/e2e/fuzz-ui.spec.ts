/**
 * Frontend fuzzing with fast-check.
 *
 * 1. Hostile API data: each page is loaded once against the real e2e backend and
 *    its GET /api responses are recorded as templates. fast-check then mutates
 *    them (hostile text, javascript: URLs, other dates, 0-25 list items) and the
 *    page is reloaded with the mutated data. It must not crash, run injected
 *    markup, render javascript: links, or scroll sideways.
 * 2. Hostile user input: random text typed into real forms against the real
 *    backend must never crash the page.
 *
 * FUZZ_RUNS=50 npx playwright test e2e/fuzz-ui.spec.ts   for a longer run.
 */
import { expect, test, type Page } from "@playwright/test";
import fc from "fast-check";
import { ADMIN, loginAs, STUDENT } from "./helpers";

const RUNS = Number(process.env.FUZZ_RUNS ?? 8);
const SEED = process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : undefined;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// ── Hostile values ────────────────────────────────────────────────────────────

const XSS_PAYLOADS = [
	"<script>window.__xss=1</script>",
	'<img src=x onerror="window.__xss=1">',
	'"><svg onload="window.__xss=1">',
	"[click](javascript:window.__xss=1)",
];

const hostileText: fc.Arbitrary<string> = fc.oneof(
	fc.string({ unit: "grapheme", maxLength: 80 }),
	fc.string({ unit: "binary", maxLength: 40 }),
	fc.constantFrom(
		"",
		"   ",
		"\n\n\n",
		"x".repeat(5000),
		"👨‍👩‍👧‍👦".repeat(60),
		"‮evil right-to-left",
		"Z̷̢̛͖a̴̧͚l̸̨̛g̵̢͝o̶̡͠",
		"{{7*7}} ${7*7} %s%n",
		"null",
		"undefined",
		...XSS_PAYLOADS,
	),
);

const hostileUrl = (original: string): fc.Arbitrary<string> =>
	fc.oneof(
		fc.constant(original),
		fc.constantFrom("", "javascript:window.__xss=1", "JaVaScRiPt:window.__xss=1", 'https://example.com/"><img src=x onerror="window.__xss=1">'),
		fc.webUrl(),
	);

// Fields whose values come from a fixed set; changing them tests nothing the backend can send.
const ENUM_KEYS = new Set(["role", "type", "status", "category", "provider", "auth_provider", "code"]);
const isUrlKey = (key: string) => /(^url$|_url$|href|cover_image|cover)/.test(key);
const isDateKey = (key: string, value: string) =>
	/(_at|_date|^date)$/.test(key) || /^\d{4}-\d{2}-\d{2}(T|$)/.test(value);

function mutate(value: Json, key = ""): fc.Arbitrary<Json> {
	if (value === null) return fc.constant(null);
	if (typeof value === "boolean") return fc.boolean();
	if (typeof value === "number") {
		if (/pct|percent/.test(key)) return fc.integer({ min: 0, max: 100 });
		if (/count|total/.test(key)) return fc.integer({ min: 0, max: 10_000_000 });
		return fc.constant(value);
	}
	if (typeof value === "string") {
		if (ENUM_KEYS.has(key) || /^\d{2}:\d{2}(:\d{2})?$/.test(value)) return fc.constant(value);
		if (isUrlKey(key)) return hostileUrl(value);
		if (isDateKey(key, value)) {
			return fc
				.date({ min: new Date("2020-01-01"), max: new Date("2035-12-31"), noInvalidDate: true })
				.map((d) => (value.length === 10 ? d.toISOString().slice(0, 10) : d.toISOString()));
		}
		return hostileText;
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return fc.constant([]);
		// Fresh ids so React keys stay unique however many items are generated.
		return fc.array(mutate(value[0], key), { maxLength: 25 }).map((items) =>
			items.map((item, i) =>
				item && typeof item === "object" && !Array.isArray(item) && "id" in item ? { ...item, id: 100_000 + i } : item,
			),
		);
	}
	return fc.record(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mutate(v, k)])));
}

// ── Page plumbing ─────────────────────────────────────────────────────────────

// Numeric ids in paths are interchangeable: /forum/threads/12/ matches /forum/threads/100004/.
const routeKey = (url: URL) => (url.pathname + url.search).replace(/\d+/g, ":n");

async function settle(page: Page) {
	await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
}

async function recordTemplates(page: Page, path: string, interact?: (page: Page) => Promise<void>) {
	const templates = new Map<string, Json>();
	const onResponse = async (res: import("@playwright/test").Response) => {
		const url = new URL(res.url());
		if (!url.pathname.startsWith("/api/") || res.request().method() !== "GET" || res.status() !== 200) return;
		try {
			templates.set(routeKey(url), await res.json());
		} catch {
			/* not JSON */
		}
	};
	page.on("response", onResponse);
	await page.goto(path);
	await settle(page);
	if (interact) {
		await interact(page);
		await settle(page);
	}
	page.off("response", onResponse);
	return templates;
}

type Problems = { errors: string[] };

function watchForCrashes(page: Page): Problems {
	const problems: Problems = { errors: [] };
	page.on("pageerror", (err) => problems.errors.push(`pageerror: ${err.message}`));
	page.on("console", (msg) => {
		if (msg.type() === "error" && /above error occurred|Uncaught|Unhandled/i.test(msg.text())) {
			problems.errors.push(`console: ${msg.text().slice(0, 300)}`);
		}
	});
	return problems;
}

async function checkPage(page: Page, problems: Problems, label: string) {
	const report = await page.evaluate(() => {
		const unsafe = [...document.querySelectorAll<HTMLElement>("a[href], iframe[src], img[src]")]
			.map((el) => el.getAttribute("href") ?? el.getAttribute("src") ?? "")
			.filter((v) => /^\s*javascript:/i.test(v) && !v.includes("React has blocked"));
		return {
			xss: (window as unknown as { __xss?: unknown }).__xss ?? null,
			unsafe,
			overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
			crashed: /Unhandled Runtime Error|Application error/.test(document.body.innerText),
		};
	});
	expect(problems.errors, `${label}: uncaught errors`).toEqual([]);
	expect(report.crashed, `${label}: error screen shown`).toBe(false);
	expect(report.xss, `${label}: injected script ran`).toBeNull();
	expect(report.unsafe, `${label}: javascript: URL rendered`).toEqual([]);
	expect(report.overflow, `${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
}

// ── 1. Hostile API data ───────────────────────────────────────────────────────

const openFirstThread = async (page: Page) => {
	// Short timeout: some runs generate an empty thread list.
	await page.locator('section[aria-label="Forum"] [role="button"]').first().click({ timeout: 3000 });
};

const PAGES: { path: string; as: string; interact?: (page: Page) => Promise<void> }[] = [
	{ path: "/modules", as: STUDENT },
	{ path: "/modules/1", as: STUDENT },
	{ path: "/forum", as: STUDENT, interact: openFirstThread },
	{ path: "/resources", as: STUDENT },
	{ path: "/surveys", as: STUDENT },
	{ path: "/progress", as: STUDENT },
	{ path: "/profile", as: STUDENT },
	{ path: "/admin", as: ADMIN },
	{ path: "/admin/users", as: ADMIN },
	{ path: "/admin/approvals", as: ADMIN },
	{ path: "/admin/cohorts", as: ADMIN },
	{ path: "/admin/resources", as: ADMIN },
	{ path: "/admin/modules", as: ADMIN },
	{ path: "/admin/modules/1", as: ADMIN },
	{ path: "/admin/surveys", as: ADMIN },
	{ path: "/admin/surveys/2", as: ADMIN, interact: (page) => page.getByRole("tab", { name: /Responses/ }).click() },
	{ path: "/surveys/1", as: "reader@e2e.local" },
];

test.describe("fuzz: hostile API data", () => {
	for (const { path, as, interact } of PAGES) {
		test(`${path} survives hostile API data`, async ({ page, request }) => {
			test.setTimeout(10 * 60_000);
			await loginAs(page, request, as);
			const templates = await recordTemplates(page, path, interact);
			expect(templates.size, "no API data recorded").toBeGreaterThan(0);

			const keys = [...templates.keys()];
			const arb = fc.tuple(...keys.map((k) => mutate(templates.get(k)!)));
			const problems = watchForCrashes(page);

			await fc.assert(
				fc.asyncProperty(arb, async (bodies) => {
					problems.errors.length = 0;
					const byKey = new Map(keys.map((k, i) => [k, bodies[i]]));
					await page.unrouteAll({ behavior: "ignoreErrors" });
					await page.route("**/api/**", (route) => {
						const url = new URL(route.request().url());
						const body = route.request().method() === "GET" ? byKey.get(routeKey(url)) : undefined;
						return body === undefined ? route.continue() : route.fulfill({ json: body });
					});
					await page.goto(path);
					await settle(page);
					if (interact) {
						await interact(page).catch(() => {}); // the list may be empty this run
						await settle(page);
					}
					await checkPage(page, problems, path);
				}),
				{ numRuns: RUNS, seed: SEED, endOnFailure: false },
			);
		});
	}
});

// ── 2. Hostile user input ─────────────────────────────────────────────────────

test.describe("fuzz: hostile user input", () => {
	test("sign-up form", async ({ page }) => {
		test.setTimeout(10 * 60_000);
		const problems = watchForCrashes(page);
		await page.goto("/");
		await fc.assert(
			fc.asyncProperty(hostileText, hostileText, hostileText, async (email, name, password) => {
				problems.errors.length = 0;
				await page.goto("/");
				await page.getByRole("button", { name: "Sign Up" }).first().click();
				await page.locator("#signup-email").fill(email.slice(0, 300));
				await page.locator("#signup-fullname").fill(name.slice(0, 300));
				await page.locator("#signup-password").fill(password.slice(0, 300));
				await page.locator("#signup-confirm-password").fill(password.slice(0, 300));
				await page.getByRole("button", { name: "Sign up", exact: true }).click();
				await settle(page);
				await checkPage(page, problems, "sign-up");
			}),
			{ numRuns: RUNS, seed: SEED },
		);
	});

	test("forum composer", async ({ page, request }) => {
		test.setTimeout(10 * 60_000);
		await loginAs(page, request, STUDENT);
		const problems = watchForCrashes(page);
		await fc.assert(
			fc.asyncProperty(hostileText.filter((t) => t.trim().length > 0), async (body) => {
				problems.errors.length = 0;
				// Skip the page's own cooldown so the server's limit gets exercised too.
				await page.goto("/forum");
				await page.evaluate(() => localStorage.removeItem("forum:postTimestamps"));
				await page.getByPlaceholder(/share your thoughts/i).fill(body.slice(0, 2000));
				await page.getByRole("button", { name: "Post", exact: true }).click();
				await settle(page);
				await checkPage(page, problems, "forum composer");
			}),
			{ numRuns: RUNS, seed: SEED },
		);
	});
});

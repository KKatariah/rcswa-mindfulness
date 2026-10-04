import { devices, expect, test } from "@playwright/test";
import { ADMIN, API, apiToken, loginAs, STUDENT } from "./helpers";

test("students are shown the no-access message on admin pages", async ({ page, request }) => {
	await loginAs(page, request, STUDENT);
	for (const path of ["/admin", "/admin/users", "/admin/approvals"]) {
		await page.goto(path);
		await expect(page.getByText("You don't have access to this page.")).toBeVisible();
	}
});

test("admin dashboard loads", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin");
	await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
	await expect(page.getByText(/something went wrong|failed/i)).toHaveCount(0);
});

test("admin approves one signup and rejects another", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/approvals");

	const approveRow = page.getByRole("row", { name: /approve-me@e2e\.local/ });
	await approveRow.getByRole("button", { name: "Approve" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Approve" }).click();
	await expect(approveRow).toHaveCount(0);

	const rejectRow = page.getByRole("row", { name: /reject-me@e2e\.local/ });
	await rejectRow.getByRole("button", { name: "Reject" }).click();
	await page.getByRole("button", { name: "Delete account" }).click();
	await expect(rejectRow).toHaveCount(0);

	// The server agrees: one is now active, the other account is gone.
	const headers = { Authorization: `Token ${await apiToken(request, ADMIN)}` };
	const enrollments = await (await request.get(`${API}/enrollments/`, { headers })).json();
	const byEmail = new Map(enrollments.map((e: { user_email: string; status: string }) => [e.user_email, e.status]));
	expect(byEmail.get("approve-me@e2e.local")).toBe("active");
	expect(byEmail.has("reject-me@e2e.local")).toBe(false);
});

test("admin creates a cohort", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/cohorts");
	await page.getByRole("button", { name: "New Cohort" }).click();
	await page.locator("#cohort-name").fill("E2E Sem 1 2027");
	await page.locator("#cohort-year").fill("2027");
	await page.locator("#cohort-start").fill("2027-02-22");
	await page.locator("#cohort-end").fill("2027-05-28");
	await page.getByRole("button", { name: "Save" }).click();
	await expect(page.getByRole("row", { name: /E2E Sem 1 2027/ })).toBeVisible();
});

test("admin deletes a resource", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/resources");
	const firstDelete = page.getByRole("button", { name: "Delete resource" }).first();
	await expect(firstDelete).toBeVisible();
	const before = await page.getByRole("button", { name: "Delete resource" }).count();

	await firstDelete.click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Delete resource" }).click();
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Delete resource" })).toHaveCount(before - 1);
});

test("admin searches users", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/users");
	await page.getByPlaceholder("Search by name or email").fill("other@e2e");
	// The page renders separate mobile and desktop layouts; only check what's on screen.
	await expect(page.getByText("other@e2e.local").filter({ visible: true }).first()).toBeVisible();
	await expect(page.getByText("student@e2e.local").filter({ visible: true })).toHaveCount(0);
});

test("admin reorders resources within a category by drag and keyboard", async ({ page, request }) => {
	const token = await apiToken(request, ADMIN);
	for (const title of ["Order A", "Order B", "Order C"]) {
		const res = await request.post(`${API}/additional-resources/`, {
			headers: { Authorization: `Token ${token}` },
			multipart: { category: "online_program", title, url: "https://example.com" },
		});
		expect(res.ok()).toBe(true);
	}
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/resources");
	await expect(page.getByLabel("Display order")).toHaveCount(0);

	const section = page.getByRole("region", { name: /Online Programs/ });
	const titles = section.locator("tbody tr td:nth-child(3)");
	const ours = async () => (await titles.allTextContents()).filter((t) => t.startsWith("Order "));
	// New resources are appended, in creation order.
	await expect.poll(ours).toEqual(["Order A", "Order B", "Order C"]);

	await section.getByRole("button", { name: "Reorder Order C" }).dragTo(section.getByRole("row", { name: /Order A/ }));
	await expect.poll(ours).toEqual(["Order C", "Order A", "Order B"]);

	await section.getByRole("button", { name: "Reorder Order C" }).press("ArrowDown");
	await expect.poll(ours).toEqual(["Order A", "Order C", "Order B"]);

	await page.reload();
	await expect.poll(ours).toEqual(["Order A", "Order C", "Order B"]);
	// Other sections are untouched.
	await expect(page.getByRole("region", { name: /Books/ }).getByText("Order A")).toHaveCount(0);
});

test.describe("on a phone", () => {
	const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
	test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

	test("admin reorders resources by touch-dragging the handle", async ({ browserName, page, request }) => {
		test.skip(browserName !== "chromium", "drives touch input through the Chrome DevTools Protocol");
		const token = await apiToken(request, ADMIN);
		for (const title of ["Touch A", "Touch B", "Touch C"]) {
			const res = await request.post(`${API}/additional-resources/`, {
				headers: { Authorization: `Token ${token}` },
				multipart: { category: "documentary", title, url: "https://example.com" },
			});
			expect(res.ok()).toBe(true);
		}
		await loginAs(page, request, ADMIN);
		await page.goto("/admin/resources");
		const section = page.getByRole("region", { name: /Documentaries/ });
		const titles = section.locator("tbody tr td:nth-child(3)");
		const ours = async () => (await titles.allTextContents()).filter((t) => t.startsWith("Touch "));
		await expect.poll(ours).toEqual(["Touch A", "Touch B", "Touch C"]);

		const handle = section.getByRole("button", { name: "Reorder Touch A" });
		await handle.scrollIntoViewIfNeeded();
		const from = (await handle.boundingBox())!;
		const to = (await section.getByRole("row", { name: /Touch C/ }).boundingBox())!;
		const scrollBefore = await page.evaluate(() => window.scrollY);

		// Real touch input (not mouse), so this exercises touch-action and pointer capture.
		const cdp = await page.context().newCDPSession(page);
		const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) =>
			cdp.send("Input.dispatchTouchEvent", {
				type,
				touchPoints: type === "touchEnd" ? [] : [{ x: from.x + from.width / 2, y }],
			});
		const startY = from.y + from.height / 2;
		const endY = to.y + to.height / 2;
		await touch("touchStart", startY);
		for (let i = 1; i <= 10; i++) await touch("touchMove", startY + ((endY - startY) * i) / 10);
		await touch("touchEnd", endY);

		await expect.poll(ours).toEqual(["Touch B", "Touch C", "Touch A"]);
		// The drag moved the row rather than scrolling the page.
		expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
		await page.reload();
		await expect.poll(ours).toEqual(["Touch B", "Touch C", "Touch A"]);
	});
});

test("admin drags modules into a new week order and saves it", async ({ page, request }) => {
	const token = await apiToken(request, ADMIN);
	const headers = { Authorization: `Token ${token}` };
	const original: { id: number }[] = await (await request.get(`${API}/modules/`, { headers })).json();
	try {
		await loginAs(page, request, ADMIN);
		await page.goto("/admin/modules");
		const row = (title: string) => page.getByRole("row", { name: new RegExp(title) });
		await expect(row("Week 3 \\(locked\\)")).toContainText("Week 3");

		// Dragging only previews the new numbering until it's saved.
		await page.getByRole("button", { name: "Reorder Week 3 (locked)" }).dragTo(row("Introduction to Mindfulness"));
		await expect(row("Week 3 \\(locked\\)")).toContainText("Week 1(was 3)");
		await expect(page.getByRole("status")).toContainText("Week order changed");
		await page.getByRole("button", { name: "Discard" }).click();
		await expect(row("Week 3 \\(locked\\)")).toContainText("Week 3");
		await expect(page.getByRole("status")).toHaveCount(0);

		await page.getByRole("button", { name: "Reorder Week 3 (locked)" }).focus();
		await page.keyboard.press("ArrowUp");
		await expect(row("Week 3 \\(locked\\)")).toContainText("Week 2(was 3)");
		await page.getByRole("button", { name: "Save order" }).click();
		await expect(page.getByRole("status")).toHaveCount(0);
		await page.reload();
		await expect(row("Week 3 \\(locked\\)")).toContainText("Week 2");
		await expect(row("Body Scan Meditation")).toContainText("Week 3");
	} finally {
		const res = await request.post(`${API}/modules/reorder/`, { headers, data: { ids: original.map((m) => m.id) } });
		expect(res.ok()).toBe(true);
	}
});

test("admin drags content items within a module", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/modules/1");
	const handles = page.getByRole("button", { name: /^Reorder / });
	await expect(handles).toHaveCount(2);
	const names = async () => (await handles.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))));
	const [first, second] = await names();

	await handles.nth(1).dragTo(page.locator("[data-reorder-id]").first());
	await expect.poll(names).toEqual([second, first]);
	await page.reload();
	await expect.poll(names).toEqual([second, first]);

	// Put it back with the keyboard.
	await page.getByRole("button", { name: first! }).press("ArrowUp");
	await expect.poll(names).toEqual([first, second]);
	await page.reload();
	await expect.poll(names).toEqual([first, second]);
});

test("admin sees which students have finished a module", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin");
	await page.getByRole("link", { name: /^Week 1:/ }).click();
	await expect(page).toHaveURL(/\/admin\/modules\/\d+#progress$/);

	const progress = page.locator("#progress");
	const listed = (email: string) => progress.getByText(email).filter({ visible: true });
	await progress.getByRole("button", { name: /^Completed/ }).click();
	await expect(listed("student@e2e.local")).toHaveCount(1);
	// Pending and withdrawn students aren't part of the cohort's progress.
	await progress.getByRole("button", { name: /^All/ }).click();
	await expect(listed("reject-me@e2e.local")).toHaveCount(0);
	await expect(listed("responder@e2e.local")).toHaveCount(0);

	await progress.getByRole("button", { name: /^Not started/ }).click();
	await expect(listed("student@e2e.local")).toHaveCount(0);
});

test("unpublishing a module asks first", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/modules/1");
	await page.getByLabel("Published").uncheck();
	await page.getByRole("button", { name: "Save module" }).click();
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toContainText("Unpublish");
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toHaveCount(0);

	// Nothing was saved.
	await page.reload();
	await expect(page.getByLabel("Published")).toBeChecked();
});

test("admin opens a person's profile from the users list and from module progress", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin/users");
	await page.getByRole("link", { name: "student@e2e.local" }).filter({ visible: true }).first().click();
	await expect(page).toHaveURL(/\/admin\/users\/\d+$/);
	await expect(page.getByRole("heading", { name: "E2E Student" })).toBeVisible();
	await expect(page.getByText("E2E Cohort").first()).toBeVisible();
	// Week 1's content was completed in the seed data.
	const week1 = page.getByRole("link", { name: /^Week 1:/ }).filter({ visible: true });
	await expect(week1).toBeVisible();

	await week1.click();
	await expect(page).toHaveURL(/\/admin\/modules\/\d+#progress$/);
	await page.locator("#progress").getByRole("link", { name: /other@e2e\.local/ }).filter({ visible: true }).click();
	await expect(page.getByRole("heading", { name: "E2E Other" })).toBeVisible();
});

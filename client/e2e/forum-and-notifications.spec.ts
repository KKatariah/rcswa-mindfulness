import { expect, test } from "@playwright/test";
import { API, apiToken, loginAs, OTHER, STUDENT } from "./helpers";

test("a student posts a thread that another student can read but not edit", async ({ browser, request }) => {
	const body = `E2E thread ${Date.now()}`;

	const studentPage = await (await browser.newContext()).newPage();
	await loginAs(studentPage, request, STUDENT);
	await studentPage.goto("/forum");
	await studentPage.getByPlaceholder(/share your thoughts/i).fill(body);
	await studentPage.getByRole("button", { name: "Post", exact: true }).click();
	await expect(studentPage.getByText(body).first()).toBeVisible();

	const otherPage = await (await browser.newContext()).newPage();
	const otherToken = await loginAs(otherPage, request, OTHER);
	await otherPage.goto("/forum");
	await otherPage.getByText(body).first().click();
	await expect(otherPage.getByText(body).first()).toBeVisible();
	await expect(otherPage.getByRole("button", { name: "Edit post", exact: true })).toHaveCount(0);

	// The API refuses the edit too, not just the UI.
	const studentToken = await apiToken(request, STUDENT);
	const threads = await (await request.get(`${API}/forum/threads/`, { headers: { Authorization: `Token ${studentToken}` } })).json();
	const thread = threads.find((t: { body: string }) => t.body === body);
	const detail = await (await request.get(`${API}/forum/threads/${thread.id}/`, { headers: { Authorization: `Token ${studentToken}` } })).json();
	const res = await request.patch(`${API}/forum/posts/${detail.opening_post.id}/`, {
		headers: { Authorization: `Token ${otherToken}` },
		data: { body: "hijacked" },
	});
	expect(res.status()).toBe(403);
});

test("a student must agree to the forum rules before the forum loads", async ({ page, request }) => {
	const email = "rules@e2e.local";
	const token = await apiToken(request, email);
	const blocked = await request.get(`${API}/forum/threads/`, { headers: { Authorization: `Token ${token}` } });
	expect(blocked.status()).toBe(403);

	await loginAs(page, request, email);
	await page.goto("/forum");
	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText("Forum Rules");
	const accept = dialog.getByRole("button", { name: "Continue to forum" });
	await expect(accept).toBeDisabled();
	await dialog.getByLabel("I agree to follow the forum rules").check();
	await accept.click();

	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByPlaceholder(/share your thoughts/i)).toBeVisible();

	// Saved server-side, so it doesn't come back on reload.
	await page.reload();
	await expect(page.getByPlaceholder(/share your thoughts/i)).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the notification setup modal opens from the profile page", async ({ page, request }) => {
	await loginAs(page, request, STUDENT);
	await page.goto("/profile");
	await page.getByRole("button", { name: "Set up notifications" }).click();

	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText("Set up notifications");
	await expect(dialog.getByRole("button", { name: "Enable notifications" })).toBeVisible();

	await dialog.getByRole("button", { name: "Close" }).click();
	await expect(dialog).toHaveCount(0);
});

test("a student reads notifications from the dropdown", async ({ page, request }) => {
	await loginAs(page, request, STUDENT);
	await page.goto("/modules");

	// The unread count shows before the panel is opened.
	const toggle = page.getByRole("button", { name: /^Notifications/ });
	await expect(toggle).toContainText("12 unread");
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-expanded", "true");

	// Long lists scroll inside the panel instead of stretching the page.
	const list = page.getByRole("region", { name: "Notification list" });
	const { scrollHeight, clientHeight } = await list.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
	expect(scrollHeight).toBeGreaterThan(clientHeight);

	await page.getByRole("button", { name: "Mark as read: Your survey is ready" }).click();
	await expect(toggle).toContainText("11 unread");
	await expect(page.getByRole("button", { name: "Mark as read: Your survey is ready" })).toHaveCount(0);

	// Following a notification marks it read too, and it stays read after a reload.
	await page.getByRole("link", { name: /Week 2 is now available/ }).click();
	await expect(page).toHaveURL(/\/modules\/\d+\/?$/);
	await page.goto("/modules");
	await expect(toggle).toContainText("10 unread");

	await toggle.click();
	await page.getByRole("button", { name: "Mark all as read" }).click();
	await expect(toggle).not.toContainText("unread");
	await page.reload();
	await expect(page.getByRole("button", { name: /^Notifications/ })).not.toContainText("unread");
});

test("the notifications dropdown shows an empty state when nothing has been sent", async ({ page, request }) => {
	await loginAs(page, request, OTHER);
	await page.goto("/modules");
	await page.getByRole("button", { name: /^Notifications/ }).click();
	await expect(page.getByText("No notifications yet")).toBeVisible();
});

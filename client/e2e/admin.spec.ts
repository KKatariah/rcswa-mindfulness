import { expect, test } from "@playwright/test";
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

	page.once("dialog", (dialog) => dialog.accept());
	await firstDelete.click();
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

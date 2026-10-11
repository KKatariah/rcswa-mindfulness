import { expect, test } from "@playwright/test";
import { openNavMenu, PASSWORD, STUDENT } from "./helpers";

test("logs in with email and password", async ({ page }) => {
	await page.goto("/");
	await openNavMenu(page);
	await page.getByRole("button", { name: "Log In" }).filter({ visible: true }).click();
	await page.locator("#login-email").fill(STUDENT);
	await page.locator("#login-password").fill(PASSWORD);
	await page.getByRole("button", { name: "Login", exact: true }).click();
	await expect(page).toHaveURL(/\/modules$/);
});

test("rejects a wrong password", async ({ page }) => {
	await page.goto("/");
	await openNavMenu(page);
	await page.getByRole("button", { name: "Log In" }).filter({ visible: true }).click();
	await page.locator("#login-email").fill(STUDENT);
	await page.locator("#login-password").fill("not-the-password");
	await page.getByRole("button", { name: "Login", exact: true }).click();
	await expect(page.getByRole("dialog")).toContainText(/invalid credentials/i);
	await expect(page).toHaveURL(/\/$/);
});

test("sign up rejects a weak password, then accepts a strong one", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Sign Up" }).first().click();
	await page.locator("#signup-email").fill("newcomer@e2e.local");
	await page.locator("#signup-fullname").fill("New Comer");
	await page.locator("#signup-password").fill("password1");
	await page.locator("#signup-confirm-password").fill("password1");
	await page.getByRole("button", { name: "Sign up", exact: true }).click();
	await expect(page.getByRole("dialog")).toContainText(/too common/i);

	const visited: string[] = [];
	page.on("framenavigated", (frame) => {
		if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
	});
	await page.locator("#signup-password").fill("Quiet-Harbour-77");
	await page.locator("#signup-confirm-password").fill("Quiet-Harbour-77");
	await page.getByRole("button", { name: "Sign up", exact: true }).click();

	// New accounts wait for an admin to approve them, so they're signed in but kept on the home page,
	// without a detour through the programme page.
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => window.localStorage.getItem("token"))).not.toBeNull();
	await expect(page).toHaveURL(/\/$/);
	expect(visited).not.toContain("/modules");
	await page.goto("/modules");
	await expect(page).toHaveURL(/\/$/);
	const user = await page.evaluate(() => JSON.parse(window.localStorage.getItem("user") ?? "null"));
	expect(user).toMatchObject({ email: "newcomer@e2e.local", is_approved: false, enrollment_status: "pending" });
});

test("signed-out visitors are sent home from pages that need an account", async ({ page }) => {
	for (const path of ["/profile", "/forum", "/resources", "/surveys", "/surveys/1"]) {
		await page.goto(path);
		await expect(page, path).toHaveURL(/\/$/);
	}
});

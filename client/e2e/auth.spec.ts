import { expect, test } from "@playwright/test";
import { PASSWORD, STUDENT } from "./helpers";

test("logs in with email and password", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Log In" }).click();
	await page.locator("#login-email").fill(STUDENT);
	await page.locator("#login-password").fill(PASSWORD);
	await page.getByRole("button", { name: "Login", exact: true }).click();
	await expect(page).toHaveURL(/\/modules$/);
});

test("rejects a wrong password", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Log In" }).click();
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

	await page.locator("#signup-password").fill("Quiet-Harbour-77");
	await page.locator("#signup-confirm-password").fill("Quiet-Harbour-77");
	await page.getByRole("button", { name: "Sign up", exact: true }).click();
	await expect(page).toHaveURL(/\/modules$/);
});

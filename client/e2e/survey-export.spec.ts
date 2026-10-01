import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { ADMIN, loginAs } from "./helpers";

test("admin downloads survey responses as CSV", async ({ page, request }) => {
	await loginAs(page, request, ADMIN);
	await page.goto("/admin");
	await expect(page.getByRole("heading", { name: "Export responses" })).toBeVisible();

	const anonymous = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download CSV" }).click();
	const file = await anonymous;
	expect(file.suggestedFilename()).toMatch(/^survey-responses-all-\d{4}-\d{2}-\d{2}\.csv$/);
	const csv = await readFile(await file.path(), "utf-8");
	expect(csv).toContain("Seeded reflection for export.");
	expect(csv).not.toContain("responder@e2e.local");

	const identified = page.waitForEvent("download");
	await page.getByLabel("Include names and emails").check();
	await page.getByRole("button", { name: "Download CSV" }).click();
	expect(await readFile(await (await identified).path(), "utf-8")).toContain("responder@e2e.local");
});

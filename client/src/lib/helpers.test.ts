import { describe, expect, it } from "vitest";
import { errorMessage } from "@/lib/errors";
import { deleteModuleMessage } from "@/lib/modules";
import { weekLabel } from "@/lib/weeks";

describe("errorMessage", () => {
	it("uses an Error's message", () => {
		expect(errorMessage(new Error("Server said no"), "fallback")).toBe("Server said no");
	});

	it.each([["a string"], [{ message: "not an Error" }], [null], [undefined]])("falls back for %j", (thrown) => {
		expect(errorMessage(thrown, "Something went wrong")).toBe("Something went wrong");
	});
});

describe("weekLabel", () => {
	it("calls week 0 the introduction", () => {
		expect(weekLabel(0)).toBe("Introduction");
	});

	it("numbers the programme weeks", () => {
		expect(weekLabel(1)).toBe("Week 1");
		expect(weekLabel(8)).toBe("Week 8");
	});
});

describe("deleteModuleMessage", () => {
	it("says there is nothing to lose for an empty module", () => {
		expect(deleteModuleMessage(0)).toBe("This module has no content items yet. This can't be undone.");
	});

	it("uses the singular for one item", () => {
		expect(deleteModuleMessage(1)).toBe(
			"This will permanently delete 1 content item and all student completion history for it. This can't be undone.",
		);
	});

	it("uses the plural for several items", () => {
		expect(deleteModuleMessage(3)).toBe(
			"This will permanently delete 3 content items and all student completion history for them. This can't be undone.",
		);
	});
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { safeUrl } from "@/lib/safeUrl";

describe("safeUrl", () => {
	it.each([
		"https://example.com/talk.mp3",
		"http://example.com",
		"/media/resource_covers/c.png",
		"/",
	])("keeps %s", (url) => {
		expect(safeUrl(url)).toBe(url);
	});

	it.each([
		"javascript:alert(1)",
		"JavaScript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"vbscript:msgbox(1)",
		"file:///etc/passwd",
		"//evil.example.com/x.png",
		"not a url",
		"mailto:someone@example.com",
	])("rejects %s", (url) => {
		expect(safeUrl(url)).toBeUndefined();
	});

	it("treats empty values as missing", () => {
		expect(safeUrl(undefined)).toBeUndefined();
		expect(safeUrl(null)).toBeUndefined();
		expect(safeUrl("")).toBeUndefined();
		expect(safeUrl("   ")).toBeUndefined();
	});

	it("trims surrounding whitespace", () => {
		expect(safeUrl("  https://example.com  ")).toBe("https://example.com");
		expect(safeUrl("\n/about\t")).toBe("/about");
	});

	it("only ever returns a same-site path or an http(s) URL", () => {
		fc.assert(
			fc.property(fc.oneof(fc.string(), fc.webUrl(), fc.constantFrom("javascript:", "data:", "//")), (input) => {
				const out = safeUrl(input);
				if (out === undefined) return;
				const sameSitePath = out.startsWith("/") && !out.startsWith("//");
				expect(sameSitePath || /^https?:$/.test(new URL(out).protocol)).toBe(true);
			}),
		);
	});
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Markdown from "@/components/ui/Markdown";

function renderMarkdown(text: string) {
	return render(<Markdown>{text}</Markdown>).container;
}

describe("Markdown: admin-written content can't run code", () => {
	it("doesn't render raw HTML tags", () => {
		const container = renderMarkdown('Hello <script>window.hacked = true</script> <img src=x onerror="alert(1)"> world');
		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("[onerror]")).toBeNull();
	});

	it.each([
		["javascript:", "[click me](javascript:alert(1))"],
		["JavaScript: in mixed case", "[click me](JaVaScRiPt:alert(1))"],
		["vbscript:", "[click me](vbscript:msgbox(1))"],
		["data:", "[click me](data:text/html,<script>alert(1)</script>)"],
	])("strips %s link targets", (_label, text) => {
		renderMarkdown(text);
		const href = screen.getByText("click me").closest("a")?.getAttribute("href") ?? "";
		expect(href).not.toMatch(/^(javascript|vbscript|data):/i);
	});

	it("strips javascript: image sources", () => {
		const container = renderMarkdown("![pic](javascript:alert(1))");
		expect(container.querySelector("img")?.getAttribute("src") ?? "").not.toMatch(/^javascript:/i);
	});
});

describe("Markdown: formatting", () => {
	it("renders ordinary links, emphasis and lists", () => {
		renderMarkdown("Read **this** and [the guide](https://example.com/guide).\n\n- one\n- two");
		expect(screen.getByRole("link", { name: "the guide" })).toHaveAttribute("href", "https://example.com/guide");
		expect(screen.getByText("this").tagName).toBe("STRONG");
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
	});

	it("supports GitHub-flavoured tables and strikethrough", () => {
		const container = renderMarkdown("| Week | Topic |\n| --- | --- |\n| 1 | Breath |\n\n~~old~~");
		expect(screen.getByRole("table")).toBeInTheDocument();
		expect(container.querySelector("del")).toHaveTextContent("old");
	});
});

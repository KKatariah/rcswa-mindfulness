import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ContentEmbed from "@/components/modules/ContentEmbed";

const frame = () => document.querySelector("iframe");

describe("ContentEmbed: which URLs may load", () => {
	it.each([
		"https://www.youtube.com/embed/uaRFzaBehB4",
		"https://www.youtube-nocookie.com/embed/uaRFzaBehB4",
		"https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fa%2Fb",
	])("embeds the allowed player %s", (url) => {
		render(<ContentEmbed type="video" title="Intro" embedUrl={url} />);
		expect(frame()).toHaveAttribute("src", url);
	});

	it.each([
		["another site", "https://evil.example.com/embed/x"],
		["a look-alike host", "https://www.youtube.com.evil.com/embed/x"],
		["a subdomain trick", "https://evil.com/www.youtube.com/embed/x"],
		["a host without www", "https://youtube.com/embed/x"],
		["the SoundCloud site rather than its player", "https://soundcloud.com/a/b"],
		["plain http", "http://www.youtube.com/embed/x"],
		["a javascript: URL", "javascript:alert(1)"],
		["a data: URL", "data:text/html,<script>alert(1)</script>"],
		["a protocol-relative URL", "//www.youtube.com/embed/x"],
		["a same-site path", "/api/users/"],
		["user info hiding the real host", "https://www.youtube.com@evil.com/embed/x"],
		["nothing", undefined],
	])("shows the placeholder for %s", (_label, url) => {
		render(<ContentEmbed type="video" title="Intro" embedUrl={url} />);
		expect(frame()).toBeNull();
	});

	it("sandboxes players so they can't navigate this page", () => {
		render(<ContentEmbed type="audio" title="Body scan" embedUrl="https://w.soundcloud.com/player/?url=x" />);
		const sandbox = frame()!.getAttribute("sandbox")!.split(" ");
		expect(sandbox).toContain("allow-scripts");
		expect(sandbox).not.toContain("allow-top-navigation");
	});
});

describe("ContentEmbed: display", () => {
	it("labels videos 'Watch' and audio 'Listen'", () => {
		const { rerender } = render(<ContentEmbed type="video" title="Intro" />);
		expect(screen.getByText("Watch · Intro")).toBeInTheDocument();
		rerender(<ContentEmbed type="audio" title="Body scan" />);
		expect(screen.getByText("Listen · Body scan")).toBeInTheDocument();
	});

	it("names the player after the item", () => {
		render(<ContentEmbed type="video" title="Intro" embedUrl="https://www.youtube.com/embed/uaRFzaBehB4" />);
		expect(screen.getByTitle("Intro")).toBe(frame());
	});

	it("shows audio attribution, dropping unsafe links", () => {
		render(
			<ContentEmbed
				type="audio"
				title="Body scan"
				embedUrl="https://w.soundcloud.com/player/?url=x"
				attribution={{
					artistName: "Calm Voices",
					artistUrl: "https://soundcloud.com/calm",
					trackTitle: "Body Scan",
					trackUrl: "javascript:alert(1)",
				}}
			/>,
		);
		expect(screen.getByRole("link", { name: "Calm Voices" })).toHaveAttribute("href", "https://soundcloud.com/calm");
		expect(screen.getByText("Body Scan")).not.toHaveAttribute("href");
	});

	it("toggles completion from an accessible checkbox", async () => {
		const onToggle = vi.fn();
		const { rerender } = render(<ContentEmbed type="audio" title="Body scan" onToggleComplete={onToggle} />);

		await userEvent.click(screen.getByRole("checkbox", { name: "Mark as complete" }));
		expect(onToggle).toHaveBeenCalledOnce();

		rerender(<ContentEmbed type="audio" title="Body scan" completed onToggleComplete={onToggle} />);
		expect(screen.getByRole("checkbox", { name: "Mark as not complete" })).toBeChecked();
	});

	it("has no checkbox when completion can't be toggled", () => {
		render(<ContentEmbed type="video" title="Intro" />);
		expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
	});
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

function renderConfirm() {
	const onConfirm = vi.fn();
	const onCancel = vi.fn();
	render(
		<ConfirmDialog
			title="Delete cohort?"
			message="Students in it will be unenrolled."
			confirmLabel="Delete"
			danger
			onConfirm={onConfirm}
			onCancel={onCancel}
		/>,
	);
	return { onConfirm, onCancel, user: userEvent.setup() };
}

describe("ConfirmDialog", () => {
	it("is an alert dialog named and described by its text", () => {
		renderConfirm();
		const dialog = screen.getByRole("alertdialog", { name: "Delete cohort?" });
		expect(dialog).toHaveAccessibleDescription("Students in it will be unenrolled.");
		expect(dialog).toHaveAttribute("aria-modal", "true");
	});

	it("starts on Cancel, so a stray Enter doesn't confirm", async () => {
		const { onConfirm, onCancel, user } = renderConfirm();
		expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

		await user.keyboard("{Enter}");
		expect(onConfirm).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("confirms from the confirm button", async () => {
		const { onConfirm, user } = renderConfirm();
		await user.click(screen.getByRole("button", { name: "Delete" }));
		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it("cancels on Escape", async () => {
		const { onCancel, onConfirm, user } = renderConfirm();
		await user.keyboard("{Escape}");
		expect(onCancel).toHaveBeenCalledOnce();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("cancels when the backdrop is clicked, but not the dialog", async () => {
		const { onCancel, user } = renderConfirm();
		await user.click(screen.getByRole("alertdialog"));
		expect(onCancel).not.toHaveBeenCalled();
		await user.click(screen.getByRole("alertdialog").parentElement!);
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("keeps Tab between its two buttons", async () => {
		const { user } = renderConfirm();
		const confirm = screen.getByRole("button", { name: "Delete" });
		const cancel = screen.getByRole("button", { name: "Cancel" });

		await user.tab();
		expect(confirm).toHaveFocus();
		await user.tab();
		expect(cancel).toHaveFocus();
		await user.tab({ shift: true });
		expect(confirm).toHaveFocus();
		await user.tab({ shift: true });
		expect(cancel).toHaveFocus();
	});
});

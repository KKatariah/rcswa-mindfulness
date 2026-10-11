import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import Modal from "@/components/main/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

function renderModal(props: Partial<Parameters<typeof Modal>[0]> = {}) {
	const onClose = vi.fn();
	render(
		<Modal isOpen onClose={onClose} title="Edit user" {...props}>
			<input aria-label="Name" />
			<button type="button">Save</button>
		</Modal>,
	);
	return { onClose, user: userEvent.setup() };
}

/** A page button that opens a Modal, to check where focus goes back to. */
function OpensModal() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Open
			</button>
			<Modal isOpen={open} onClose={() => setOpen(false)} title="Settings">
				<button type="button">Inside</button>
			</Modal>
		</>
	);
}

describe("Modal", () => {
	it("renders nothing while closed", () => {
		render(<Modal isOpen={false} onClose={() => {}} title="Hidden" />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("is a modal dialog named by its title", () => {
		renderModal();
		const dialog = screen.getByRole("dialog", { name: "Edit user" });
		expect(dialog).toHaveAttribute("aria-modal", "true");
	});

	it("closes on Escape", async () => {
		const { onClose, user } = renderModal();
		await user.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("closes from its Close button", async () => {
		const { onClose, user } = renderModal();
		await user.click(screen.getByRole("button", { name: "Close" }));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("closes when the backdrop is clicked, but not the dialog itself", async () => {
		const { onClose, user } = renderModal();
		await user.click(screen.getByRole("dialog"));
		expect(onClose).not.toHaveBeenCalled();

		await user.click(screen.getByRole("dialog").parentElement!);
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("stays open when a drag starts inside and ends on the backdrop (e.g. selecting text)", async () => {
		const { onClose, user } = renderModal();
		const backdrop = screen.getByRole("dialog").parentElement!;
		await user.pointer([
			{ keys: "[MouseLeft>]", target: screen.getByLabelText("Name") },
			{ target: backdrop },
			{ keys: "[/MouseLeft]", target: backdrop },
		]);
		expect(onClose).not.toHaveBeenCalled();
	});

	it("moves focus into the dialog when it opens", () => {
		renderModal();
		expect(screen.getByRole("dialog")).toHaveFocus();
	});

	it("keeps Tab and Shift+Tab inside the dialog", async () => {
		const { user } = renderModal();
		const name = screen.getByLabelText("Name");
		const save = screen.getByRole("button", { name: "Save" });
		const close = screen.getByRole("button", { name: "Close" });

		await user.tab();
		expect(close).toHaveFocus();
		await user.tab();
		expect(name).toHaveFocus();
		await user.tab();
		expect(save).toHaveFocus();
		await user.tab();
		expect(close).toHaveFocus(); // wrapped round
		await user.tab({ shift: true });
		expect(save).toHaveFocus(); // and back again
	});

	it("returns focus to what opened it when it closes", async () => {
		const user = userEvent.setup();
		render(<OpensModal />);
		const opener = screen.getByRole("button", { name: "Open" });

		await user.click(opener);
		expect(screen.getByRole("dialog")).toHaveFocus();
		await user.keyboard("{Escape}");

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(opener).toHaveFocus();
	});

	it("leaves a ConfirmDialog opened inside it in charge of Escape and Tab", async () => {
		function EditWithConfirm({ onClose }: { onClose: () => void }) {
			const [confirming, setConfirming] = useState(false);
			return (
				<Modal isOpen onClose={onClose} title="Edit user">
					<button type="button" onClick={() => setConfirming(true)}>
						Delete user
					</button>
					{confirming && (
						<ConfirmDialog
							title="Delete user?"
							message="This can't be undone."
							confirmLabel="Delete"
							danger
							onConfirm={() => {}}
							onCancel={() => setConfirming(false)}
						/>
					)}
				</Modal>
			);
		}
		const onClose = vi.fn();
		const user = userEvent.setup();
		render(<EditWithConfirm onClose={onClose} />);

		await user.click(screen.getByRole("button", { name: "Delete user" }));
		const confirm = screen.getByRole("alertdialog");
		await user.tab();
		await user.tab();
		expect(confirm).toContainElement(document.activeElement as HTMLElement);

		await user.keyboard("{Escape}");
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Delete user" })).toHaveFocus();
	});
});

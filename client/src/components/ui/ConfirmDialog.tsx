import { useRef } from "react";
import { useDialogFocus } from "@/hooks/useDialogFocus";

export default function ConfirmDialog({
	title,
	message,
	confirmLabel,
	danger = false,
	onConfirm,
	onCancel,
}: {
	title: string;
	message: string;
	confirmLabel: string;
	danger?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	// Start on Cancel, the safe choice, so a stray Enter doesn't confirm.
	useDialogFocus(dialogRef, true, cancelRef);

	return (
		<div
			// z-[60] like Modal: above the mobile bottom nav (z-50).
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
			onClick={onCancel}
		>
			<div
				ref={dialogRef}
				tabIndex={-1}
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="confirm-dialog-title"
				aria-describedby="confirm-dialog-message"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key !== "Escape") return;
					// Stop here so a Modal underneath (e.g. the edit form that asked) stays open.
					e.stopPropagation();
					onCancel();
				}}
				className={`outline-none w-full max-w-[400px] rounded-2xl border-[3px] bg-white p-6 shadow-[0px_10px_20px_rgba(0,0,0,0.15)] ${danger ? "border-red-400" : "border-brand-blue"}`}
			>
				<h3 id="confirm-dialog-title" className="text-lg font-extrabold text-ink">{title}</h3>
				<p id="confirm-dialog-message" className="mt-2 text-sm text-ink-soft">{message}</p>
				<div className="mt-6 flex gap-3">
					<button
						type="button"
						onClick={onConfirm}
						className={`h-11 flex-1 rounded-xl text-sm font-bold text-white ${danger ? "bg-red-500" : "bg-brand-blue-dark"}`}
					>
						{confirmLabel}
					</button>
					<button
						ref={cancelRef}
						type="button"
						onClick={onCancel}
						className="h-11 flex-1 rounded-xl border border-gray-200 text-sm font-semibold text-ink"
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
}

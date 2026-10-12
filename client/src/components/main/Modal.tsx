import { useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "@/components/ui/icons";
import { useDialogFocus } from "@/hooks/useDialogFocus";

type ModalProps = {
	isOpen: boolean;
	onClose: () => void;
	title?: string;
	children?: ReactNode;
	/** Put the close button on its own row above the title (for long titles on small screens). */
	closeButtonAboveTitle?: boolean;
	/** A narrower dialog with a smaller title, for a short message rather than a form. */
	compact?: boolean;
};

export default function Modal({ isOpen, onClose, title, children, closeButtonAboveTitle = false, compact = false }: ModalProps) {
	const titleSize = compact ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl md:text-4xl";
	const padding = compact
		? closeButtonAboveTitle
			? "px-8 pb-8 pt-5 sm:px-10 sm:pb-10 sm:pt-6"
			: "p-8 sm:p-10"
		: closeButtonAboveTitle
			? "px-6 pb-6 pt-3 sm:px-8 sm:pb-8 md:px-12 md:pb-12 md:pt-4"
			: "p-6 sm:p-8 md:p-12";
	const mouseDownOnBackdrop = useRef(false);
	const dialogRef = useRef<HTMLDivElement>(null);
	useDialogFocus(dialogRef, isOpen);

	useEffect(() => {
		if (!isOpen) return;

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") onClose();
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	return (
		<div
			// z-[60]: above the mobile bottom nav (z-50).
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(event) => {
				mouseDownOnBackdrop.current = event.target === event.currentTarget;
			}}
			onClick={(event) => {
				if (event.target === event.currentTarget && mouseDownOnBackdrop.current) {
					onClose();
				}
				mouseDownOnBackdrop.current = false;
			}}
		>
			<div
				ref={dialogRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby={title ? "modal-title" : undefined}
				onClick={(event) => event.stopPropagation()}
				// max-h-full + the inner scroll area keep tall modals inside the viewport;
				// short ones size to their content as before.
				className={`outline-none flex max-h-full w-full flex-col overflow-hidden rounded-[32px] border-[6px] border-brand-blue bg-white shadow-pop ${compact ? "max-w-[480px]" : "max-w-[640px]"} ${padding}`}
			>
				{/* Padding stays on the dialog so the scrollbar sits inset inside it, not against the border. */}
				<div className="modal-scroll-content min-h-0 overscroll-contain">
					{closeButtonAboveTitle ? (
						// Close button on its own row so a long title can't run underneath it on narrow screens.
						<div className="flex flex-col items-end">
							<CloseButton onClose={onClose} compact />
							{title && (
								<h2 id="modal-title" className={`mt-1 w-full text-center font-extrabold text-ink ${titleSize}`}>
									{title}
								</h2>
							)}
						</div>
					) : (
						<div className="relative flex items-center justify-center">
							{title && (
								<h2 id="modal-title" className={`font-extrabold text-ink ${titleSize}`}>
									{title}
								</h2>
							)}
							<div className="absolute right-0 top-0">
								<CloseButton onClose={onClose} />
							</div>
						</div>
					)}

					{children && <div className="mt-6">{children}</div>}
				</div>
			</div>
		</div>
	);
}

function CloseButton({ onClose, compact = false }: { onClose: () => void; compact?: boolean }) {
	return (
		<button
			type="button"
			onClick={onClose}
			aria-label="Close"
			className={`flex items-center justify-center rounded-lg text-ink hover:bg-surface-muted cursor-pointer ${compact ? "size-8" : "size-12"}`}
		>
			<XIcon className={compact ? "size-5" : "size-6"} strokeWidth={2.5} />
		</button>
	);
}

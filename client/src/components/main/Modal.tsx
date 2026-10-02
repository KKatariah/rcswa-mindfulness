import { useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "@/components/ui/icons";

type ModalProps = {
	isOpen: boolean;
	onClose: () => void;
	title?: string;
	children?: ReactNode;
	closeButtonAboveTitle?: boolean;
};

export default function Modal({ isOpen, onClose, title, children, closeButtonAboveTitle = false }: ModalProps) {
	const mouseDownOnBackdrop = useRef(false);

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
			className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/50 p-4"
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
				role="dialog"
				aria-modal="true"
				aria-labelledby={title ? "modal-title" : undefined}
				onClick={(event) => event.stopPropagation()}
				className={`relative max-h-[calc(100dvh-2rem)] w-full max-w-[640px] overflow-hidden rounded-[32px] border-[6px] border-brand-blue bg-white shadow-[0px_10px_20px_rgba(0,0,0,0.15)] ${closeButtonAboveTitle ? "px-6 pb-6 pt-2 sm:px-8 sm:pb-8 sm:pt-3 md:px-12 md:pb-12 md:pt-4" : "p-6 sm:p-8 md:p-12"}`}
			>
				<div
					className={`modal-scroll-content overscroll-contain ${closeButtonAboveTitle ? "max-h-[calc(100dvh-2rem-44px)] sm:max-h-[calc(100dvh-2rem-56px)] md:max-h-[calc(100dvh-2rem-76px)]" : "max-h-[calc(100dvh-5rem-12px)] sm:max-h-[calc(100dvh-6rem-12px)] md:max-h-[calc(100dvh-8rem-12px)]"}`}
				>
					<div>
						<div className={closeButtonAboveTitle ? "flex flex-col items-end" : "relative flex items-center justify-center"}>
							{title && (
								<h2 id="modal-title" className={`text-2xl font-extrabold text-ink sm:text-3xl md:text-4xl ${closeButtonAboveTitle ? "order-2 w-full text-center" : ""}`}>
									{title}
								</h2>
							)}
							<button
								type="button"
								onClick={onClose}
								aria-label="Close"
								className={`${closeButtonAboveTitle ? "order-1 size-8" : "absolute right-0 top-0 size-12"} flex items-center justify-center rounded-lg text-ink hover:bg-surface-muted`}
							>
								<XIcon className={closeButtonAboveTitle ? "size-5" : "size-6"} strokeWidth={2.5} />
							</button>
						</div>

						{children && <div className="mt-6">{children}</div>}
					</div>
				</div>
			</div>
		</div>
	);
}

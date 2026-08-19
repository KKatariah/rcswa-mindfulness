import { useEffect, useId, type ReactNode } from "react";
import { XIcon } from "@/components/ui/icons";

type ModalProps = {
	isOpen: boolean;
	onClose: () => void;
	title?: string;
	children?: ReactNode;
};

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
	const titleId = useId();

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
			className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={title ? "modal-title" : undefined}
				onClick={(event) => event.stopPropagation()}
				className="w-full max-w-[640px] rounded-[32px] border-[6px] border-brand-blue bg-white p-12 shadow-[0px_10px_20px_rgba(0,0,0,0.15)]"
			>
				<div className="relative flex items-center justify-center">
					{title && (
						<h2 id="modal-title" className="text-4xl font-extrabold text-ink">
							{title}
						</h2>
					)}
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="absolute right-0 top-0 flex size-12 items-center justify-center rounded-lg text-ink hover:bg-surface-muted"
					>
						<XIcon className="size-6" strokeWidth={2.5} />
					</button>
				</div>

				{children && <div className="mt-6">{children}</div>}
			</div>
		</div>
	);
}

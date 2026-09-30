import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { XIcon } from "@/components/ui/icons";

type ModalProps = {
	isOpen: boolean;
	onClose: () => void;
	title?: string;
	children?: ReactNode;
	closeButtonAboveTitle?: boolean;
};

type ScrollbarState = {
	height: number;
	top: number;
	value: number;
	visible: boolean;
};

const EMPTY_SCROLLBAR: ScrollbarState = { height: 0, top: 0, value: 0, visible: false };

export default function Modal({ isOpen, onClose, title, children, closeButtonAboveTitle = false }: ModalProps) {
	const mouseDownOnBackdrop = useRef(false);
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	const scrollContentRef = useRef<HTMLDivElement>(null);
	const scrollbarTrackRef = useRef<HTMLDivElement>(null);
	const dragOffsetRef = useRef<number | null>(null);
	const scrollContentId = useId();
	const [scrollbar, setScrollbar] = useState<ScrollbarState>(EMPTY_SCROLLBAR);

	useEffect(() => {
		if (!isOpen) return;

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") onClose();
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	useEffect(() => {
		const scrollArea = scrollAreaRef.current;
		const scrollContent = scrollContentRef.current;
		const track = scrollbarTrackRef.current;
		if (!isOpen || !scrollArea || !scrollContent || !track) return;

		const updateScrollbar = () => {
			const trackHeight = track.clientHeight;
			const scrollHeight = scrollArea.scrollHeight;
			const maxScroll = scrollHeight - scrollArea.clientHeight;
			const visible = maxScroll > 0 && trackHeight > 0;
			const height = visible
				? Math.min(trackHeight, Math.max(24, (scrollArea.clientHeight / scrollHeight) * trackHeight))
				: 0;
			const maxThumbTop = Math.max(0, trackHeight - height);
			const top = visible && maxScroll > 0 ? (scrollArea.scrollTop / maxScroll) * maxThumbTop : 0;
			const value = maxScroll > 0 ? Math.round((scrollArea.scrollTop / maxScroll) * 100) : 0;

			setScrollbar({ height, top, value, visible });
		};

		const resizeObserver = new ResizeObserver(updateScrollbar);
		resizeObserver.observe(scrollArea);
		resizeObserver.observe(scrollContent);
		resizeObserver.observe(track);
		scrollArea.addEventListener("scroll", updateScrollbar, { passive: true });
		updateScrollbar();

		return () => {
			resizeObserver.disconnect();
			scrollArea.removeEventListener("scroll", updateScrollbar);
		};
	}, [children, isOpen]);

	const handleScrollbarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!scrollbar.visible) return;
		dragOffsetRef.current = event.clientY - event.currentTarget.getBoundingClientRect().top;
		event.currentTarget.setPointerCapture(event.pointerId);
		event.preventDefault();
	};

	const handleScrollbarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (dragOffsetRef.current === null) return;
		const scrollArea = scrollAreaRef.current;
		const track = scrollbarTrackRef.current;
		if (!scrollArea || !track) return;

		const maxScroll = scrollArea.scrollHeight - scrollArea.clientHeight;
		const maxThumbTop = track.clientHeight - scrollbar.height;
		if (maxScroll <= 0 || maxThumbTop <= 0) return;

		const desiredTop = event.clientY - track.getBoundingClientRect().top - dragOffsetRef.current;
		const top = Math.max(0, Math.min(maxThumbTop, desiredTop));
		scrollArea.scrollTop = (top / maxThumbTop) * maxScroll;
	};

	const handleScrollbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const scrollArea = scrollAreaRef.current;
		if (!scrollArea) return;

		const pageSize = scrollArea.clientHeight;
		switch (event.key) {
			case "ArrowDown":
				scrollArea.scrollTop += 40;
				break;
			case "ArrowUp":
				scrollArea.scrollTop -= 40;
				break;
			case "PageDown":
				scrollArea.scrollTop += pageSize;
				break;
			case "PageUp":
				scrollArea.scrollTop -= pageSize;
				break;
			case "Home":
				scrollArea.scrollTop = 0;
				break;
			case "End":
				scrollArea.scrollTop = scrollArea.scrollHeight;
				break;
			default:
				return;
		}
		event.preventDefault();
	};

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
					id={scrollContentId}
					ref={scrollAreaRef}
					className={`modal-scroll-content overscroll-contain ${closeButtonAboveTitle ? "max-h-[calc(100dvh-2rem-44px)] sm:max-h-[calc(100dvh-2rem-56px)] md:max-h-[calc(100dvh-2rem-76px)]" : "max-h-[calc(100dvh-5rem-12px)] sm:max-h-[calc(100dvh-6rem-12px)] md:max-h-[calc(100dvh-8rem-12px)]"}`}
				>
					<div ref={scrollContentRef}>
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

				<div ref={scrollbarTrackRef} className="pointer-events-none absolute bottom-4 right-[3px] top-4 z-10 w-2">
					<div
						role="scrollbar"
						aria-label="Modal content scrollbar"
						aria-controls={scrollContentId}
						aria-orientation="vertical"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={scrollbar.value}
						tabIndex={scrollbar.visible ? 0 : -1}
						onKeyDown={handleScrollbarKeyDown}
						onPointerDown={handleScrollbarPointerDown}
						onPointerMove={handleScrollbarPointerMove}
						onPointerUp={() => { dragOffsetRef.current = null; }}
						onPointerCancel={() => { dragOffsetRef.current = null; }}
						className="modal-scroll-thumb pointer-events-auto absolute left-0 right-0 rounded-full bg-gray-400"
						style={{ top: scrollbar.top, height: scrollbar.height, visibility: scrollbar.visible ? "visible" : "hidden" }}
					/>
				</div>
			</div>
		</div>
	);
}

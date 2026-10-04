import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "@/components/ui/icons";

export type SelectOption = { value: string; label: string };

export default function Select({
	value,
	onChange,
	options,
	placeholder = "Select…",
	id,
	className = "",
}: {
	value: string;
	onChange: (value: string) => void;
	options: SelectOption[];
	placeholder?: string;
	id?: string;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	useEffect(() => {
		if (!open) return;

		const button = buttonRef.current;
		if (button) {
			const r = button.getBoundingClientRect();
			setRect({ top: r.bottom, left: r.left, width: r.width });
		}

		function isInside(target: EventTarget | null) {
			const node = target as Node | null;
			return !!node && (containerRef.current?.contains(node) || listRef.current?.contains(node));
		}

		function handlePointerDown(e: MouseEvent) {
			if (!isInside(e.target)) setOpen(false);
		}
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		function handleScroll(e: Event) {
			// Ignore scrolling inside the option list itself; close on any other scroll
			// (e.g. an ancestor table wrapper) so the menu never drifts from its trigger.
			if (!isInside(e.target)) setOpen(false);
		}

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		window.addEventListener("scroll", handleScroll, true);
		window.addEventListener("resize", handleScroll);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("scroll", handleScroll, true);
			window.removeEventListener("resize", handleScroll);
		};
	}, [open]);

	const selected = options.find((o) => o.value === value);

	return (
		<div ref={containerRef} className="relative">
			<button
				ref={buttonRef}
				type="button"
				id={id}
				onClick={() => setOpen((o) => !o)}
				aria-haspopup="listbox"
				aria-expanded={open}
				className={`flex items-center justify-between gap-2 rounded-xl border border-gray-200 px-4 text-left text-[14px] text-ink outline-none focus:ring-2 focus:ring-brand-blue ${className}`}
			>
				<span className={`truncate ${selected ? "" : "text-muted"}`}>
					{selected ? selected.label : placeholder}
				</span>
				<ChevronDownIcon className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
			</button>

			{open && rect && typeof document !== "undefined" && createPortal(
				<ul
					ref={listRef}
					role="listbox"
					aria-labelledby={id}
					style={{ position: "fixed", top: rect.top + 8, left: rect.left, width: rect.width }}
					// z-[70]: above Modal and ConfirmDialog (z-[60]) so dropdowns inside them can be used.
					className="z-[70] max-h-60 overflow-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
				>
					{options.map((opt) => (
						<li key={opt.value} role="presentation">
							<button
								type="button"
								role="option"
								aria-selected={opt.value === value}
								onClick={() => {
									onChange(opt.value);
									setOpen(false);
								}}
								className={`block w-full px-4 py-2 text-left text-sm hover:bg-surface-muted ${
									opt.value === value ? "font-semibold text-brand-blue" : "text-ink"
								}`}
							>
								{opt.label}
							</button>
						</li>
					))}
				</ul>,
				document.body,
			)}
		</div>
	);
}

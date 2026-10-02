import type { KeyboardEvent, PointerEvent } from "react";
import { GripIcon } from "@/components/ui/icons";

export const REORDER_HELP_ID = "reorder-help";

/** Screen-reader instructions for DragHandle; render once per page that uses it. */
export function ReorderHelp() {
	return (
		<p id={REORDER_HELP_ID} className="sr-only">
			Drag this handle, or press the up and down arrow keys, to change the order.
		</p>
	);
}

/** Grip button for useDragReorder. `touch-none` lets a finger drag it instead of scrolling. */
export default function DragHandle({
	label,
	onPointerDown,
	onKeyDown,
	disabled = false,
}: {
	label: string;
	onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
	onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onPointerDown={onPointerDown}
			onKeyDown={onKeyDown}
			// Rows are sometimes links themselves; a press on the handle shouldn't open them.
			onClick={(e) => e.stopPropagation()}
			disabled={disabled}
			aria-label={label}
			aria-describedby={REORDER_HELP_ID}
			className="flex shrink-0 cursor-grab touch-none select-none items-center rounded p-2.5 text-muted hover:text-ink active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
		>
			<GripIcon className="size-4" />
		</button>
	);
}

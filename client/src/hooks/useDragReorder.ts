import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type ReorderHandlers<K> = {
	/** Called on every step of a drag (and once for a key press) with the new order. */
	onMove: (ids: K[]) => void;
	/** Called once on drop if the order changed. `before` is the order when the drag started. */
	onDrop: (ids: K[], before: K[]) => void;
	/** Called if the browser cancels the drag; restore `before`. */
	onCancel: (before: K[]) => void;
};

/**
 * Drag-to-reorder for a list whose rows carry `data-reorder-id={id}` and each have a handle.
 *
 * Uses pointer events (not HTML5 drag and drop) so it works the same for mouse, touch and pen;
 * the handle needs `touch-none` so pressing it doesn't scroll the page. The rest of the gesture is
 * followed on `window`, because re-rendering moves the dragged row's DOM node, which drops any
 * pointer capture the handle had. Arrow keys on the handle move a row one place.
 */
export function useDragReorder<K extends string | number>() {
	const [draggingId, setDraggingId] = useState<K | null>(null);
	const active = useRef(false);

	function startDrag(e: PointerEvent, id: K, ids: K[], handlers: ReorderHandlers<K>) {
		if (active.current || (e.pointerType === "mouse" && e.button !== 0)) return;
		e.preventDefault();
		const { pointerId } = e;
		const before = ids;
		// The order so far, updated on every move so the drop sees the last one even if React
		// hasn't re-rendered yet.
		let current = ids;
		active.current = true;
		setDraggingId(id);

		function onMove(ev: globalThis.PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-reorder-id]");
			// Only rows in this list are targets; rows in other lists are ignored.
			const over = current.find((k) => String(k) === row?.dataset.reorderId);
			if (over === undefined || over === id) return;
			const next = current.filter((k) => k !== id);
			// Moving down lands after the hovered row, moving up lands before it.
			const after = current.indexOf(id) < current.indexOf(over);
			next.splice(next.indexOf(over) + (after ? 1 : 0), 0, id);
			current = next;
			handlers.onMove(next);
		}

		function onEnd(ev: globalThis.PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onEnd);
			window.removeEventListener("pointercancel", onEnd);
			active.current = false;
			setDraggingId(null);
			// Releasing over a row fires a click on it, and some rows are links (e.g. the modules
			// list opens the module), so dropping would navigate away. Swallow that one click; it is
			// dispatched in this same task, so the timeout removes the listener if none comes.
			const swallowClick = (click: MouseEvent) => {
				click.stopPropagation();
				click.preventDefault();
			};
			window.addEventListener("click", swallowClick, { capture: true, once: true });
			setTimeout(() => window.removeEventListener("click", swallowClick, { capture: true }), 0);
			if (ev.type === "pointercancel") handlers.onCancel(before);
			else if (current.join() !== before.join()) handlers.onDrop(current, before);
		}

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onEnd);
		window.addEventListener("pointercancel", onEnd);
	}

	function handleKey(e: KeyboardEvent, id: K, ids: K[], handlers: ReorderHandlers<K>) {
		const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
		if (!step || active.current) return;
		e.preventDefault();
		const from = ids.indexOf(id);
		const to = from + step;
		if (to < 0 || to >= ids.length) return;
		const next = [...ids];
		[next[from], next[to]] = [next[to], next[from]];
		handlers.onMove(next);
		handlers.onDrop(next, ids);
	}

	return { draggingId, startDrag, handleKey };
}

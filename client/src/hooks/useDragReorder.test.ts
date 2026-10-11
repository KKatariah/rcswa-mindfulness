import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent, PointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDragReorder, type ReorderHandlers } from "@/hooks/useDragReorder";

// Rows are stacked 10px apart: y = 0–9 is row "a", 10–19 is "b", and so on.
const ROW_HEIGHT = 10;

function addRows(ids: (string | number)[], listId = "list") {
	const list = document.createElement("ul");
	list.id = listId;
	for (const id of ids) {
		const row = document.createElement("li");
		row.dataset.reorderId = String(id);
		row.append(document.createElement("span")); // a child, as if the pointer is over the row's text
		list.append(row);
	}
	document.body.append(list);
	return list;
}

/** jsdom has no layout, so map a y position onto the rows by index. */
function stubHitTesting() {
	document.elementFromPoint = vi.fn((_x: number, y: number) => {
		const rows = document.querySelectorAll<HTMLElement>("[data-reorder-id]");
		return rows[Math.floor(y / ROW_HEIGHT)]?.firstElementChild ?? null;
	});
}

/** The React pointerdown event startDrag receives from the handle. */
function pointerDown(overrides: Partial<{ pointerId: number; pointerType: string; button: number }> = {}) {
	return {
		pointerId: 1,
		pointerType: "mouse",
		button: 0,
		preventDefault: vi.fn(),
		...overrides,
	} as unknown as PointerEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

/** A pointer event on window, where the rest of the gesture is followed. */
function firePointer(type: "pointermove" | "pointerup" | "pointercancel", y: number, pointerId = 1) {
	act(() => {
		window.dispatchEvent(Object.assign(new Event(type), { pointerId, clientX: 5, clientY: y }));
	});
}

const rowY = (index: number) => index * ROW_HEIGHT + 5;

/** Reorders the list's rows to `ids`, as React re-rendering the list would. */
function renderOrder(list: HTMLElement, ids: (string | number)[]) {
	for (const id of ids) list.append(list.querySelector(`[data-reorder-id="${id}"]`)!);
}

/** Mock handlers; given a list, onMove reorders its rows like the real pages do. */
function handlers<K extends string | number>(list?: HTMLElement) {
	return {
		onMove: vi.fn((ids: K[]) => list && renderOrder(list, ids)),
		onDrop: vi.fn(),
		onCancel: vi.fn(),
	} satisfies ReorderHandlers<K>;
}

function key(name: string) {
	return { key: name, preventDefault: vi.fn() } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
	stubHitTesting();
});

afterEach(() => {
	document.body.innerHTML = "";
	// @ts-expect-error -- jsdom doesn't implement it; remove the stub again.
	delete document.elementFromPoint;
});

describe("useDragReorder: dragging", () => {
	it("marks the row being dragged and stops the browser's default press behaviour", () => {
		addRows(["a", "b", "c"]);
		const { result } = renderHook(() => useDragReorder<string>());
		const down = pointerDown();

		act(() => result.current.startDrag(down, "a", ["a", "b", "c"], handlers()));

		expect(result.current.draggingId).toBe("a");
		expect(down.preventDefault).toHaveBeenCalled();
	});

	it("moves a row down past the rows it is dragged over, then drops it", () => {
		const list = addRows(["a", "b", "c"]);
		const { result } = renderHook(() => useDragReorder<string>());
		const h = handlers<string>(list);

		act(() => result.current.startDrag(pointerDown(), "a", ["a", "b", "c"], h));
		firePointer("pointermove", rowY(1));
		firePointer("pointermove", rowY(2));
		firePointer("pointerup", rowY(2));

		expect(h.onMove.mock.calls).toEqual([[["b", "a", "c"]], [["b", "c", "a"]]]);
		expect(h.onDrop).toHaveBeenCalledExactlyOnceWith(["b", "c", "a"], ["a", "b", "c"]);
		expect(result.current.draggingId).toBeNull();
	});

	it("moves a row up, landing before the row it is over", () => {
		addRows([1, 2, 3]);
		const { result } = renderHook(() => useDragReorder<number>());
		const h = handlers<number>();

		act(() => result.current.startDrag(pointerDown(), 3, [1, 2, 3], h));
		firePointer("pointermove", rowY(0));
		firePointer("pointerup", rowY(0));

		expect(h.onDrop).toHaveBeenCalledExactlyOnceWith([3, 1, 2], [1, 2, 3]);
	});

	it("doesn't call onDrop when the row ends up where it started", () => {
		const list = addRows(["a", "b", "c"]);
		const { result } = renderHook(() => useDragReorder<string>());
		const h = handlers<string>(list);

		act(() => result.current.startDrag(pointerDown(), "a", ["a", "b", "c"], h));
		firePointer("pointermove", rowY(1));
		firePointer("pointermove", rowY(0));
		firePointer("pointerup", rowY(0));

		expect(h.onMove).toHaveBeenCalledTimes(2);
		expect(h.onDrop).not.toHaveBeenCalled();
	});

	it("ignores moves over the dragged row itself, gaps between rows, and rows of other lists", () => {
		addRows(["a", "b"]);
		addRows(["x", "y"], "other-list"); // rows 2 and 3 by y position
		const { result } = renderHook(() => useDragReorder<string>());
		const h = handlers<string>();

		act(() => result.current.startDrag(pointerDown(), "a", ["a", "b"], h));
		firePointer("pointermove", rowY(0)); // over itself
		firePointer("pointermove", rowY(3)); // a row in another list
		firePointer("pointermove", 500); // nothing there
		firePointer("pointerup", 500);

		expect(h.onMove).not.toHaveBeenCalled();
		expect(h.onDrop).not.toHaveBeenCalled();
	});

	it("restores the original order when the browser cancels the drag", () => {
		addRows(["a", "b", "c"]);
		const { result } = renderHook(() => useDragReorder<string>());
		const h = handlers<string>();

		act(() => result.current.startDrag(pointerDown(), "a", ["a", "b", "c"], h));
		firePointer("pointermove", rowY(2));
		firePointer("pointercancel", rowY(2));

		expect(h.onCancel).toHaveBeenCalledExactlyOnceWith(["a", "b", "c"]);
		expect(h.onDrop).not.toHaveBeenCalled();
		expect(result.current.draggingId).toBeNull();
	});

	it("follows only the pointer that started the drag (e.g. a second finger)", () => {
		addRows(["a", "b", "c"]);
		const { result } = renderHook(() => useDragReorder<string>());
		const h = handlers<string>();

		act(() => result.current.startDrag(pointerDown({ pointerId: 7, pointerType: "touch" }), "a", ["a", "b", "c"], h));
		firePointer("pointermove", rowY(2), 8);
		firePointer("pointerup", rowY(2), 8);
		expect(h.onMove).not.toHaveBeenCalled();
		expect(result.current.draggingId).toBe("a");

		firePointer("pointermove", rowY(1), 7);
		firePointer("pointerup", rowY(1), 7);
		expect(h.onDrop).toHaveBeenCalledExactlyOnceWith(["b", "a", "c"], ["a", "b", "c"]);
	});

	it("ignores right and middle mouse buttons", () => {
		addRows(["a", "b"]);
		const { result } = renderHook(() => useDragReorder<string>());

		for (const button of [1, 2]) {
			const down = pointerDown({ button });
			act(() => result.current.startDrag(down, "a", ["a", "b"], handlers()));
			expect(down.preventDefault).not.toHaveBeenCalled();
		}
		expect(result.current.draggingId).toBeNull();
	});

	it("doesn't start a second drag while one is in progress", () => {
		addRows(["a", "b", "c"]);
		const { result } = renderHook(() => useDragReorder<string>());
		const first = handlers<string>();
		const second = handlers<string>();

		act(() => result.current.startDrag(pointerDown({ pointerId: 1 }), "a", ["a", "b", "c"], first));
		act(() => result.current.startDrag(pointerDown({ pointerId: 2, pointerType: "touch" }), "c", ["a", "b", "c"], second));
		firePointer("pointermove", rowY(0), 2);
		firePointer("pointerup", rowY(0), 2);

		expect(second.onMove).not.toHaveBeenCalled();
		expect(result.current.draggingId).toBe("a");
	});

	it("stops listening once the drag ends", () => {
		addRows(["a", "b", "c"]);
		const { result } = renderHook(() => useDragReorder<string>());
		const h = handlers<string>();

		act(() => result.current.startDrag(pointerDown(), "a", ["a", "b", "c"], h));
		firePointer("pointerup", rowY(0));
		firePointer("pointermove", rowY(2));
		firePointer("pointerup", rowY(2));

		expect(h.onMove).not.toHaveBeenCalled();
		expect(h.onDrop).not.toHaveBeenCalled();
	});
});

describe("useDragReorder: keyboard", () => {
	it("moves a row down one place with ArrowDown and saves straight away", () => {
		const { result } = renderHook(() => useDragReorder<string>());
		const h = handlers<string>();
		const e = key("ArrowDown");

		result.current.handleKey(e, "a", ["a", "b", "c"], h);

		expect(e.preventDefault).toHaveBeenCalled();
		expect(h.onMove).toHaveBeenCalledExactlyOnceWith(["b", "a", "c"]);
		expect(h.onDrop).toHaveBeenCalledExactlyOnceWith(["b", "a", "c"], ["a", "b", "c"]);
	});

	it("moves a row up one place with ArrowUp", () => {
		const { result } = renderHook(() => useDragReorder<string>());
		const h = handlers<string>();

		result.current.handleKey(key("ArrowUp"), "c", ["a", "b", "c"], h);

		expect(h.onDrop).toHaveBeenCalledExactlyOnceWith(["a", "c", "b"], ["a", "b", "c"]);
	});

	it("does nothing past either end of the list", () => {
		const { result } = renderHook(() => useDragReorder<string>());
		const h = handlers<string>();

		result.current.handleKey(key("ArrowUp"), "a", ["a", "b"], h);
		result.current.handleKey(key("ArrowDown"), "b", ["a", "b"], h);

		expect(h.onMove).not.toHaveBeenCalled();
		expect(h.onDrop).not.toHaveBeenCalled();
	});

	it("leaves other keys alone, so Tab and Enter still work", () => {
		const { result } = renderHook(() => useDragReorder<string>());
		const h = handlers<string>();

		for (const name of ["Tab", "Enter", " ", "ArrowLeft"]) {
			const e = key(name);
			result.current.handleKey(e, "a", ["a", "b"], h);
			expect(e.preventDefault).not.toHaveBeenCalled();
		}
		expect(h.onMove).not.toHaveBeenCalled();
	});

	it("ignores arrow keys during a pointer drag", () => {
		addRows(["a", "b", "c"]);
		const { result } = renderHook(() => useDragReorder<string>());
		const h = handlers<string>();

		act(() => result.current.startDrag(pointerDown(), "a", ["a", "b", "c"], handlers()));
		result.current.handleKey(key("ArrowDown"), "b", ["a", "b", "c"], h);

		expect(h.onMove).not.toHaveBeenCalled();
	});
});

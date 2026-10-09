import { useEffect, type RefObject } from "react";

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard focus for a modal dialog: moves focus into it when it opens (to `initialFocus`, or the
 * dialog itself, which needs tabIndex={-1}), keeps Tab and Shift+Tab inside it, and puts focus back
 * where it was when it closes.
 */
export function useDialogFocus(
	dialogRef: RefObject<HTMLElement | null>,
	active: boolean,
	initialFocus?: RefObject<HTMLElement | null>,
) {
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!active || !dialog) return;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		(initialFocus?.current ?? dialog).focus();

		function trapTab(event: KeyboardEvent) {
			// A dialog opened inside this one (e.g. a ConfirmDialog in a Modal) has already handled it.
			if (event.key !== "Tab" || event.defaultPrevented || !dialog) return;
			const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
			if (focusable.length === 0) {
				event.preventDefault();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const current = document.activeElement;
			if (event.shiftKey && (current === first || current === dialog)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && current === last) {
				event.preventDefault();
				first.focus();
			}
		}

		dialog.addEventListener("keydown", trapTab);
		return () => {
			dialog.removeEventListener("keydown", trapTab);
			if (previous?.isConnected) previous.focus();
		};
		// initialFocus is a ref: reading .current when the dialog opens is enough.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [active, dialogRef]);
}

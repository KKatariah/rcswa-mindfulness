import type { ButtonHTMLAttributes } from "react";

/** Colour only, so each page keeps the button colour it already uses. */
const VARIANTS = {
	/** Light brand blue: page actions (Sign up, New…, Download CSV, Approve). */
	primary: "bg-brand-blue text-white hover:bg-brand-blue-dark",
	/** Navy: modal and form submit buttons (Log in, Save, Agree). */
	dark: "bg-brand-blue-dark text-white hover:bg-brand-blue-dark/90",
	danger: "bg-red-500 text-white hover:bg-red-600",
	secondary: "border border-gray-200 text-ink",
	/** White outline for the dark photo header, where a filled button would read as the main action. */
	onDark: "border border-white/60 text-white hover:bg-white/10",
} as const;

/** Height, corners, type and disabled look of the common button sizes. */
const SIZES = {
	/** Modals and full-width form buttons. */
	lg: "h-12 rounded-xl text-md font-bold disabled:opacity-50",
	/** Page and admin actions. */
	md: "h-11 rounded-xl text-sm font-bold disabled:opacity-50",
	/** Table row actions. */
	sm: "h-9 rounded-lg text-xs font-bold disabled:opacity-50",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

/**
 * Classes for a button, or a link styled as one. Padding and width come from `className`.
 * Pass `null` as the size when the button sets its own height, corners and type in `className`.
 */
export function buttonClass(variant: ButtonVariant, size: ButtonSize | null, className = "") {
	return ["inline-flex items-center justify-center gap-2 transition-colors enabled:cursor-pointer", VARIANTS[variant], size ? SIZES[size] : "", className]
		.filter(Boolean)
		.join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: ButtonVariant;
	size?: ButtonSize | null;
};

/** A `<button>` (type="button" unless set) in one of the shared variants and sizes. */
export default function Button({ variant = "primary", size = "md", className = "", type = "button", ...props }: ButtonProps) {
	return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

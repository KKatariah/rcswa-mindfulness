import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export type FieldSize = "md" | "lg";

const TEXT_SIZES: Record<FieldSize, string> = { md: "text-sm", lg: "text-[15px]" };
const FOCUS = "rounded-xl border border-gray-200 text-ink placeholder-muted outline-none focus:ring-2 focus:ring-brand-blue";

/** Classes for a text input. `md` suits inline admin forms, `lg` modals. */
export function inputClass(size: FieldSize = "lg", extra = "") {
	return `${size === "md" ? "h-11" : "h-12"} px-4 ${TEXT_SIZES[size]} ${FOCUS} ${extra}`.trim();
}

/** Classes for a textarea; pass resize-none or resize-y in `extra`. Text lines up with inputs (px-4). */
export function textareaClass(size: FieldSize = "lg", extra = "") {
	return `px-4 py-2.5 ${TEXT_SIZES[size]} ${FOCUS} ${extra}`.trim();
}

/** A label stacked above its control. */
export function Field({
	id,
	label,
	children,
	className = "",
}: {
	id: string;
	label: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={`flex flex-col gap-2 ${className}`}>
			<label htmlFor={id} className="text-sm font-semibold text-ink">
				{label}
			</label>
			{children}
		</div>
	);
}

type TextFieldProps = { id: string; label: ReactNode; size?: FieldSize } & Omit<
	InputHTMLAttributes<HTMLInputElement>,
	"id" | "size"
>;

export function TextField({ id, label, size = "lg", className = "", ...input }: TextFieldProps) {
	return (
		<Field id={id} label={label}>
			<input id={id} className={inputClass(size, className)} {...input} />
		</Field>
	);
}

type TextAreaFieldProps = { id: string; label: ReactNode; size?: FieldSize } & Omit<
	TextareaHTMLAttributes<HTMLTextAreaElement>,
	"id"
>;

export function TextAreaField({ id, label, size = "lg", className = "resize-none", ...textarea }: TextAreaFieldProps) {
	return (
		<Field id={id} label={label}>
			<textarea id={id} className={textareaClass(size, className)} {...textarea} />
		</Field>
	);
}

export function FormError({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p className="text-sm text-red-600" role="alert">
			{message}
		</p>
	);
}

/** Submit (and optional Cancel) buttons at the bottom of a form. */
export function FormActions({
	submitting,
	submitLabel = "Save",
	busyLabel = "Saving…",
	onCancel,
	size = "lg",
	className = "mt-2",
}: {
	submitting: boolean;
	submitLabel?: string;
	busyLabel?: string;
	onCancel?: () => void;
	size?: FieldSize;
	className?: string;
}) {
	const height = size === "md" ? "h-11 text-sm" : "h-12 text-[15px]";
	return (
		<div className={`flex gap-3 ${className}`}>
			<button
				type="submit"
				disabled={submitting}
				className={`${height} flex-1 rounded-xl bg-brand-blue-dark font-bold text-white disabled:opacity-50`}
			>
				{submitting ? busyLabel : submitLabel}
			</button>
			{onCancel && (
				<button
					type="button"
					onClick={onCancel}
					className={`${height} flex-1 rounded-xl border border-gray-200 font-semibold text-ink`}
				>
					Cancel
				</button>
			)}
		</div>
	);
}

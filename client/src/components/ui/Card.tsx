import type { HTMLAttributes } from "react";

const VARIANTS = {
	/** Student-facing pages. */
	page: "rounded-[10px] border border-gray-200 bg-white shadow-[0_6px_9px_rgba(0,0,0,0.05)]",
	/** Admin portal. */
	admin: "rounded-2xl border border-gray-200 bg-white",
} as const;

type CardProps = HTMLAttributes<HTMLElement> & {
	as?: "div" | "section" | "header" | "form" | "ul" | "ol" | "p";
	variant?: keyof typeof VARIANTS;
};

/** White bordered panel. Padding and layout come from `className`. */
export default function Card({ as: Tag = "div", variant = "page", className = "", ...rest }: CardProps) {
	return <Tag className={`${VARIANTS[variant]} ${className}`} {...rest} />;
}

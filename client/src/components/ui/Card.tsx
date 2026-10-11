import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLElement> & {
	as?: "div" | "section" | "header" | "form" | "ul" | "ol" | "p";
};

/** White bordered panel, the same on student and admin pages. Padding and layout come from `className`. */
export default function Card({ as: Tag = "div", className = "", ...rest }: CardProps) {
	return <Tag className={`rounded-xl border border-gray-200 bg-white shadow-card ${className}`} {...rest} />;
}

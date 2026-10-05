import type { ReactNode } from "react";

const TONES = {
	amber: "bg-amber-100 text-amber-700",
	green: "bg-green-100 text-green-700",
	blue: "bg-blue-100 text-blue-700",
	purple: "bg-purple-100 text-purple-700",
	gray: "bg-gray-100 text-gray-600",
} as const;

export type BadgeTone = keyof typeof TONES;

export default function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
	return (
		<span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${TONES[tone]}`}>
			{children}
		</span>
	);
}

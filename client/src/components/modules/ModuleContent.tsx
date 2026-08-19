import type { ReactNode } from "react";

type ModuleContentProps = {
	children: ReactNode;
};

export default function ModuleContent({ children }: ModuleContentProps) {
	return (
		<div className="space-y-4 rounded-3xl bg-white p-8 text-ink-soft shadow-[0px_10px_20px_rgba(0,0,0,0.08)]">
			{children} {/* will deal with making stuff look better later probably */}
		</div>
	);
}

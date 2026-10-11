import { CheckIcon, LockIcon, PlayIcon } from "@/components/ui/icons";

export type ProgressStatus = "completed" | "current" | "locked";

const STYLES: Record<ProgressStatus, string> = {
	completed: "bg-brand-blue text-white",
	current: "border-2 border-brand-blue bg-gray-100 text-brand-blue",
	locked: "bg-gray-100 text-gray-400",
};

/** Round done / in progress / locked marker for a week or survey. Size it with `className`. */
export default function StatusIcon({ status, className = "size-8" }: { status: ProgressStatus; className?: string }) {
	const Icon = status === "completed" ? CheckIcon : status === "current" ? PlayIcon : LockIcon;
	return (
		<span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full ${STYLES[status]} ${className}`}>
			<Icon className={status === "current" ? "ml-0.5 size-3.5" : "size-4"} />
		</span>
	);
}

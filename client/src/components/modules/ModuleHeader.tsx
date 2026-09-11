import { ClockIcon } from "@/components/ui/icons";

type ModuleHeaderProps = {
	title: string;
	durationMinutes: number;
	description: string;
	embedded?: boolean;
};

export default function ModuleHeader({
	title,
	durationMinutes,
	description,
	embedded = false,
}: ModuleHeaderProps) {
	return (
		<div className={embedded ? "px-6 pt-6 sm:px-10 sm:pt-10 lg:px-12 lg:pt-12" : "rounded-[10px] border border-gray-200 bg-white p-6 shadow-[0_6px_9px_rgba(0,0,0,0.05)]"}>
			<h1 className="text-2xl sm:text-3xl font-extrabold text-ink">{title}</h1>

			<div className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-ink">
				<ClockIcon className="size-4" />
				<span>{durationMinutes} minutes</span>
			</div>

			<p className="mt-2 text-sm text-muted">{description}</p>
		</div>
	);
}

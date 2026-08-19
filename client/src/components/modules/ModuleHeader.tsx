import { ClockIcon } from "@/components/ui/icons";

type ModuleHeaderProps = {
	title: string;
	durationMinutes: number;
	description: string;
};

export default function ModuleHeader({
	title,
	durationMinutes,
	description,
}: ModuleHeaderProps) {
	return (
		<div className="rounded-3xl bg-white p-8 shadow-[0px_10px_20px_rgba(0,0,0,0.08)]">
			<h1 className="text-3xl font-extrabold text-ink">{title}</h1>

			<div className="mt-3 flex items-center gap-2 text-sm font-medium text-muted">
				<ClockIcon className="size-4.5" />
				<span>{durationMinutes} minutes</span>
			</div>

			<p className="mt-3 text-muted">{description}</p>
		</div>
	);
}

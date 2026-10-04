import { ClockIcon } from "@/components/ui/icons";
import PageHeader from "@/components/ui/PageHeader";

type ModuleHeaderProps = {
	title: string;
	durationMinutes: number;
	description: string;
	embedded?: boolean;
	viewed?: boolean;
};

export default function ModuleHeader({
	title,
	durationMinutes,
	description,
	embedded = false,
	viewed = false,
}: ModuleHeaderProps) {
	return (
		<PageHeader title={title} description={description} embedded={embedded}>
			<div className="mt-2 flex flex-wrap items-center gap-3">
				<div className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
					<ClockIcon className="size-4" />
					<span>{durationMinutes} minutes</span>
				</div>
				{viewed && <span className="text-xs font-semibold text-muted">Viewed</span>}
			</div>
		</PageHeader>
	);
}

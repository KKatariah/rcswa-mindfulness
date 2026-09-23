import Link from "next/link";
import { CheckIcon, LockIcon, PlayIcon } from "@/components/ui/icons";

type SurveyLinkStatus = "completed" | "current" | "locked";

export type SurveyLinkItem = {
	id: string | number;
	label: string;
	status: SurveyLinkStatus;
	href?: string;
};

type SurveyLinksProps = {
	items?: SurveyLinkItem[];
};

const DEFAULT_SURVEYS: SurveyLinkItem[] = [
	{ id: 1, label: "Week 1", status: "locked" },
	{ id: 2, label: "Week 2", status: "locked" },
	{ id: 3, label: "Week 3", status: "locked" },
	{ id: 4, label: "Week 4", status: "locked" },
	{ id: 5, label: "Week 5", status: "locked" },
	{ id: 6, label: "Week 6", status: "locked" },
	{ id: 7, label: "Week 7", status: "locked" },
	{ id: 8, label: "Week 8", status: "locked" },
];

function SurveyStatusIcon({ status }: { status: SurveyLinkStatus }) {
	if (status === "completed") {
		return <CheckIcon className="size-4" aria-hidden="true" />;
	}

	if (status === "current") {
		return <PlayIcon className="ml-0.5 size-3.5" aria-hidden="true" />;
	}

	return <LockIcon className="size-4" aria-hidden="true" />;
}

export default function SurveyLinks({ items = DEFAULT_SURVEYS }: SurveyLinksProps) {
	return (
		<section aria-label="Weekly surveys" className="overflow-hidden rounded-[10px] border border-gray-200 bg-white shadow-[0_6px_18px_-6px_rgba(0,0,0,0.05)]">
			<ul>
				{items.map((item) => {
					const isLocked = item.status === "locked";
					const rowClassName = `flex min-h-[45px] items-center gap-3 border-b border-gray-200 px-3.5 text-sm font-semibold last:border-b-0 ${
						isLocked ? "text-muted" : "text-ink"
					}`;
					const iconClassName = `flex size-6 shrink-0 items-center justify-center rounded-full ${
						item.status === "locked" ? "bg-gray-100 text-gray-400" : "bg-brand-blue text-white"
					}`;

					return (
						<li key={item.id}>
							{isLocked ? (
								<div className={rowClassName} aria-disabled="true">
									<span className={iconClassName}><SurveyStatusIcon status={item.status} /></span>
									<span>{item.label}</span>
								</div>
							) : (
								<Link href={item.href ?? "#"} className={`${rowClassName} transition-colors hover:bg-brand-blue/5 focus-visible:bg-brand-blue/10 focus-visible:outline-none`} aria-current={item.status === "current" ? "page" : undefined}>
									<span className={iconClassName}><SurveyStatusIcon status={item.status} /></span>
									<span>{item.label}</span>
								</Link>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}

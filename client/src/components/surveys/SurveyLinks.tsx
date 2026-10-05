import Link from "next/link";
import Card from "@/components/ui/Card";
import StatusIcon, { type ProgressStatus } from "@/components/ui/StatusIcon";

export type SurveyLinkItem = {
	id: string | number;
	label: string;
	status: ProgressStatus;
	href?: string;
};

export default function SurveyLinks({ items }: { items: SurveyLinkItem[] }) {
	return (
		<Card as="section" aria-label="Weekly surveys" className="overflow-hidden">
			<ul>
				{items.map((item) => {
					const isLocked = item.status === "locked";
					const rowClassName = `flex min-h-[45px] items-center gap-3 border-b border-gray-200 px-3.5 text-sm font-semibold last:border-b-0 ${
						isLocked ? "text-muted" : "text-ink"
					}`;
					const content = (
						<>
							<StatusIcon status={item.status} className="size-6" />
							<span>{item.label}</span>
						</>
					);

					return (
						<li key={item.id}>
							{isLocked ? (
								<div className={rowClassName} aria-disabled="true">
									{content}
								</div>
							) : (
								<Link
									href={item.href ?? "#"}
									className={`${rowClassName} transition-colors hover:bg-brand-blue/5 focus-visible:bg-brand-blue/10 focus-visible:outline-none`}
									aria-current={item.status === "current" ? "page" : undefined}
								>
									{content}
								</Link>
							)}
						</li>
					);
				})}
			</ul>
		</Card>
	);
}

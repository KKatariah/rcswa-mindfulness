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
					const rowClassName = `flex items-center gap-4 px-6 py-4 text-sm font-semibold sm:text-base ${
						isLocked ? "text-muted" : "text-ink"
					}`;
					const content = (
						<>
							<StatusIcon status={item.status} />
							<span>{item.label}</span>
						</>
					);

					return (
						<li key={item.id} className="border-b border-gray-100 last:border-b-0">
							{isLocked ? (
								<div className={rowClassName} aria-disabled="true">
									{content}
								</div>
							) : (
								<Link
									href={item.href ?? "#"}
									className={`${rowClassName} transition-colors hover:bg-brand-blue/5 focus-visible:bg-brand-blue/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue`}
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

type SurveyHeaderProps = {
	title?: string;
	description?: string;
	embedded?: boolean;
};

export default function SurveyHeader({
	title = "Week 1 Survey",
	description = "Mindfulness Adherence Questionnaire",
	embedded = false,
}: SurveyHeaderProps) {
	return (
		<header
			className={
				embedded
					? "px-6 py-6 sm:px-10 lg:px-12"
					: "rounded-[10px] border border-gray-200 bg-white p-6 shadow-[0_4px_4px_-6px_rgba(0,0,0,0.05)]"
			}
		>
			<h1 className="text-2xl font-extrabold wrap-anywhere text-ink sm:text-3xl">{title}</h1>
			<p className="mt-2 text-sm text-muted sm:text-base">{description}</p>
		</header>
	);
}

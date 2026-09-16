import Head from "next/head";
import { useRouter } from "next/router";
import Sidebar from "@/components/main/Sidebar";
import SurveyHeader from "@/components/surveys/SurveyHeader";
import SurveyQuestions from "@/components/surveys/SurveyQuestions";

export default function SurveyPage() {
	const router = useRouter();
	const surveyId = router.query.surveyId;
	const weekNumber = Array.isArray(surveyId) ? surveyId[0] : surveyId;
	const title = `Week ${weekNumber ?? "1"} Survey`;

	return (
		<>
			<Head>
				<title>{title}</title>
			</Head>
			<div
				className="min-h-screen bg-cover bg-center bg-fixed bg-no-repeat p-4 lg:p-6 xl:h-dvh xl:overflow-hidden"
				style={{ backgroundImage: "url(/images/module-background.jpg)" }}
			>
				<div className="mx-auto grid max-w-[1920px] items-start gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
					<Sidebar responsive />
					<main
						role="region"
						aria-label={`${title} content`}
						tabIndex={0}
						className="flex min-w-0 flex-col gap-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue xl:h-[calc(100dvh-3rem)] xl:overflow-y-auto xl:overscroll-contain xl:[scrollbar-width:thin]"
					>
						<SurveyHeader title={title} />
						<SurveyQuestions />
					</main>
				</div>
			</div>
		</>
	);
}

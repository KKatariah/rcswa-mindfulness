import Head from "next/head";
import Sidebar from "@/components/main/Sidebar";
import SurveyHeader from "@/components/surveys/SurveyHeader";
import SurveyLinks from "@/components/surveys/SurveyLinks";

export default function SurveysHomePage() {
	return (
		<>
			<Head>
				<title>Weekly Surveys</title>
			</Head>
			<div
				className="min-h-screen bg-cover bg-center bg-fixed bg-no-repeat p-4 lg:p-6 xl:h-dvh xl:overflow-hidden"
				style={{ backgroundImage: "url(/images/module-background.jpg)" }}
			>
				<div className="mx-auto grid max-w-[1920px] items-start gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
					<Sidebar responsive />
					<main
						aria-label="Weekly surveys"
						tabIndex={0}
						className="flex min-w-0 flex-col gap-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue xl:h-[calc(100dvh-3rem)] xl:overflow-y-auto xl:overscroll-contain xl:[scrollbar-width:thin]"
					>
						<SurveyHeader
							title="Weekly Surveys"
							description="Complete each weekly survey to track your mindfulness practice."
						/>
						<SurveyLinks />
					</main>
				</div>
			</div>
		</>
	);
}

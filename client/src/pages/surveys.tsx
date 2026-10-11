import Head from "next/head";
import AppShell from "@/components/main/AppShell";
import Footer from "@/components/main/Footer";
import UpcomingSession from "@/components/modules/UpcomingSession";
import NotificationsPanel from "@/components/notifications/NotificationsPanel";
import { FullPageMessage } from "@/components/ui/feedback";
import PageHeader from "@/components/ui/PageHeader";
import SurveyLinks, { type SurveyLinkItem } from "@/components/surveys/SurveyLinks";
import { useAsync } from "@/hooks/useAsync";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { listSurveys } from "@/lib/api";

async function loadSurveyLinks(): Promise<SurveyLinkItem[]> {
	try {
		const surveys = await listSurveys();
		return surveys.map((survey) => ({
			id: survey.id,
			label: survey.title || `Week ${survey.id}`,
			status: survey.has_responded ? "completed" : survey.is_unlocked ? "current" : "locked",
			href: survey.is_unlocked ? `/surveys/${survey.id}` : undefined,
		}));
	} catch (error) {
		// The page shows an empty list rather than an error.
		console.error("Error loading surveys:", error);
		return [];
	}
}

export default function SurveysHomePage() {
	const { user, isLoading } = useRequireAuth();
	const { data: items } = useAsync(loadSurveyLinks, [user], [] as SurveyLinkItem[], { enabled: !isLoading && !!user });

	if (isLoading) {
		return <FullPageMessage>Loading...</FullPageMessage>;
	}

	return (
		<>
			<Head>
				<title>Weekly Surveys</title>
			</Head>
			<AppShell
				rightRail={
					<div className="space-y-4">
						<UpcomingSession />
						<NotificationsPanel />
					</div>
				}
			>
				<div className="flex min-w-0 flex-col gap-4">
					<PageHeader
						title="Weekly Surveys"
						description="Complete each weekly survey to track your mindfulness practice"
					/>
					<SurveyLinks items={items} />
				</div>
			</AppShell>
			<Footer />
		</>
	);
}

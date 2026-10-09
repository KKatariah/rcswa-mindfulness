import { useEffect, useState} from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import AppShell from "@/components/main/AppShell";
import Footer from "@/components/main/Footer";
import UpcomingSession from "@/components/modules/UpcomingSession";
import NotificationsPanel from "@/components/notifications/NotificationsPanel";
import SurveyHeader from "@/components/surveys/SurveyHeader";
import SurveyLinks, {type SurveyLinkItem } from "@/components/surveys/SurveyLinks";
import { useAuth } from "@/context/AuthContext";
import { listSurveys } from "@/lib/api";

export default function SurveysHomePage() {
	const router = useRouter();
	const { user, isLoading } = useAuth();
	const [items, setItems] = useState<SurveyLinkItem[]>([]);

	useEffect(() => {
		if (!isLoading && !user) {
			router.replace("/");
			return;
		}
	}, [isLoading, user, router]);

	useEffect(() => {
		if (isLoading || !user) return;

		let cancelled = false;

		async function loadSurverys() {
			try {
				const token = localStorage.getItem("token") ?? "";
				const data = await listSurveys(token);

				if (cancelled) return;

				const mapped: SurveyLinkItem[] = data.map((survey) => ({
					id: survey.id,
					label: survey.title || `Week ${survey.id}`,
					status: survey.has_responded
						? "completed"
						: survey.is_unlocked
							? "current"
							: "locked",
					href: survey.is_unlocked ? `/surveys/${survey.id}` : undefined,
				}));

				setItems(mapped);
			} catch (error) {
				console.error("Error loading surveys:", error);
				if (!cancelled) setItems([]);
			}
		}

		loadSurverys();

		return () => {
			cancelled = true;
		};
	}, [isLoading, user]);

	if (isLoading) {
		return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
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
				<main
					aria-label="Weekly surveys"
					tabIndex={0}
					className="flex min-w-0 flex-col gap-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
				>
					<SurveyHeader
						title="Weekly Surveys"
						description="Complete each weekly survey to track your mindfulness practice."
					/>
					<SurveyLinks items={items} />
				</main>
			</AppShell>
			<Footer />
		</>
	);
}

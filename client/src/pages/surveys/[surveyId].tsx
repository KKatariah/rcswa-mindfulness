import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Link from "next/link";
import AppShell from "@/components/main/AppShell";
import Modal from "@/components/main/Modal";
import SurveyHeader from "@/components/surveys/SurveyHeader";
import SurveyQuestions from "@/components/surveys/SurveyQuestions";
import { useAuth } from "@/context/AuthContext";
import { getSurvey, submitSurveyResponse, type ApiSurveyDetail } from "@/lib/api";

type NormalizedQuestion = {
	id: number;
	text: string;
}

type SubmissionFeedback = {
	title: string;
	message: string;
};

export default function SurveyPage() {
	const router = useRouter();
	const { surveyId } = router.query;
	const { user, isLoading: authLoading } = useAuth();

	useEffect(() => {
		if (!authLoading && !user) {
			router.replace("/");
		}
	}, [authLoading, user, router]);

	const [survey, setSurvey] = useState<ApiSurveyDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [submissionFeedback, setSubmissionFeedback] = useState<SubmissionFeedback | null>(null);

	useEffect(() => {
		if (authLoading || !router.isReady || !user) return;

		let cancelled = false;

		(async () => {
			const token = localStorage.getItem("token") ?? "";
			try {
				setLoading(true);
				setError(null);

				const surveyData = await getSurvey(String(surveyId), token);

				if (!cancelled) {
					setSurvey(surveyData);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : "Failed to load survey");
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [authLoading, router.isReady, surveyId, user]);

	const formalQuestions = useMemo<NormalizedQuestion[]>(() => {
		if (!survey?.questions) return [];

		return survey.questions
		.filter((q) => ["q3", "q4", "q5", "q6"].includes(q.id))
		.map((q) => ({
			id: Number(q.id.replace("q", "")),
			text: q.text,
		}));
	}, [survey]);

	const informalQuestions = useMemo<NormalizedQuestion[]>(() => {
		if (!survey?.questions) return [];

		return survey.questions
		.filter((q) => ["q7", "q8", "q9", "q10", "q11", "q12"].includes(q.id))
		.map((q) => ({
			id: Number(q.id.replace("q", "")),
			text: q.text,
		}));
	}, [survey]);
	
	const title = survey?.title || `Week ${surveyId ?? "1"} Survey`;

	const handleSubmit = async (answers: Record<number, number | string>) => {
		if (!surveyId || !user) return;

		const token = localStorage.getItem("token") ?? "";
		const payloadAnswers: Record<string, number | string> = {};

		Object.entries(answers).forEach(([key, value]) => {
			payloadAnswers[`q${Number(key)}`] = value;
		});

		try {
			const result = await submitSurveyResponse(
				{
					survey: Number(surveyId),
					answers: payloadAnswers,
				},
				token,
			);

			console.log("Survey submitted:", result);
			setSubmissionFeedback({
				title: "Response recorded",
				message: "Your survey responses have been recorded.",
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : "Please try again.";
			const alreadySubmitted = message.toLowerCase().includes("already submitted");
			setSubmissionFeedback({
				title: alreadySubmitted ? "Already submitted" : "Submission error",
				message: alreadySubmitted
					? "You have already submitted a response to this survey."
					: `We couldn't record your responses. ${message}`,
			});
		}
	};

	if (!authLoading && !user) {
		return (
			<div className="flex min-h-screen items-center justify-center p-6">
				<p className="text-ink-soft">
					Please <Link href="/" className="text-brand-blue underline">log in</Link> to view this survey.
				</p>
			</div>
    	);
	}

	if (loading || authLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center p-6">
        		<p className="text-ink-soft">Loading survey…</p>
      		</div>
		);
	}

	if (error || !survey) {
		return (
      		<div className="flex min-h-screen items-center justify-center p-6">
        		<p className="text-ink-soft">{error ?? "Survey not found."}</p>
      		</div>
    	);
	}

	return (
		<>
			<Head>
				<title>{title}</title>
			</Head>
			<Modal
				isOpen={submissionFeedback !== null}
				onClose={() => setSubmissionFeedback(null)}
				title={submissionFeedback?.title}
			>
				<div className="text-center">
					<p role="status" className="text-base leading-6 text-ink-soft">
						{submissionFeedback?.message}
					</p>
				</div>
			</Modal>
			<AppShell>
				<main
					role="region"
					aria-label={`${title} content`}
					tabIndex={0}
					className="flex min-w-0 flex-col gap-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
				>
					<SurveyHeader title={title} />
					<SurveyQuestions
						formalQuestions={formalQuestions}
						informalQuestions={informalQuestions}
						onSubmit={handleSubmit}
					/>
				</main>
			</AppShell>
		</>
	);
}

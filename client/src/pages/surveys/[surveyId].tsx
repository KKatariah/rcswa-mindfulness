import { useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Link from "next/link";
import AppShell from "@/components/main/AppShell";
import Modal from "@/components/main/Modal";
import Card from "@/components/ui/Card";
import { FullPageMessage } from "@/components/ui/feedback";
import PageHeader from "@/components/ui/PageHeader";
import SurveyQuestions from "@/components/surveys/SurveyQuestions";
import { useAsync } from "@/hooks/useAsync";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { getSurvey, submitSurveyResponse, type ApiSurveyDetail } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

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
	const { user, isLoading: authLoading } = useRequireAuth();

	const { data: survey, setData: setSurvey, loading, error } = useAsync(
		() => getSurvey(String(surveyId)),
		[surveyId, user],
		null as ApiSurveyDetail | null,
		{ enabled: !authLoading && router.isReady && !!user, errorFallback: "Failed to load survey" },
	);
	const [submitting, setSubmitting] = useState(false);
	const [submissionFeedback, setSubmissionFeedback] = useState<SubmissionFeedback | null>(null);

	// Only trust well-formed entries: a malformed question from the API is dropped rather than
	// crashing the page (e.g. a non-string id has no .replace, an object `text` can't render).
	const questions = useMemo(() => {
		if (!Array.isArray(survey?.questions)) return [];
		return survey.questions
			.filter((q) => q && typeof q === "object" && typeof q.id === "string")
			.map((q) => ({
				id: q.id,
				text: typeof q.text === "string" ? q.text : "",
				section: typeof q.section === "string" ? q.section : "",
			}));
	}, [survey]);

	const formalQuestions = useMemo<NormalizedQuestion[]>(() => {
		return questions
		.filter((q) => ["q3", "q4", "q5", "q6"].includes(q.id))
		.map((q) => ({
			id: Number(q.id.replace("q", "")),
			text: q.text,
		}));
	}, [questions]);

	const informalQuestions = useMemo<NormalizedQuestion[]>(() => {
		return questions
		.filter((q) => ["q7", "q8", "q9", "q10", "q11", "q12"].includes(q.id))
		.map((q) => ({
			id: Number(q.id.replace("q", "")),
			text: q.text,
		}));
	}, [questions]);
	
	// Wording for the questions SurveyQuestions lays out itself, so admin edits show up.
	const { questionText, sectionText } = useMemo(() => {
		const questionText: Record<number, string> = {};
		const sectionText: Record<number, string> = {};
		for (const q of questions) {
			const n = Number(q.id.replace("q", ""));
			if (q.text) questionText[n] = q.text;
			if (q.section) sectionText[n] = q.section;
		}
		return { questionText, sectionText };
	}, [questions]);

	const title = (typeof survey?.title === "string" && survey.title) || `Week ${surveyId ?? "1"} Survey`;

	const handleSubmit = async (answers: Record<number, number | string>) => {
		if (!surveyId || !user) return;

		const payloadAnswers: Record<string, number | string> = {};

		Object.entries(answers).forEach(([key, value]) => {
			payloadAnswers[`q${Number(key)}`] = value;
		});

		setSubmitting(true);
		try {
			await submitSurveyResponse({ survey: Number(surveyId), answers: payloadAnswers });
			setSurvey((current) => current && { ...current, has_responded: true });
			setSubmissionFeedback({
				title: "Response recorded",
				message: "Your survey responses have been recorded.",
			});
		} catch (err) {
			const message = errorMessage(err, "Please try again.");
			// Validation errors are also 400s, so ask the server whether a response
			// now exists (e.g. submitted from another tab) instead of parsing the message.
			const latest = await getSurvey(String(surveyId)).catch(() => null);
			if (latest?.has_responded) {
				setSurvey(latest);
				setSubmissionFeedback({
					title: "Already submitted",
					message: "You have already submitted a response to this survey.",
				});
			} else {
				setSubmissionFeedback({
					title: "Submission error",
					message: `We couldn't record your responses. ${message}`,
				});
			}
		} finally {
			setSubmitting(false);
		}
	};

	if (!authLoading && !user) {
		return (
			<FullPageMessage>
				Please <Link href="/" className="text-brand-blue underline">log in</Link> to view this survey.
			</FullPageMessage>
		);
	}

	if (loading || authLoading) {
		return <FullPageMessage>Loading survey…</FullPageMessage>;
	}

	if (error || !survey) {
		return <FullPageMessage>{error ?? "Survey not found."}</FullPageMessage>;
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
				closeButtonAboveTitle
			>
				<div className="text-center">
					<p className="text-base leading-6 text-ink-soft">
						{submissionFeedback?.message}
					</p>
				</div>
			</Modal>
			<AppShell>
				<section
					aria-label={`${title} content`}
					tabIndex={0}
					className="flex min-w-0 flex-col gap-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
				>
					<PageHeader title={title} description="Mindfulness Adherence Questionnaire" />
					{survey.has_responded ? (
						<Card as="section" role="status" className="p-6 text-center md:p-10">
							<p className="text-base font-bold text-ink">Thank you, your survey has been submitted.</p>
							<Link href="/surveys" className="mt-3 inline-block text-sm text-brand-blue underline">
								Back to surveys
							</Link>
						</Card>
					) : (
						<SurveyQuestions
							formalQuestions={formalQuestions}
							informalQuestions={informalQuestions}
							questionText={questionText}
							sectionText={sectionText}
							onSubmit={handleSubmit}
							isSubmitting={submitting}
						/>
					)}
				</section>
			</AppShell>
		</>
	);
}

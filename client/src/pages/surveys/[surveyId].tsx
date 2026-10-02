import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Link from "next/link";
import AppShell from "@/components/main/AppShell";
import SurveyHeader from "@/components/surveys/SurveyHeader";
import SurveyQuestions from "@/components/surveys/SurveyQuestions";
import { useAuth } from "@/context/AuthContext";
import { getSurvey, submitSurveyResponse, type ApiSurveyDetail } from "@/lib/api";

type NormalizedQuestion = {
	id: number;
	text: string;
}

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
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [submitted, setSubmitted] = useState(false);

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

		const token = localStorage.getItem("token") ?? "";
		const payloadAnswers: Record<string, number | string> = {};

		Object.entries(answers).forEach(([key, value]) => {
			payloadAnswers[`q${Number(key)}`] = value;
		});

		setSubmitting(true);
		setSubmitError(null);
		try {
			await submitSurveyResponse(
				{
					survey: Number(surveyId),
					answers: payloadAnswers,
				},
				token,
			);
			setSubmitted(true);
		} catch (err) {
			setSubmitError(err instanceof Error ? err.message : "Failed to submit survey");
		} finally {
			setSubmitting(false);
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
			<AppShell>
				<main
					role="region"
					aria-label={`${title} content`}
					tabIndex={0}
					className="flex min-w-0 flex-col gap-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
				>
					<SurveyHeader title={title} />
					{submitted || survey.has_responded ? (
						<section
							role="status"
							className="rounded-[10px] border border-gray-200 bg-white p-6 text-center shadow-[0_6px_18px_-6px_rgba(0,0,0,0.05)] md:p-10"
						>
							<p className="text-base font-bold text-ink">Thank you, your survey has been submitted.</p>
							<Link href="/surveys" className="mt-3 inline-block text-sm text-brand-blue underline">
								Back to surveys
							</Link>
						</section>
					) : (
						<>
							{submitError && (
								<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
									{submitError}
								</p>
							)}
							<SurveyQuestions
								formalQuestions={formalQuestions}
								informalQuestions={informalQuestions}
								questionText={questionText}
								sectionText={sectionText}
								onSubmit={handleSubmit}
								isSubmitting={submitting}
							/>
						</>
					)}
				</main>
			</AppShell>
		</>
	);
}

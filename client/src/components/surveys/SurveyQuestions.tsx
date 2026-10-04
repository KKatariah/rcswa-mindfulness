import { useState } from "react";

type ScaleQuestion = {
	id: number;
	text: string;
};

type SurveyQuestionsProps = {
	formalQuestions?: ScaleQuestion[];
	informalQuestions?: ScaleQuestion[];
	onSubmit?: (answers: Record<number, number | string>) => void;
	isSubmitting?: boolean;
};

const DEFAULT_FORMAL_QUESTIONS: ScaleQuestion[] = [
	{
		id: 3,
		text: "When meditating, how much of the time was your attention focused on what you intended to focus on (body, breath, sounds, etc.)?",
	},
	{
		id: 4,
		text: "When meditating, how much of the time were you noticing when you were getting distracted?",
	},
	{
		id: 5,
		text: "When meditating, how much of the time were you practicing an accepting attitude towards what you were experiencing?",
	},
	{
		id: 6,
		text: "When meditating, how much of the time were you practicing being gentle and compassionate towards yourself?",
	},
];

const DEFAULT_INFORMAL_QUESTIONS: ScaleQuestion[] = [
	{
		id: 7,
		text: "In your daily life, how much of the time were you practicing paying attention to everyday activities (e.g. eating, walking, chores, communicating etc.)?",
	},
	{
		id: 8,
		text: "In your daily life, how much of the time were you practicing paying attention while working or studying?",
	},
	{
		id: 9,
		text: "In your daily life, how much of the time were you practicing bringing your attention back to what you were doing when it wandered off?",
	},
	{
		id: 10,
		text: "In your daily life, how much of the time were you practicing being aware of your thoughts, emotions and reactions?",
	},
	{
		id: 11,
		text: "In your daily life, how much of the time were you practicing bringing an accepting attitude toward what you were experiencing?",
	},
	{
		id: 12,
		text: "In your daily life, how much of the time were you practicing being gentle and compassionate toward yourself?",
	},
];

const SCALE_VALUES = [0, 1, 2, 3, 4, 5, 6];

function ScaleQuestionGroup({
	questions,
	answers,
	onAnswer,
}: {
	questions: ScaleQuestion[];
	answers: Record<number, number | string>;
	onAnswer: (questionId: number, value: number) => void;
}) {
	return (
		<div className="mt-4 grid gap-3 md:mt-5 md:gap-4">
			{questions.map((question) => (
				<fieldset key={question.id} className="grid gap-2 md:gap-3">
					<legend className="text-sm leading-5 text-ink md:max-w-[620px] md:text-base">
						<span className="mr-2 font-semibold">{question.id}.</span>
						{question.text}
					</legend>
					<div aria-label={`Question ${question.id} scale`} className="w-full">
						<div
							className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-ink md:gap-2 md:text-xs"
							aria-hidden="true"
						>
							{SCALE_VALUES.map((value) => (
								<span key={value} className="font-semibold">
									{value}
								</span>
							))}
						</div>
						<div className="mt-1 grid grid-cols-7 gap-1 md:mt-2 md:gap-2">
							{SCALE_VALUES.map((value) => (
								<label key={value} className="flex justify-center">
									<span className="sr-only">{value}</span>
									<input
										type="radio"
										name={`question-${question.id}`}
										value={value}
										checked={answers[question.id] === value}
										onChange={() => onAnswer(question.id, value)}
										className="size-4 accent-[#5096CF] border-[#5096CF] bg-white checked:bg-[#5096CF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5096CF] md:size-4"
									/>
								</label>
							))}
						</div>
					</div>
				</fieldset>
			))}
		</div>
	);
}

// Matches LONGTEXT_MAX_CHARS in app/serializers.py.
const JOURNAL_MAX_CHARS = 5000;

export default function SurveyQuestions({
	formalQuestions = DEFAULT_FORMAL_QUESTIONS,
	informalQuestions = DEFAULT_INFORMAL_QUESTIONS,
	onSubmit,
	isSubmitting = false,
}: SurveyQuestionsProps) {
	const [answers, setAnswers] = useState<Record<number, number | string>>({});
	const journalWords = String(answers[13] ?? "").trim().split(/\s+/).filter(Boolean).length;

	const updateAnswer = (questionId: number, value: number | string) => {
		setAnswers((currentAnswers) => ({ ...currentAnswers, [questionId]: value }));
	};

	const submit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSubmit?.(answers);
	};

	return (
		<form onSubmit={submit} className="grid gap-4 pb-[calc(var(--mobile-bottom-nav-height)+var(--mobile-bottom-nav-safe))] md:gap-5 md:pb-0">
			<section className="rounded-[10px] border border-gray-200 bg-white p-4 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.05)] md:p-10">
				<h2 className="text-[13px] font-bold leading-5 text-ink md:text-base">
					Questions 1 to 6 ask about your <u>formal meditation practice</u> (e.g. sitting meditation).
				</h2>
				<div className="mt-4 grid gap-3 md:mt-5 md:max-w-[900px] md:gap-4">
					<label className="grid gap-2 text-sm leading-5 text-ink md:grid-cols-[minmax(0,1fr)_170px] md:items-center md:text-base">
						<span>1. How many times did you do formal meditation practice in the <u>past week</u>?</span>
						<input
							type="number"
							min="0"
							placeholder="Enter number..."
							className="h-9 rounded-xl border border-[#5b5a5a] bg-white px-3 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/30 md:h-8 md:px-4"
							onChange={(event) => updateAnswer(1, Number(event.target.value || 0))}
						/>
					</label>
					<label className="grid gap-2 text-sm leading-5 text-ink md:grid-cols-[minmax(0,1fr)_170px] md:items-center md:text-base">
						<span>2. What was the average duration of each meditation session (estimate in minutes)?</span>
						<input
							type="number"
							min="0"
							placeholder="Enter number..."
							className="h-9 rounded-xl border border-[#5b5a5a] bg-white px-3 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/30 md:h-8 md:px-4"
							onChange={(event) => updateAnswer(2, Number(event.target.value || 0))}
						/>
					</label>
				</div>
				<p className="mt-3 text-sm leading-4 text-ink md:mt-4 md:text-base">
					<span className="font-bold">(Note:</span> If you did not do <u>any</u> meditation practice in the past week, skip to question 7.)
				</p>
				<p className="mt-4 text-sm font-bold leading-5 text-ink md:mt-5 md:text-base">
					Please select the appropriate number (0 - not at all, 6 - all the time) to indicate how much each of the following were true for you over the <u>past week</u>.
				</p>
				<ScaleQuestionGroup questions={formalQuestions} answers={answers} onAnswer={updateAnswer} />
			</section>

			<section className="rounded-[10px] border border-gray-200 bg-white p-4 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.05)] md:p-10">
				<h2 className="text-sm font-bold leading-5 text-ink md:text-base">
					Questions 7 to 12 ask about your informal practice (being mindful in everyday life, outside of meditation sessions).
				</h2>
				<p className="mt-3 text-sm font-bold leading-5 text-ink md:mt-4 md:text-base">
					Again, please select the appropriate number to indicate how much each of the following were true for you over the <u>past week</u>.
				</p>
				<ScaleQuestionGroup questions={informalQuestions} answers={answers} onAnswer={updateAnswer} />
			</section>

			<section className="rounded-[10px] border border-gray-200 bg-white p-4 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.05)] md:p-10">
				<h2 className="text-sm font-bold text-ink md:text-base">Reflective Journal</h2>
				<p className="mt-3 text-sm leading-5 text-ink md:mt-4 md:text-base">
					Please write 100-250 words (4-5 sentences) reflecting on the following questions:
				</p>
				<ol className="mt-2 list-decimal pl-5 text-sm leading-5 text-ink md:pl-6 md:text-base">
					<li>How are you feeling this week?</li>
					<li>What has been your experience with the mindfulness intervention this week?</li>
				</ol>
				<textarea
					rows={4}
					placeholder="Enter reflection..."
					maxLength={JOURNAL_MAX_CHARS}
					aria-describedby="journal-word-count"
					className="mt-5 w-full resize-y rounded-xl border border-[#5b5a5a] bg-white px-3 py-3 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/30 md:mt-6"
					onChange={(event) => updateAnswer(13, event.target.value)}
				/>
				<p id="journal-word-count" className="mt-2 text-xs text-muted">
					{journalWords} {journalWords === 1 ? "word" : "words"} (aim for 100-250)
				</p>
			</section>

			<div className="flex justify-center pt-1 md:pt-2">
				<button
					type="submit"
					disabled={isSubmitting}
					className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-blue px-6 text-[15px] font-bold text-white shadow-[0px_6px_8px_rgba(0,0,0,0.1)] transition-colors hover:bg-brand-blue-dark hover:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isSubmitting ? "Submitting..." : "Submit survey"}
				</button>
			</div>
		</form>
	);
}

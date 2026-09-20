import { useState } from "react";

type ScaleQuestion = {
	id: number;
	text: string;
};

type SurveyQuestionsProps = {
	formalQuestions?: ScaleQuestion[];
	informalQuestions?: ScaleQuestion[];
	onSubmit?: (answers: Record<number, number | string>) => void;
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
		<div className="mt-5 grid gap-4">
			{questions.map((question) => (
				<fieldset key={question.id} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,530px)] sm:items-center sm:gap-6">
					<legend className="max-w-[620px] text-sm leading-5 text-ink sm:text-base">
						<span className="mr-2 font-semibold">{question.id}.</span>{question.text}
					</legend>
					<div aria-label={`Question ${question.id} scale`}>
						<div className="grid grid-cols-7 gap-2 text-center text-xs font-bold sm:gap-3" aria-hidden="true">
							{SCALE_VALUES.map((value) => <span key={value} className="underline">{value}</span>)}
						</div>
						<div className="mt-2 grid grid-cols-7 gap-2 sm:gap-3">
							{SCALE_VALUES.map((value) => (
								<label key={value} className="flex justify-center">
									<span className="sr-only">{value}</span>
									<input
										type="radio"
										name={`question-${question.id}`}
										value={value}
										checked={answers[question.id] === value}
										onChange={() => onAnswer(question.id, value)}
										className="size-4 accent-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
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

export default function SurveyQuestions({
	formalQuestions = DEFAULT_FORMAL_QUESTIONS,
	informalQuestions = DEFAULT_INFORMAL_QUESTIONS,
	onSubmit,
}: SurveyQuestionsProps) {
	const [answers, setAnswers] = useState<Record<number, number | string>>({});

	const updateAnswer = (questionId: number, value: number | string) => {
		setAnswers((currentAnswers) => ({ ...currentAnswers, [questionId]: value }));
	};

	const submit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSubmit?.(answers);
	};

	return (
		<form onSubmit={submit} className="grid gap-5">
			<section className="rounded-[10px] border border-gray-200 bg-white p-6 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.05)] sm:p-10">
				<h2 className="text-sm font-bold leading-5 text-ink sm:text-base">
					Questions 1 to 6 ask about your <u>formal meditation practice</u> (e.g. sitting meditation).
				</h2>
				<div className="mt-5 grid gap-4 sm:max-w-[900px]">
					<label className="grid gap-2 text-sm leading-5 text-ink sm:grid-cols-[minmax(0,1fr)_170px] sm:items-center sm:text-base">
						<span>1. How many times did you do formal meditation practice in the <u>past week</u>?</span>
						<input type="number" min="0" placeholder="Enter number..." className="h-8 rounded-xl border border-[#5b5a5a] px-4 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/30" onChange={(event) => updateAnswer(1, event.target.value)} />
					</label>
					<label className="grid gap-2 text-sm leading-5 text-ink sm:grid-cols-[minmax(0,1fr)_170px] sm:items-center sm:text-base">
						<span>2. What was the average duration of each meditation session (estimate in minutes)?</span>
						<input type="number" min="0" placeholder="Enter number..." className="h-8 rounded-xl border border-[#5b5a5a] px-4 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/30" onChange={(event) => updateAnswer(2, event.target.value)} />
					</label>
				</div>
				<p className="mt-4 text-xs leading-4 text-ink sm:text-sm">(Note: If you did not do <u>any</u> meditation practice in the past week, skip to question 7.)</p>
				<p className="mt-5 text-sm font-bold leading-5 text-ink sm:text-base">Please select the appropriate number (0 - not at all, 6 - all the time) to indicate how much each of the following were true for you over the <u>past week</u>.</p>
				<ScaleQuestionGroup questions={formalQuestions} answers={answers} onAnswer={updateAnswer} />
			</section>

			<section className="rounded-[10px] border border-gray-200 bg-white p-6 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.05)] sm:p-10">
				<h2 className="text-sm font-bold leading-5 text-ink sm:text-base">Questions 7 to 12 ask about your informal practice (being mindful in everyday life, outside of meditation sessions).</h2>
				<p className="mt-4 text-sm font-bold leading-5 text-ink sm:text-base">Again, please select the appropriate number to indicate how much each of the following were true for you over the <u>past week</u>.</p>
				<ScaleQuestionGroup questions={informalQuestions} answers={answers} onAnswer={updateAnswer} />
			</section>

			<section className="rounded-[10px] border border-gray-200 bg-white p-6 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.05)] sm:p-10">
				<h2 className="text-sm font-bold text-ink sm:text-base">Reflective Journal</h2>
				<p className="mt-4 text-sm leading-5 text-ink sm:text-base">Please write 100-250 words (4-5 sentences) reflecting on the following questions:</p>
				<ol className="mt-2 list-decimal pl-6 text-sm leading-5 text-ink sm:text-base">
					<li>How are you feeling this week?</li>
					<li>What has been your experience with the mindfulness intervention this week?</li>
				</ol>
				<textarea rows={3} placeholder="Enter reflection..." className="mt-6 w-full resize-y rounded-xl border border-[#5b5a5a] px-4 py-3 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/30" onChange={(event) => updateAnswer(13, event.target.value)} />
			</section>

			<div className="flex justify-end pt-2">
				<button
					type="submit"
					className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-blue px-6 text-[15px] font-bold text-white shadow-[0px_6px_8px_rgba(0,0,0,0.1)] transition-colors hover:bg-brand-blue-dark hover:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-50"
				>
					Submit survey
				</button>
			</div>
		</form>
	);
}

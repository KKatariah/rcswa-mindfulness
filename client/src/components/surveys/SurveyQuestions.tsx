import { useMemo, useState } from "react";
import Card from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { SurveyQuestion } from "@/types/admin";

export type SurveyAnswers = Record<string, number | string>;

type SurveyQuestionsProps = {
	questions: SurveyQuestion[];
	// Answers to questions skipped by a skip_if rule are left out.
	onSubmit?: (answers: SurveyAnswers) => void;
	isSubmitting?: boolean;
};

// Matches LONGTEXT_MAX_CHARS in app/serializers/surveys.py.
const JOURNAL_MAX_CHARS = 5000;

const fieldClass =
	"rounded-xl border border-[#5b5a5a] bg-white text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/30";

type Numbered = SurveyQuestion & { number: number };

/**
 * Split the survey into cards: a new card starts at every section heading, and each
 * free-text question gets a card of its own (an untitled one is the reflective journal).
 */
function groupIntoCards(questions: Numbered[]) {
	const cards: { heading?: string; journal: boolean; questions: Numbered[] }[] = [];
	for (const q of questions) {
		const last = cards[cards.length - 1];
		if (q.type === "longtext") {
			cards.push({ heading: q.section || "Reflective Journal", journal: !q.section, questions: [q] });
		} else if (!last || q.section || last.questions[0].type === "longtext") {
			cards.push({ heading: q.section || undefined, journal: false, questions: [q] });
		} else {
			last.questions.push(q);
		}
	}
	return cards;
}

function scaleValues(q: SurveyQuestion) {
	const lo = q.min ?? 0;
	const hi = q.max ?? 6;
	return Array.from({ length: Math.max(hi - lo + 1, 0) }, (_, i) => lo + i);
}

function scaleHint(q: SurveyQuestion, again: boolean) {
	const lo = q.scale_labels?.[String(q.min)];
	const hi = q.scale_labels?.[String(q.max)];
	const range = lo && hi ? ` (${q.min} - ${lo.toLowerCase()}, ${q.max} - ${hi.toLowerCase()})` : "";
	return `${again ? "Again, please" : "Please"} select the appropriate number${range} to indicate how much each of the following were true for you.`;
}

/** "skip to question 7", or "skip questions 2 to 6" when nothing follows them. */
function skipNote(controller: Numbered, dependents: Numbered[], total: number) {
	const value = dependents[0].skip_if!.value;
	const last = dependents[dependents.length - 1].number;
	const target = last < total ? `skip to question ${last + 1}` : `skip questions ${dependents[0].number} to ${last}`;
	return `If you answer ${value} to question ${controller.number}, ${target}.`;
}

/** Each question in a free-text prompt becomes its own list item. */
function splitPrompts(text: string) {
	return (text.match(/[^?]+\?|[^?]+$/g) ?? []).map((part) => part.trim()).filter(Boolean);
}

export default function SurveyQuestions({ questions, onSubmit, isSubmitting = false }: SurveyQuestionsProps) {
	const [answers, setAnswers] = useState<SurveyAnswers>({});
	const [confirmingClear, setConfirmingClear] = useState(false);

	const numbered = useMemo(() => questions.map((q, i) => ({ ...q, number: i + 1 })), [questions]);
	const cards = useMemo(() => groupIntoCards(numbered), [numbered]);

	const skipped = new Set(
		numbered.filter((q) => q.skip_if && answers[q.skip_if.question_id] === q.skip_if.value).map((q) => q.id),
	);
	const scaleIds = new Set(numbered.filter((q) => q.type === "likert").map((q) => q.id));
	const hasScaleAnswers = Object.keys(answers).some((id) => scaleIds.has(id));

	const updateAnswer = (id: string, value: number | string | undefined) => {
		setAnswers((current) => {
			const next = { ...current };
			if (value === undefined) delete next[id];
			else next[id] = value;
			return next;
		});
	};

	const clearScaleSelections = () => {
		setAnswers((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !scaleIds.has(id))));
		setConfirmingClear(false);
	};

	const submit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (isSubmitting) return;
		onSubmit?.(Object.fromEntries(Object.entries(answers).filter(([id]) => !skipped.has(id))));
	};

	function renderNumber(q: Numbered) {
		const dependents = numbered.filter((d) => d.skip_if?.question_id === q.id);
		return (
			<div key={q.id}>
				<label className="grid gap-2 text-sm leading-5 text-ink md:grid-cols-[minmax(0,1fr)_170px] md:items-center md:text-base">
					<span>
						{q.number}. {q.text}
						{q.unit && <span className="text-muted"> ({q.unit})</span>}
					</span>
					<input
						type="number"
						min="0"
						step="1"
						inputMode="numeric"
						placeholder="Enter number..."
						disabled={skipped.has(q.id)}
						value={answers[q.id] ?? ""}
						className={`h-9 px-3 md:h-8 md:px-4 disabled:opacity-50 ${fieldClass}`}
						onChange={(event) =>
							updateAnswer(q.id, event.target.value === "" ? undefined : Number(event.target.value))
						}
					/>
				</label>
				{dependents.length > 0 && (
					<p className="mt-3 text-sm leading-4 text-ink md:mt-4 md:text-base">
						<span className="font-bold">(Note:</span> {skipNote(q, dependents, numbered.length)})
					</p>
				)}
			</div>
		);
	}

	function renderScale(q: Numbered) {
		const values = scaleValues(q);
		const columns = { gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` };
		return (
			<fieldset key={q.id} disabled={skipped.has(q.id)} className="grid gap-2 disabled:opacity-50 md:gap-3">
				<legend className="text-sm leading-5 text-ink md:max-w-[620px] md:text-base">
					<span className="mr-2 font-semibold">{q.number}.</span>
					{q.text}
				</legend>
				<div aria-label={`Question ${q.number} scale`} className="w-full">
					<div
						className="grid gap-1 text-center text-2xs font-bold text-ink md:gap-2 md:text-xs"
						style={columns}
						aria-hidden="true"
					>
						{values.map((value) => (
							<span key={value} className="font-semibold">{value}</span>
						))}
					</div>
					<div className="mt-1 grid gap-1 md:mt-2 md:gap-2" style={columns}>
						{values.map((value) => (
							<label key={value} className="flex justify-center">
								<span className="sr-only">{q.scale_labels?.[String(value)] ?? value}</span>
								<input
									type="radio"
									name={`question-${q.number}`}
									value={value}
									checked={answers[q.id] === value}
									onChange={() => updateAnswer(q.id, value)}
									className="size-4 border-brand-blue bg-white cursor-pointer accent-brand-blue checked:bg-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
								/>
							</label>
						))}
					</div>
				</div>
			</fieldset>
		);
	}

	function renderLongtext(q: Numbered, journal: boolean) {
		const prompts = splitPrompts(q.text);
		const words = String(answers[q.id] ?? "").trim().split(/\s+/).filter(Boolean).length;
		const countId = `words-${q.id}`;
		return (
			<div key={q.id}>
				{journal && (
					<p className="mt-3 text-sm leading-5 text-ink md:mt-4 md:text-base">
						Please write 100-250 words (4-5 sentences) reflecting on the following questions:
					</p>
				)}
				{prompts.length > 1 ? (
					<ol className="mt-2 list-decimal pl-5 text-sm leading-5 text-ink md:pl-6 md:text-base">
						{prompts.map((prompt) => <li key={prompt}>{prompt}</li>)}
					</ol>
				) : (
					<p className="mt-2 text-sm leading-5 text-ink md:text-base">{q.text}</p>
				)}
				<textarea
					rows={4}
					placeholder={journal ? "Enter reflection..." : "Enter your answer..."}
					maxLength={JOURNAL_MAX_CHARS}
					aria-label={q.text}
					aria-describedby={countId}
					disabled={skipped.has(q.id)}
					value={answers[q.id] ?? ""}
					className={`mt-5 w-full resize-y px-3 py-3 disabled:opacity-50 md:mt-6 ${fieldClass}`}
					onChange={(event) => updateAnswer(q.id, event.target.value || undefined)}
				/>
				<p id={countId} className="mt-2 text-xs text-muted">
					{words} {words === 1 ? "word" : "words"}{journal && " (aim for 100-250)"}
				</p>
			</div>
		);
	}

	let scaleRunsSeen = 0;

	return (
		<form onSubmit={submit} className="grid gap-4 pb-[calc(var(--mobile-bottom-nav-height)+var(--mobile-bottom-nav-safe)-1rem)] md:gap-5 md:pb-0">
			{cards.map((card) => (
				<Card as="section" key={card.questions[0].id} className="p-4 md:p-10">
					{card.heading && (
						<h2 className="text-sm font-bold leading-5 text-ink md:text-base">{card.heading}</h2>
					)}
					{card.questions[0].type === "longtext" ? (
						renderLongtext(card.questions[0], card.journal)
					) : (
						<div className={`grid gap-3 md:max-w-[900px] md:gap-4 ${card.heading ? "mt-4 md:mt-5" : ""}`}>
							{card.questions.map((q, i) => {
								if (q.type !== "likert") return renderNumber(q);
								// Explain the scale at the start of each run of rating questions.
								const startsRun = i === 0 || card.questions[i - 1].type !== "likert";
								return startsRun ? (
									<div key={q.id} className="grid gap-3 md:gap-4">
										<p className="mt-1 text-sm font-bold leading-5 text-ink md:text-base">
											{scaleHint(q, scaleRunsSeen++ > 0)}
										</p>
										{renderScale(q)}
									</div>
								) : (
									renderScale(q)
								);
							})}
						</div>
					)}
				</Card>
			))}

			<div className="flex flex-nowrap items-center justify-center gap-3">
				{scaleIds.size > 0 && (
					<button
						type="button"
						disabled={isSubmitting || !hasScaleAnswers}
						onClick={() => setConfirmingClear(true)}
						className="inline-flex h-11 shrink-0 items-center justify-center cursor-pointer whitespace-nowrap rounded-xl border border-gray-300 bg-white px-5 text-md font-semibold text-ink-soft transition-colors hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-50 max-[380px]:h-10 max-[380px]:shrink max-[380px]:px-1.5 max-[380px]:text-2xs"
					>
						Clear selections
					</button>
				)}
				<button
					type="submit"
					disabled={isSubmitting}
					className="inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-brand-blue px-6 text-md font-bold text-white shadow-button transition-colors hover:bg-brand-blue-dark hover:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-50 max-[380px]:h-10 max-[380px]:shrink max-[380px]:px-1.5 max-[380px]:text-2xs"
				>
					{isSubmitting ? "Submitting..." : "Submit survey"}
				</button>
			</div>

			{confirmingClear && (
				<ConfirmDialog
					title="Clear selections?"
					message="This removes your answers to the rating questions. Your other answers and journal entry are kept."
					confirmLabel="Clear"
					danger
					onConfirm={clearScaleSelections}
					onCancel={() => setConfirmingClear(false)}
				/>
			)}
		</form>
	);
}

import { useState } from "react";
import Modal from "@/components/main/Modal";

export const FORUM_RULES: { title: string; body: string }[] = [
	{
		title: "Lead with kindness",
		body: "Assume good intent, and offer feedback the way you'd want to receive it.",
	},
	{
		title: "Respect confidentiality",
		body: "What's shared here stays here. Don't repeat others' personal stories outside the forum.",
	},
	{
		title: "Speak from your own experience",
		body: "Use \"I\" statements rather than telling others what they should feel or do.",
	},
	{
		title: "This isn't a substitute for professional care",
		body: "If someone shares something serious, encourage them to seek support rather than trying to diagnose or fix it.",
	},
	{
		title: "Avoid judgment or comparison",
		body: "There's no \"right\" way to practice, and no need to rank experiences.",
	},
	{
		title: "Stay on topic and spam-free",
		body: "Keep posts relevant to mindfulness and this community; no advertising or self-promotion.",
	},
	{
		title: "Disagree with care",
		body: "Different perspectives are welcome, but engage respectfully without dismissing others.",
	},
	{
		title: "Report, don't retaliate",
		body: "If a post feels harmful, flag it to the moderator rather than responding in kind.",
	},
];

export function ForumRulesList() {
	return (
		<ol className="list-decimal space-y-3 pl-5 text-sm text-ink">
			{FORUM_RULES.map((rule) => (
				<li key={rule.title}>
					<span className="font-bold">{rule.title}</span> — {rule.body}
				</li>
			))}
		</ol>
	);
}

type ForumRulesModalProps = {
	isOpen: boolean;
	onAccept: () => Promise<void>;
	onDecline: () => void;
};

export default function ForumRulesModal({ isOpen, onAccept, onDecline }: ForumRulesModalProps) {
	const [agreed, setAgreed] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit() {
		setSubmitting(true);
		setError(null);
		try {
			await onAccept();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Something went wrong");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Modal isOpen={isOpen} onClose={onDecline} title="Forum Rules" closeButtonAboveTitle>
			<p className="mb-4 text-sm text-[#6B7280]">
				Please read and agree to these rules before joining the discussion.
			</p>
			<ForumRulesList />

			<label className="mt-6 flex cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
				<input
					type="checkbox"
					checked={agreed}
					onChange={(e) => setAgreed(e.target.checked)}
					className="size-5 accent-brand-blue-dark"
				/>
				I agree to follow the forum rules
			</label>

			{error && <p className="mt-3 text-sm text-red-600">{error}</p>}

			<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
				<button
					type="button"
					onClick={onDecline}
					className="h-12 rounded-xl border border-gray-200 px-5 text-[15px] font-bold text-ink hover:bg-surface-muted"
				>
					Not now
				</button>
				<button
					type="button"
					onClick={handleSubmit}
					disabled={!agreed || submitting}
					className="h-12 rounded-xl bg-brand-blue-dark px-5 text-[15px] font-bold text-white disabled:opacity-50"
				>
					{submitting ? "Saving…" : "Continue to forum"}
				</button>
			</div>
		</Modal>
	);
}

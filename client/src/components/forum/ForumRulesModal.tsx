import { useState } from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/main/Modal";
import { errorMessage } from "@/lib/errors";
import Button from "@/components/ui/Button";
import type { ForumRule } from "@/types/forum";

function RuleNumber({ n, small = false }: { n: number; small?: boolean }) {
	return (
		<span
			className={`flex shrink-0 items-center justify-center rounded-full bg-brand-blue/15 font-bold text-brand-blue-dark ${small ? "size-6 text-xs" : "size-7 text-sm"}`}
		>
			{n}
		</span>
	);
}

/** Full rules (title + description) as one grouped list. Scrolls on its own so
 *  the agree checkbox and buttons below it stay in view on short screens. */
export function ForumRulesList({ rules }: { rules: ForumRule[] }) {
	return (
		<ol
			aria-label="Forum rules"
			tabIndex={0}
			className="max-h-[45vh] divide-y divide-gray-200 overflow-y-auto overscroll-contain rounded-2xl bg-surface-muted px-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
		>
			{rules.map((rule, i) => (
				<li key={i} className="flex gap-3 py-3">
					<RuleNumber n={i + 1} />
					<div className="min-w-0">
						<p className="text-sm font-bold text-ink">{rule.title}</p>
						{rule.body && <p className="mt-0.5 text-sm leading-snug text-muted">{rule.body}</p>}
					</div>
				</li>
			))}
		</ol>
	);
}

/** Compact sidebar version: rule titles only, with a link to the full rules. */
export function ForumRulesSummary({ rules }: { rules: ForumRule[] }) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<ol className="space-y-2.5">
				{rules.map((rule, i) => (
					<li key={i} className="flex items-start gap-2.5">
						<RuleNumber n={i + 1} small />
						<span className="pt-0.5 text-sm text-ink">{rule.title}</span>
					</li>
				))}
			</ol>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="mt-4 text-sm font-bold text-brand-blue-dark hover:underline"
			>
				Read full rules
			</button>
			<ForumRulesModal rules={rules} isOpen={open} onClose={() => setOpen(false)} />
		</>
	);
}

type ForumRulesModalProps = {
	rules: ForumRule[];
	isOpen: boolean;
	onClose: () => void;
	/** When given, the modal asks the user to agree; otherwise it's read-only. */
	onAccept?: () => Promise<void>;
	/** The user agreed to an earlier version; says the rules have changed. */
	updated?: boolean;
};

export default function ForumRulesModal({ rules, isOpen, onClose, onAccept, updated = false }: ForumRulesModalProps) {
	const [agreed, setAgreed] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit() {
		if (!onAccept) return;
		setSubmitting(true);
		setError(null);
		try {
			await onAccept();
		} catch (e) {
			setError(errorMessage(e, "Something went wrong"));
		} finally {
			setSubmitting(false);
		}
	}

	// Portal to <body>: the forum's sidebar creates its own stacking context,
	// which would otherwise trap the modal underneath the navbar.
	if (!isOpen || typeof document === "undefined") return null;

	return createPortal(
		<Modal isOpen={isOpen} onClose={onClose} title="Forum Rules" closeButtonAboveTitle>
			<div className="text-left">
				<p className="mb-5 text-center text-sm text-muted">
					{!onAccept
						? "This is a supportive space. Please keep these rules in mind when posting."
						: updated
							? "The forum rules have been updated. Please read and agree to the new rules to keep using the forum."
							: "This is a supportive space. Please read and agree to these rules before joining the discussion."}
				</p>
				<ForumRulesList rules={rules} />

				{onAccept ? (
					<>
						<label className="mt-6 flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-brand-blue/40 bg-brand-blue/5 p-4 text-sm font-semibold text-ink">
							<input
								type="checkbox"
								checked={agreed}
								onChange={(e) => setAgreed(e.target.checked)}
								className="size-5 shrink-0 accent-brand-blue-dark"
							/>
							I agree to follow the forum rules
						</label>

						{error && <p className="mt-3 text-sm text-red-600">{error}</p>}

						<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
							<button
								type="button"
								onClick={onClose}
								className="h-12 rounded-xl border border-gray-200 px-5 text-md font-bold text-ink hover:bg-surface-muted"
							>
								Not now
							</button>
							<Button
								type="button"
								onClick={handleSubmit}
								disabled={!agreed || submitting}
								variant="dark" size="lg" className="px-5"
							>
								{submitting ? "Saving…" : "Continue to forum"}
							</Button>
						</div>
					</>
				) : (
					<div className="mt-6 flex justify-end">
						<Button
							type="button"
							onClick={onClose}
							variant="dark" size="lg" className="px-5"
						>
							Got it
						</Button>
					</div>
				)}
			</div>
		</Modal>,
		document.body,
	);
}

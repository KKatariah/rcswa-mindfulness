import { type FormEvent, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DragHandle, { ReorderHelp } from "@/components/ui/DragHandle";
import { ErrorBanner, LoadingState } from "@/components/ui/feedback";
import { TextAreaField, TextField } from "@/components/ui/form";
import { PlusIcon, TrashIcon } from "@/components/ui/icons";
import { useAsync } from "@/hooks/useAsync";
import { useDragReorder, type ReorderHandlers } from "@/hooks/useDragReorder";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import { getForumRules, updateForumRules } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import type { ForumRule, ForumRules } from "@/types/forum";

// Same limits as the server (app/serializers/forum.py).
const MAX_RULES = 20;
const TITLE_MAX = 120;
const BODY_MAX = 500;

// Rows need a stable key for dragging, and rules have no id of their own.
type DraftRule = ForumRule & { key: number };

let nextKey = 1;
const toDraft = (rules: ForumRule[]): DraftRule[] => rules.map((r) => ({ ...r, key: nextKey++ }));
const toRules = (draft: DraftRule[]): ForumRule[] => draft.map(({ title, body }) => ({ title: title.trim(), body: body.trim() }));

/** Admins edit the forum rules here. Saving makes a new version, and by default every
 *  student has to agree to it before they can use the forum again. */
export default function ForumRulesEditor() {
	const current = useAsync(getForumRules, [], null, { errorFallback: "Failed to load the forum rules" });

	if (current.loading) return <LoadingState />;
	if (current.error || !current.data) return <ErrorBanner>{current.error ?? "No forum rules have been set."}</ErrorBanner>;
	// Keyed by version so a save starts the form over from what the server stored.
	return <RulesForm key={current.data.id} saved={current.data} onSaved={current.setData} />;
}

function RulesForm({ saved, onSaved }: { saved: ForumRules; onSaved: (rules: ForumRules) => void }) {
	const [draft, setDraft] = useState(() => toDraft(saved.rules));
	const [requireReaccept, setRequireReaccept] = useState(true);
	const [confirming, setConfirming] = useState(false);
	const [addedKey, setAddedKey] = useState<number | null>(null);
	const { submitting, error, setError, run } = useFormSubmit("Failed to save the forum rules");
	const { draggingId, startDrag, handleKey } = useDragReorder<number>();
	const dirty = JSON.stringify(toRules(draft)) !== JSON.stringify(saved.rules);
	const keys = draft.map((r) => r.key);

	function reorderTo(order: number[]) {
		setDraft((d) => {
			const byKey = new Map(d.map((r) => [r.key, r]));
			return order.map((k) => byKey.get(k)!);
		});
	}

	const reorder: ReorderHandlers<number> = { onMove: reorderTo, onDrop: () => {}, onCancel: reorderTo };

	function updateRule(index: number, changes: Partial<ForumRule>) {
		setDraft((d) => d.map((r, i) => (i === index ? { ...r, ...changes } : r)));
	}

	function addRule() {
		const key = nextKey++;
		setDraft((d) => [...d, { key, title: "", body: "" }]);
		setAddedKey(key);
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setConfirming(true);
	}

	function save() {
		setConfirming(false);
		run(async () => {
			onSaved(await updateForumRules(toRules(draft), requireReaccept));
		});
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<p className="text-sm text-muted">
				Students see these rules before they first use the forum, and in the forum&apos;s sidebar. Last changed{" "}
				{formatDateTime(saved.created_at)}
				{saved.updated_by_name && ` by ${saved.updated_by_name}`}.
			</p>

			<ReorderHelp />
			{draft.map((rule, index) => (
				<Card
					key={rule.key}
					data-reorder-id={rule.key}
					className={`p-5 ${draggingId === rule.key ? "opacity-50" : ""}`}
				>
					<div className="flex items-center gap-2">
						<DragHandle
							label={`Move rule ${index + 1}`}
							onPointerDown={(e) => startDrag(e, rule.key, keys, reorder)}
							onKeyDown={(e) => handleKey(e, rule.key, keys, reorder)}
							disabled={submitting}
						/>
						<span className="text-sm font-bold text-ink">Rule {index + 1}</span>
						<button
							type="button"
							onClick={() => setDraft((d) => d.filter((r) => r.key !== rule.key))}
							disabled={draft.length === 1}
							aria-label={`Remove rule ${index + 1}`}
							title={draft.length === 1 ? "The forum needs at least one rule" : "Remove rule"}
							className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
						>
							<TrashIcon className="size-4 cursor-pointer" />
						</button>
					</div>
					<div className="mt-4 space-y-4">
						<TextField
							id={`rule-title-${rule.key}`}
							label="Rule"
							size="md"
							required
							maxLength={TITLE_MAX}
							autoFocus={rule.key === addedKey}
							value={rule.title}
							onChange={(e) => updateRule(index, { title: e.target.value })}
						/>
						<TextAreaField
							id={`rule-body-${rule.key}`}
							label={
								<>
									Explanation <span className="font-normal text-muted">(optional)</span>
								</>
							}
							size="md"
							rows={2}
							maxLength={BODY_MAX}
							value={rule.body}
							onChange={(e) => updateRule(index, { body: e.target.value })}
							className="resize-y"
						/>
					</div>
				</Card>
			))}

			<button
				type="button"
				onClick={addRule}
				disabled={draft.length >= MAX_RULES || submitting}
				className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 text-sm font-semibold text-muted hover:border-brand-blue hover:text-brand-blue disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:text-muted enabled:cursor-pointer"
			>
				<PlusIcon className="size-4" />
				{draft.length >= MAX_RULES ? `At most ${MAX_RULES} rules` : "Add rule"}
			</button>

			{error && <ErrorBanner>{error}</ErrorBanner>}

			<div className="sticky bottom-4 space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.15)]">
				<label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
					<input
						type="checkbox"
						checked={requireReaccept}
						onChange={(e) => setRequireReaccept(e.target.checked)}
						className="mt-0.5 size-4 shrink-0 accent-brand-blue-dark cursor-pointer"
					/>
					<span>
						<span className="font-semibold">Ask students to agree to the rules again</span>
						<span className="block text-muted">
							Untick for small fixes like typos, so students who already agreed aren&apos;t asked again.
						</span>
					</span>
				</label>
				<div className="flex items-center gap-3">
					<Button type="submit" disabled={submitting || !dirty} variant="dark" size="md" className="px-6">
						{submitting ? "Saving…" : "Save rules"}
					</Button>
					{dirty && (
						<button
							type="button"
							onClick={() => {
								setDraft(toDraft(saved.rules));
								setError(null);
								setAddedKey(null);
							}}
							className="h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-ink cursor-pointer hover:bg-surface-muted"
						>
							Discard
						</button>
					)}
				</div>
			</div>

			{confirming && (
				<ConfirmDialog
					title="Save the new forum rules?"
					message={
						requireReaccept
							? "Every student will have to read and agree to the new rules before they can use the forum again."
							: "Students will see the new rules straight away. Anyone who has already agreed won't be asked again."
					}
					confirmLabel="Save rules"
					onConfirm={save}
					onCancel={() => setConfirming(false)}
				/>
			)}
		</form>
	);
}

/** Red panel for an irreversible action, e.g. deleting a module or survey. */
export default function DangerZone({
	description,
	actionLabel,
	onAction,
	disabled = false,
	className = "mt-4",
}: {
	description: string;
	actionLabel: string;
	onAction: () => void;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<div className={`flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 ${className}`}>
			<div>
				<p className="text-sm font-semibold text-red-700">Danger zone</p>
				<p className="text-xs text-red-600">{description}</p>
			</div>
			<button
				type="button"
				onClick={onAction}
				disabled={disabled}
				className="h-10 shrink-0 rounded-xl border border-red-300 px-4 text-sm font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
			>
				{actionLabel}
			</button>
		</div>
	);
}

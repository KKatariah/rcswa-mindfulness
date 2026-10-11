import { useState } from "react";
import Modal from "@/components/main/Modal";
import { resetUserPassword } from "@/lib/api";
import type { AdminUser } from "@/types/admin";
import Button from "@/components/ui/Button";

type Props = {
	user: AdminUser | null;
	onClose: () => void;
};

export default function ResetPasswordModal({ user, onClose }: Props) {
	const [tempPassword, setTempPassword] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	function close() {
		setTempPassword(null);
		setError(null);
		setCopied(false);
		onClose();
	}

	async function handleReset() {
		if (!user) return;
		setBusy(true);
		setError(null);
		try {
			const data = await resetUserPassword(user.id);
			setTempPassword(data.temporary_password);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to reset password");
		} finally {
			setBusy(false);
		}
	}

	async function handleCopy() {
		if (!tempPassword) return;
		try {
			await navigator.clipboard.writeText(tempPassword);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	const name = user ? user.full_name || user.display_name || user.email : "";

	return (
		<Modal isOpen={user !== null} onClose={close} title="Reset password">
			{user && tempPassword === null && (
				<div className="flex flex-col gap-5">
					<p className="text-md text-ink">
						Reset the password for <span className="font-semibold">{name}</span> ({user.email})?
					</p>
					<p className="text-sm text-muted">
						This creates a temporary password and signs them out of every device. Their old password will
						stop working straight away.
					</p>
					{error && (
						<p className="text-sm text-red-600" role="alert">
							{error}
						</p>
					)}
					<div className="flex gap-3">
						<button
							type="button"
							onClick={close}
							className="h-12 flex-1 rounded-xl border border-gray-200 text-md font-semibold text-ink"
						>
							Cancel
						</button>
						<Button
							type="button"
							onClick={handleReset}
							disabled={busy}
							variant="dark" size="lg" className="flex-1"
						>
							{busy ? "Resetting..." : "Reset password"}
						</Button>
					</div>
				</div>
			)}

			{user && tempPassword !== null && (
				<div className="flex flex-col gap-5">
					<p className="text-md text-ink">
						Temporary password for <span className="font-semibold">{name}</span>:
					</p>
					<div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
						<code className="min-w-0 flex-1 break-all text-lg font-bold tracking-wide text-ink">
							{tempPassword}
						</code>
						<button
							type="button"
							onClick={handleCopy}
							className="shrink-0 rounded-lg border border-brand-blue px-3 py-1.5 text-sm font-semibold text-brand-blue hover:bg-surface-muted"
						>
							{copied ? "Copied" : "Copy"}
						</button>
					</div>
					<p className="text-sm text-muted">
						This is only shown once. Send it to the student and ask them to change it from Profile → Reset
						Password.
					</p>
					<Button
						type="button"
						onClick={close}
						variant="dark" size="lg"
					>
						Done
					</Button>
				</div>
			)}
		</Modal>
	);
}

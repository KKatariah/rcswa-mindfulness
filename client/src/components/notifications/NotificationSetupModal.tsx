import { useState } from "react";
import Modal from "@/components/main/Modal";
import { enableNotifications } from "@/components/notifications/NotificationManager";
import {
	NOTIFICATION_SETUP_CONTENT,
	detectPlatform,
	type Platform,
} from "@/components/notifications/notificationSetupContent";
import StepVisual from "@/components/notifications/StepVisual";

type Props = {
	isOpen: boolean;
	onClose: () => void;
};

const PLATFORMS: Platform[] = ["ios", "android", "desktop"];

export default function NotificationSetupModal({ isOpen, onClose }: Props) {
	const [activeTab, setActiveTab] = useState<Platform>(detectPlatform);
	const [enabling, setEnabling] = useState(false);
	const [result, setResult] = useState<{ text: string; isError: boolean } | null>(null);

	const content = NOTIFICATION_SETUP_CONTENT[activeTab];

	async function handleEnable() {
		setEnabling(true);
		setResult(null);
		try {
			const message = await enableNotifications();
			setResult({ text: message, isError: false });
		} catch (err) {
			setResult({
				text:
					err instanceof Error
						? err.message
						: "Failed to enable notifications.",
				isError: true,
			});
		} finally {
			setEnabling(false);
		}
	}

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Set up notifications">
			{/* Platform tab selector */}
			<div
				role="tablist"
				aria-label="Select your device"
				className="flex gap-1 rounded-xl bg-gray-100 p-1"
			>
				{PLATFORMS.map((platform) => {
					const isActive = platform === activeTab;
					return (
						<button
							key={platform}
							type="button"
							role="tab"
							aria-selected={isActive}
							onClick={() => {
								setActiveTab(platform);
								setResult(null);
							}}
							className={[
								"flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
								isActive
									? "bg-white text-ink shadow-sm"
									: "text-muted hover:text-ink",
							].join(" ")}
						>
							{NOTIFICATION_SETUP_CONTENT[platform].tabLabel}
						</button>
					);
				})}
			</div>

			{/* Step list */}
			<div
				role="tabpanel"
				className="mt-6 max-h-[40vh] overflow-y-auto pr-1"
			>
				<ol className="space-y-5">
					{content.steps.map((step, index) => (
						<li key={index} className="flex gap-4">
							<span
								aria-hidden="true"
								className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-blue text-sm font-bold text-white"
							>
								{index + 1}
							</span>
							<div className="min-w-0 flex-1 pt-0.5">
								<p className="text-sm leading-relaxed text-muted">
									{step.instruction}
								</p>
								<StepVisual visual={step.visual} />
							</div>
						</li>
					))}
				</ol>
			</div>

			{/* Enable button */}
			<div className="mt-6 border-t border-gray-100 pt-6">
				<button
					type="button"
					onClick={handleEnable}
					disabled={enabling}
					className="w-full rounded-xl bg-brand-blue py-3 text-[15px] font-bold text-white shadow-[0px_6px_8px_rgba(0,0,0,0.1)] transition-opacity hover:opacity-90 disabled:opacity-60"
				>
					{enabling ? "Enabling…" : "Enable notifications"}
				</button>
				{result && (
					<p
						role={result.isError ? "alert" : "status"}
						className={[
							"mt-3 text-center text-sm",
							result.isError ? "text-red-600" : "text-green-600",
						].join(" ")}
					>
						{result.text}
					</p>
				)}
			</div>
		</Modal>
	);
}

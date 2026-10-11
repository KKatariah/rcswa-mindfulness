import { useState } from "react";
import Modal from "@/components/main/Modal";
import Tabs from "@/components/ui/Tabs";
import { errorMessage } from "@/lib/errors";
import { enableNotifications } from "@/lib/pushNotifications";
import {
	NOTIFICATION_SETUP_CONTENT,
	detectPlatform,
	type Platform,
} from "@/components/notifications/notificationSetupContent";
import StepVisual from "@/components/notifications/StepVisual";
import Button from "@/components/ui/Button";

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
			setResult({ text: errorMessage(err, "Failed to enable notifications."), isError: true });
		} finally {
			setEnabling(false);
		}
	}

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Set up notifications">
			<Tabs
				variant="pills"
				label="Select your device"
				tabs={PLATFORMS.map((platform) => ({ id: platform, label: NOTIFICATION_SETUP_CONTENT[platform].tabLabel }))}
				active={activeTab}
				onChange={(platform) => {
					setActiveTab(platform);
					setResult(null);
				}}
			/>

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
				<Button
					type="button"
					onClick={handleEnable}
					disabled={enabling}
					variant="primary" size={null} className="w-full rounded-xl py-3 text-md font-bold shadow-button hover:opacity-90 disabled:opacity-60"
				>
					{enabling ? "Enabling…" : "Enable notifications"}
				</Button>
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

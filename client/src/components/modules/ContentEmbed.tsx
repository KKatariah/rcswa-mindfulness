import { useId } from "react";
import { CheckIcon, PlayIcon } from "@/components/ui/icons";
import { safeUrl } from "@/lib/safeUrl";
import type { AudioAttribution } from "@/types/module";

// The API only stores YouTube and SoundCloud links; the CSP's frame-src in next.config.ts lists the same hosts.
const EMBED_HOSTS = new Set(["www.youtube.com", "www.youtube-nocookie.com", "w.soundcloud.com"]);

// Players need scripts and their own cookies; popups let "Watch on YouTube" open normally.
// Without allow-top-navigation they can't redirect this page.
const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";

/** The URL if it is an https link to an allowed player, otherwise undefined. */
function embeddableUrl(url?: string): string | undefined {
	const safe = safeUrl(url);
	if (!safe) return undefined;
	try {
		const { protocol, hostname } = new URL(safe);
		return protocol === "https:" && EMBED_HOSTS.has(hostname) ? safe : undefined;
	} catch {
		return undefined; // a same-site path, which is never a player
	}
}

type ContentEmbedProps = {
	type: "video" | "audio";
	title?: string;
	embedUrl?: string;
	attribution?: AudioAttribution;
	completed?: boolean;
	onToggleComplete?: () => void;
};

export default function ContentEmbed({
	type,
	title,
	embedUrl: rawEmbedUrl,
	attribution,
	completed = false,
	onToggleComplete,
}: ContentEmbedProps) {
	const checkboxId = useId();
	// Anything but an allowed player shows the "no media" placeholder instead of an iframe.
	const embedUrl = embeddableUrl(rawEmbedUrl);

	return (
		<div className="my-10 w-full max-w-[540px]">
			{(title || onToggleComplete) && (
				<div className="mb-2 flex items-center gap-2">
					{onToggleComplete && (
						<>
							<input
								id={checkboxId}
								type="checkbox"
								checked={completed}
								onChange={onToggleComplete}
								aria-label={completed ? "Mark as not complete" : "Mark as complete"}
								className="peer sr-only"
							/>
							<label
								htmlFor={checkboxId}
								className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-gray-300 text-transparent peer-checked:border-brand-blue peer-checked:bg-brand-blue peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-blue"
							>
								<CheckIcon className="size-3" strokeWidth={3} />
							</label>
						</>
					)}
					{title && (
						<p className="min-w-0 wrap-anywhere text-xs font-bold uppercase tracking-wide text-brand-blue">
							{type === "video" ? "Watch" : "Listen"} · {title}
						</p>
					)}
				</div>
			)}

			{!embedUrl ? (
				<div className="flex aspect-video w-full items-center justify-center rounded-xl bg-white">
					<span
						aria-hidden="true"
						className="flex size-16 items-center justify-center rounded-full border-4 border-gray-400 text-gray-500"
					>
						<PlayIcon className="ml-1 size-7" />
					</span>
				</div>
			) : type === "audio" ? (
				<>
					<iframe
						width="100%"
						height="166"
						src={embedUrl}
						title={title ?? "Audio content"}
						allow="autoplay; encrypted-media"
						sandbox={EMBED_SANDBOX}
						className="border-0"
					/>
					{attribution && (
						<div className="mt-2 break-words text-xs text-muted">
							<a
								href={safeUrl(attribution.artistUrl)}
								target="_blank"
								rel="noreferrer"
								className="hover:underline"
							>
								{attribution.artistName}
							</a>{" "}
							·{" "}
							<a
								href={safeUrl(attribution.trackUrl)}
								target="_blank"
								rel="noreferrer"
								className="hover:underline"
							>
								{attribution.trackTitle}
							</a>
						</div>
					)}
				</>
			) : (
				<div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
					<iframe
						src={embedUrl}
						title={title ?? "Video content"}
						className="size-full"
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
						sandbox={EMBED_SANDBOX}
						allowFullScreen
					/>
				</div>
			)}
		</div>
	);
}

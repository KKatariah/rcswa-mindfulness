import { PlayIcon } from "@/components/ui/icons";
import type { AudioAttribution } from "@/types/module";

type ContentEmbedProps = {
	type: "video" | "audio";
	title?: string;
	embedUrl?: string;
	attribution?: AudioAttribution;
};

export default function ContentEmbed({
	type,
	title,
	embedUrl,
	attribution,
}: ContentEmbedProps) {
	return (
		<div className="my-10 w-full max-w-[540px]">
			{title && (
				<p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-blue">
					{type === "video" ? "Watch" : "Listen"} · {title}
				</p>
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
						className="border-0"
					/>
					{attribution && (
						<div className="mt-2 break-words text-xs text-muted">
							<a
								href={attribution.artistUrl}
								target="_blank"
								rel="noreferrer"
								className="hover:underline"
							>
								{attribution.artistName}
							</a>{" "}
							·{" "}
							<a
								href={attribution.trackUrl}
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
						allowFullScreen
					/>
				</div>
			)}
		</div>
	);
}

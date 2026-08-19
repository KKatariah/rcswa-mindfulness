import { PlayIcon } from "@/components/ui/icons";

type Attribution = {
	artistName: string;
	artistUrl: string;
	trackTitle: string;
	trackUrl: string;
};

type ContentEmbedProps = {
	type: "video" | "audio";
	title?: string;
	embedUrl?: string;
	attribution?: Attribution;
};

export default function ContentEmbed({
	type,
	title,
	embedUrl,
	attribution,
}: ContentEmbedProps) {
	if (!embedUrl) {
		return (
			<div className="mx-auto flex aspect-video w-full max-w-xl items-center justify-center rounded-xl bg-gray-200">
				<span
					aria-hidden="true"
					className="flex size-16 items-center justify-center rounded-full border-4 border-gray-400 text-gray-500"
				>
					<PlayIcon className="ml-1 size-7" />
				</span>
			</div>
		);
	}

	if (type === "audio") {
		return (
			<div className="mx-auto w-full max-w-xl">
				<iframe
					width="100%"
					height="166"
					src={embedUrl}
					title={title ?? "Audio content"}
					allow="autoplay; encrypted-media"
					className="border-0"
				/>
				{attribution && (
					<div className="mt-1 truncate text-[10px] text-[#999999]">
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
			</div>
		);
	}

	return (
		<div className="mx-auto aspect-video w-full max-w-xl overflow-hidden rounded-xl bg-black">
			<iframe
				src={embedUrl}
				title={title ?? "Video content"}
				className="size-full"
				allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
				allowFullScreen
			/>
		</div>
	);
}

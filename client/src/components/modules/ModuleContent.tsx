import ContentEmbed from "@/components/modules/ContentEmbed";
import type { ContentBlock } from "@/types/module";

type ModuleContentProps = {
	blocks: ContentBlock[];
};

export default function ModuleContent({ blocks }: ModuleContentProps) {
	return (
		<div className="space-y-4 rounded-3xl bg-white p-8 text-ink-soft shadow-[0px_10px_20px_rgba(0,0,0,0.08)]">
			{blocks.map((block) => {
				if (block.type === "text") {
					return <p key={block.id}>{block.content}</p>;
				}

				return (
					<ContentEmbed
						key={block.id}
						type={block.type}
						title={block.title}
						embedUrl={block.embedUrl}
						attribution={block.type === "audio" ? block.attribution : undefined}
					/>
				);
			})}
		</div>
	);
}

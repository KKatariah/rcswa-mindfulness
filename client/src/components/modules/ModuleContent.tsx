import ContentEmbed from "@/components/modules/ContentEmbed";
import Markdown from "@/components/ui/Markdown";
import type { ContentBlock } from "@/types/module";

type ModuleContentProps = {
	blocks: ContentBlock[];
	embedded?: boolean;
	onToggleComplete?: (contentItemId: number) => void;
};

export default function ModuleContent({ blocks, embedded = false, onToggleComplete }: ModuleContentProps) {
	return (
		<div className={embedded ? "min-w-0 px-6 pb-6 pt-8 text-ink-soft sm:px-10 sm:pb-10 lg:px-12 lg:pb-12" : "min-w-0 rounded-[10px] border border-gray-200 bg-white p-6 text-ink-soft shadow-[0_6px_9px_rgba(0,0,0,0.05)] sm:p-10 lg:p-12"}>
			{blocks.map((block) => {
				if (block.type === "text") {
					return (
						<Markdown
							key={block.id}
							className="prose-lg lg:prose-base mb-4 last:mb-0 [&_table]:block [&_table]:overflow-x-auto"
						>
							{block.content}
						</Markdown>
					);
				}

				return (
					<ContentEmbed
						key={block.id}
						type={block.type}
						title={block.title}
						embedUrl={block.embedUrl}
						attribution={block.type === "audio" ? block.attribution : undefined}
						completed={block.completed}
						onToggleComplete={onToggleComplete && typeof block.id === "number" ? () => onToggleComplete(block.id as number) : undefined}
					/>
				);
			})}
		</div>
	);
}

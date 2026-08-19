import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ContentEmbed from "@/components/modules/ContentEmbed";
import type { ContentBlock } from "@/types/module";

type ModuleContentProps = {
	blocks: ContentBlock[];
};

export default function ModuleContent({ blocks }: ModuleContentProps) {
	return (
		<div className="rounded-3xl bg-white p-8 text-ink-soft shadow-[0px_10px_20px_rgba(0,0,0,0.08)]">
			{blocks.map((block) => {
				if (block.type === "text") {
					return (
						<div
							key={block.id}
							className="prose prose-neutral mb-4 max-w-none last:mb-0"
						>
							<ReactMarkdown remarkPlugins={[remarkGfm]}>
								{block.content}
							</ReactMarkdown>
						</div>
					);
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

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ContentEmbed from "@/components/modules/ContentEmbed";
import type { ContentBlock } from "@/types/module";

type ModuleContentProps = {
	blocks: ContentBlock[];
	embedded?: boolean;
};

export default function ModuleContent({ blocks, embedded = false }: ModuleContentProps) {
	return (
		<div className={embedded ? "min-w-0 px-6 pb-6 pt-8 text-ink-soft sm:px-10 sm:pb-10 lg:px-12 lg:pb-12" : "min-w-0 rounded-[10px] border border-gray-200 bg-white p-6 text-ink-soft shadow-[0_6px_9px_rgba(0,0,0,0.05)] sm:p-10 lg:p-12"}>
			{blocks.map((block) => {
				if (block.type === "text") {
					return (
						<div
							key={block.id}
							className="prose prose-neutral prose-sm mb-4 max-w-none break-words last:mb-0 [&_table]:block [&_table]:overflow-x-auto"
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

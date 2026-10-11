import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Admin-written Markdown (GitHub flavoured) with prose styling; size it with `className`. */
export default function Markdown({ children, className = "" }: { children: string; className?: string }) {
	return (
		<div className={`prose prose-neutral max-w-none break-words ${className}`}>
			<ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
		</div>
	);
}

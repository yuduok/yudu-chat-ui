import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { cn } from "@/lib/utils";

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("bubble-prose", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}

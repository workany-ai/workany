import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const markdownComponents = {
  pre: ({ children }: any) => (
    <pre className="bg-muted max-w-full overflow-x-auto rounded-lg p-4">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }: any) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="bg-muted rounded px-1.5 py-0.5 text-sm" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a: ({ children, href }: any) => (
    <a
      href={href}
      onClick={async (e) => {
        e.preventDefault();
        if (href) {
          try {
            const { openUrl } = await import('@tauri-apps/plugin-opener');
            await openUrl(href);
          } catch {
            window.open(href, '_blank');
          }
        }
      }}
      className="text-primary cursor-pointer hover:underline"
    >
      {children}
    </a>
  ),
  table: ({ children }: any) => (
    <div className="overflow-x-auto">
      <table className="border-border border-collapse border">{children}</table>
    </div>
  ),
  th: ({ children }: any) => (
    <th className="border-border bg-muted border px-3 py-2 text-left">
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td className="border-border border px-3 py-2">{children}</td>
  ),
};

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

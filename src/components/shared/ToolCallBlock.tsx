/**
 * ToolCallBlock Component
 *
 * Collapsible block showing tool call name, input, and output.
 * Inspired by webclaw's prompt-kit/tool.tsx.
 */

import { useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { CheckCircle2, ChevronRight, Loader2, XCircle } from 'lucide-react';

export interface ToolCallPart {
  name: string;
  state: 'running' | 'done' | 'error';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  toolCallId?: string;
  errorText?: string;
}

interface ToolCallBlockProps {
  tool: ToolCallPart;
  defaultOpen?: boolean;
}

function renderValue(value: unknown): React.ReactNode {
  if (value === null)
    return <span className="text-muted-foreground">null</span>;
  if (value === undefined)
    return <span className="text-muted-foreground">undefined</span>;

  let formatted = value;
  if (typeof value === 'string') {
    try {
      formatted = JSON.parse(value);
    } catch {
      return <span className="break-all">{value}</span>;
    }
  }

  if (typeof formatted === 'object' && formatted !== null) {
    return (
      <pre className="font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
        {JSON.stringify(formatted, null, 2)}
      </pre>
    );
  }
  return <span className="break-all">{String(formatted)}</span>;
}

export function ToolCallBlock({
  tool,
  defaultOpen = false,
}: ToolCallBlockProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const StateIcon = () => {
    switch (tool.state) {
      case 'running':
        return (
          <Loader2 className="text-muted-foreground size-3 animate-spin" />
        );
      case 'done':
        return <CheckCircle2 className="size-3 text-green-500" />;
      case 'error':
        return <XCircle className="size-3 text-red-500" />;
    }
  };

  return (
    <div className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
      >
        <ChevronRight
          className={cn(
            'size-3.5 transition-transform duration-150',
            isOpen && 'rotate-90'
          )}
        />
        <span className="font-mono text-xs">{tool.name}</span>
        <StateIcon />
      </button>
      {isOpen && (
        <div className="bg-muted/50 border-border mt-1 space-y-2 rounded-lg border p-2">
          {tool.input && Object.keys(tool.input).length > 0 && (
            <div className="bg-background rounded-md border p-2">
              <h4 className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
                Input
              </h4>
              <div className="text-foreground max-h-40 space-y-1 overflow-auto font-mono text-xs">
                {Object.entries(tool.input).map(([key, value]) => (
                  <div key={key} className="break-all">
                    <span className="text-muted-foreground">{key}: </span>
                    <span>{renderValue(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tool.output && (
            <div className="bg-background rounded-md border p-2">
              <h4 className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
                Output
              </h4>
              <div className="text-foreground max-h-40 overflow-auto font-mono text-xs">
                {renderValue(tool.output)}
              </div>
            </div>
          )}

          {tool.state === 'error' && tool.errorText && (
            <div className="rounded-md bg-red-50 p-2 dark:bg-red-950/30">
              <h4 className="mb-1 text-[10px] font-semibold tracking-wider text-red-600 uppercase">
                Error
              </h4>
              <div className="text-xs text-red-700 dark:text-red-400">
                {tool.errorText}
              </div>
            </div>
          )}

          {tool.toolCallId && (
            <div className="text-muted-foreground/60 text-[10px]">
              <span className="font-mono tabular-nums">
                ID: {tool.toolCallId.slice(0, 16)}...
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ThinkingBlock Component
 *
 * Collapsible block showing AI thinking/reasoning content.
 * Inspired by webclaw's prompt-kit/thinking.tsx.
 */

import { useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { ChevronRight } from 'lucide-react';

interface ThinkingBlockProps {
  content: string;
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-2 inline-flex flex-col">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium transition-colors"
      >
        <ChevronRight
          className={cn(
            'size-3.5 transition-transform duration-150',
            isOpen && 'rotate-90'
          )}
        />
        <span>Thinking</span>
      </button>
      {isOpen && (
        <div className="border-muted-foreground/20 mt-1 mb-2 ml-1 border-l-2 pl-3">
          <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap">
            {content}
          </p>
        </div>
      )}
    </div>
  );
}

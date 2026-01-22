import { ExternalLink } from 'lucide-react';

import type { Artifact } from './types';
import { formatFileSize } from './utils';

interface FileTooLargeProps {
  artifact: Artifact;
  fileSize: number;
  icon: React.ComponentType<{ className?: string }>;
  onOpenExternal: () => void;
}

export function FileTooLarge({
  artifact,
  fileSize,
  icon: Icon,
  onOpenExternal,
}: FileTooLargeProps) {
  return (
    <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="border-border bg-background mb-4 flex size-20 items-center justify-center rounded-xl border">
          <Icon className="text-muted-foreground size-10" />
        </div>
        <h3 className="text-foreground mb-2 text-lg font-medium">
          {artifact.name}
        </h3>
        <p className="text-muted-foreground mb-1 text-sm">
          File size: {formatFileSize(fileSize)}
        </p>
        <p className="text-muted-foreground mb-6 text-sm">
          This file is too large to preview in the app.
        </p>
        <button
          onClick={onOpenExternal}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          <ExternalLink className="size-4" />
          Open in System App
        </button>
      </div>
    </div>
  );
}

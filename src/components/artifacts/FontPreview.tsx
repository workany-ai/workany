import { ExternalLink, FileText } from 'lucide-react';

import type { PreviewComponentProps } from './types';
import { openFileExternal } from './utils';

export function FontPreview({ artifact }: PreviewComponentProps) {
  const handleOpenExternal = () => {
    if (artifact.path) {
      openFileExternal(artifact.path);
    }
  };

  return (
    <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="border-border bg-background mb-4 flex size-20 items-center justify-center rounded-xl border">
          <FileText className="text-muted-foreground size-10" />
        </div>
        <h3 className="text-foreground mb-2 text-lg font-medium">
          {artifact.name}
        </h3>
        <p className="text-muted-foreground mb-6 text-sm">
          Font files cannot be previewed in the app.
        </p>
        <button
          onClick={handleOpenExternal}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          <ExternalLink className="size-4" />
          Open in Font Viewer
        </button>
      </div>
    </div>
  );
}

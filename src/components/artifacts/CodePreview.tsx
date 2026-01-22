import { useTheme } from '@/shared/providers/theme-provider';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';

import type { PreviewComponentProps } from './types';
import { getLanguageHint } from './utils';

export function CodePreview({ artifact }: PreviewComponentProps) {
  const { theme } = useTheme();

  if (!artifact.content) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-muted-foreground text-sm">No content available</p>
      </div>
    );
  }

  const language = getLanguageHint(artifact);
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <div className="h-full overflow-auto">
      <SyntaxHighlighter
        language={language}
        style={isDark ? oneDark : oneLight}
        showLineNumbers
        wrapLines
        customStyle={{
          margin: 0,
          padding: '0.5rem 0',
          fontSize: '12px',
          lineHeight: '1.4',
          background: 'transparent',
          minHeight: '100%',
        }}
        codeTagProps={{
          style: {
            background: 'transparent',
          },
        }}
        lineProps={{
          style: {
            background: 'transparent',
            display: 'block',
          },
        }}
        lineNumberStyle={{
          minWidth: '3em',
          paddingRight: '1em',
          paddingLeft: '0.5em',
          color: isDark ? '#636d83' : '#9ca3af',
          userSelect: 'none',
          background: 'transparent',
        }}
      >
        {artifact.content}
      </SyntaxHighlighter>
    </div>
  );
}

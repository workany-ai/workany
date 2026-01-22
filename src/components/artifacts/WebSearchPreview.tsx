/**
 * WebSearch Preview Component
 *
 * Displays web search results in a friendly format with
 * website icons, titles, and domain names.
 */

import { useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { ChevronDown, ChevronUp, ExternalLink, Globe } from 'lucide-react';

import type { Artifact } from './types';

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

interface SearchGroup {
  query: string;
  results: SearchResult[];
}

// Extract JSON array from string starting at given position
function extractJsonArray(content: string, startIndex: number): string | null {
  if (content[startIndex] !== '[') return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '[') depth++;
      if (char === ']') {
        depth--;
        if (depth === 0) {
          return content.slice(startIndex, i + 1);
        }
      }
    }
  }

  return null;
}

// Parse search results from artifact content
function parseSearchResults(content: string): SearchGroup[] {
  const groups: SearchGroup[] = [];

  if (!content || content.trim() === '') {
    return groups;
  }

  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      groups.push({ query: '', results: parsed });
      return groups;
    } else if (parsed.results) {
      groups.push({ query: parsed.query || '', results: parsed.results });
      return groups;
    } else if (parsed.queries) {
      for (const q of parsed.queries) {
        groups.push({ query: q.query || '', results: q.results || [] });
      }
      return groups;
    }
  } catch {
    // Not pure JSON, continue with text parsing
  }

  // Extract query - handle both quoted and unquoted formats
  const queryRegex = /Web search results for(?: query)?:\s*"([^"]+)"/gi;
  const queryMatches: { query: string; index: number }[] = [];
  let qMatch;
  while ((qMatch = queryRegex.exec(content)) !== null) {
    queryMatches.push({ query: qMatch[1], index: qMatch.index });
  }

  console.log(
    '[WebSearchPreview] Query matches:',
    queryMatches.length,
    queryMatches.map((q) => q.query)
  );

  // Find "Links:" and extract the JSON array after it
  let searchPos = 0;
  const linksSections: { links: SearchResult[]; index: number }[] = [];

  while (true) {
    const linksIndex = content.indexOf('Links:', searchPos);
    if (linksIndex === -1) break;

    // Find the '[' after "Links:"
    let bracketPos = linksIndex + 6;
    while (bracketPos < content.length && /\s/.test(content[bracketPos])) {
      bracketPos++;
    }

    if (content[bracketPos] === '[') {
      const jsonStr = extractJsonArray(content, bracketPos);
      console.log(
        '[WebSearchPreview] Found Links at',
        linksIndex,
        'JSON length:',
        jsonStr?.length
      );

      if (jsonStr) {
        try {
          const links = JSON.parse(jsonStr);
          if (Array.isArray(links)) {
            linksSections.push({
              links: links.map((l: { title?: string; url?: string }) => ({
                title: l.title || '',
                url: l.url || '',
              })),
              index: linksIndex,
            });
            console.log('[WebSearchPreview] Parsed', links.length, 'links');
          }
        } catch (e) {
          console.log('[WebSearchPreview] JSON parse error:', e);
        }
      }
    }

    searchPos = linksIndex + 1;
  }

  console.log('[WebSearchPreview] Links sections found:', linksSections.length);

  // Match queries with links
  if (queryMatches.length > 0 && linksSections.length > 0) {
    for (let i = 0; i < queryMatches.length; i++) {
      const qm = queryMatches[i];
      const nextQmIndex = queryMatches[i + 1]?.index ?? Infinity;

      const linksForQuery = linksSections.find(
        (ls) => ls.index > qm.index && ls.index < nextQmIndex
      );

      if (linksForQuery) {
        groups.push({ query: qm.query, results: linksForQuery.links });
      }
    }
  } else if (linksSections.length > 0) {
    // No queries found, just add links
    for (const ls of linksSections) {
      groups.push({ query: '', results: ls.links });
    }
  }

  return groups;
}

// Get favicon URL for a domain
function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
}

// Get domain from URL
function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Open URL in external browser
async function openUrl(url: string) {
  try {
    const { openUrl: tauriOpenUrl } = await import('@tauri-apps/plugin-opener');
    await tauriOpenUrl(url);
  } catch {
    window.open(url, '_blank');
  }
}

interface SearchResultItemProps {
  result: SearchResult;
}

function SearchResultItem({ result }: SearchResultItemProps) {
  const faviconUrl = getFaviconUrl(result.url);
  const domain = getDomain(result.url);

  return (
    <button
      onClick={() => openUrl(result.url)}
      className="hover:bg-muted/50 flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
    >
      <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
        {faviconUrl ? (
          <img
            src={faviconUrl}
            alt=""
            className="size-4"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <Globe
          className={cn('text-muted-foreground size-4', faviconUrl && 'hidden')}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate text-sm font-medium">
          {result.title || domain}
        </div>
        <div className="text-muted-foreground truncate text-xs">{domain}</div>
      </div>
      <ExternalLink className="text-muted-foreground size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

interface SearchGroupCardProps {
  group: SearchGroup;
  defaultExpanded?: boolean;
}

function SearchGroupCard({
  group,
  defaultExpanded = true,
}: SearchGroupCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="border-border overflow-hidden rounded-xl border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="bg-muted/30 hover:bg-muted/50 flex w-full cursor-pointer items-center gap-3 px-4 py-3 transition-colors"
      >
        <Globe className="text-muted-foreground size-5 shrink-0" />
        <div className="min-w-0 flex-1 text-left">
          <div className="text-foreground truncate text-sm font-medium">
            {group.query || 'Search Results'}
          </div>
        </div>
        <span className="text-muted-foreground shrink-0 text-xs">
          {group.results.length} results
        </span>
        {isExpanded ? (
          <ChevronUp className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className="divide-border divide-y">
          {group.results.map((result, index) => (
            <SearchResultItem key={index} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WebSearchPreview({ artifact }: { artifact: Artifact }) {
  const content = artifact.content || '';
  const groups = parseSearchResults(content);

  console.log('[WebSearchPreview] Content length:', content.length);
  console.log('[WebSearchPreview] Content preview:', content.slice(0, 200));
  console.log('[WebSearchPreview] Parsed groups:', groups.length, groups);

  if (groups.length === 0 || groups.every((g) => g.results.length === 0)) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <Globe className="text-muted-foreground/50 mb-4 size-12" />
        <p className="text-muted-foreground text-sm">No search results</p>
        {content && (
          <details className="mt-4 max-w-md">
            <summary className="text-muted-foreground cursor-pointer text-xs">
              Show raw content
            </summary>
            <pre className="bg-muted mt-2 max-h-40 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
              {content.slice(0, 500)}...
            </pre>
          </details>
        )}
      </div>
    );
  }

  const totalResults = groups.reduce((sum, g) => sum + g.results.length, 0);

  return (
    <div className="h-full overflow-auto">
      <div className="p-4">
        <div className="text-muted-foreground mb-4 text-xs tracking-wide uppercase">
          {groups.length} {groups.length === 1 ? 'search' : 'searches'} ·{' '}
          {totalResults} results
        </div>
        <div className="space-y-4">
          {groups.map((group, index) => (
            <SearchGroupCard
              key={index}
              group={group}
              defaultExpanded={index === 0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

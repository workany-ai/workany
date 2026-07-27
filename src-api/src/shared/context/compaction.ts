/**
 * Compaction Engine — summarizes old conversation messages.
 *
 * When the conversation exceeds the token budget, this module calls the
 * model to compress older messages into a concise summary while strictly
 * preserving all identifiers (paths, URLs, IDs, hostnames, etc.).
 *
 * Inspired by OpenClaw's compaction system with safeguard mode and
 * identifier preservation.
 */

import type { SessionMessage, CompactionSummary } from './session-store';
import { getProviderManager } from '@/shared/provider/manager';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CompactionConfig {
  /** Token threshold: compact when total tokens > context budget - reserveTokensFloor */
  reserveTokensFloor: number;
  /** How many recent messages to always keep in full (never compact) */
  keepRecentMessages: number;
  /** Extra instructions for identifier preservation */
  identifierInstructions?: string;
  /** Timeout in ms for compaction call */
  timeoutMs: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  reserveTokensFloor: 16000,
  keepRecentMessages: 6,
  identifierInstructions: '',
  timeoutMs: 60_000,
};

// ---------------------------------------------------------------------------
// Token estimation (simple char/4 heuristic, same as existing code)
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Identifier extraction
// ---------------------------------------------------------------------------

const IDENTIFIER_PATTERNS = [
  /(?:\/[\w.-]+){2,}/g,                        // file paths: /foo/bar/baz
  /~\/[\w./-]+/g,                               // home-relative paths
  /https?:\/\/\S+/g,                            // URLs
  /\b[a-zA-Z]:\\[\w\\.-]+/g,                    // Windows paths
  /\b(?:localhost|[\w.-]+\.(?:com|cn|io|dev|app|net|org))(?::\d+)?\b/g, // hostnames
  /\b[A-Z][A-Z0-9_]{2,}\b/g,                   // CONSTANTS / ENV_VARS
  /\b\d{4,}\b/g,                                // numeric IDs (4+ digits)
];

export function extractIdentifiers(messages: SessionMessage[]): string[] {
  const ids = new Set<string>();
  for (const msg of messages) {
    for (const pattern of IDENTIFIER_PATTERNS) {
      const matches = msg.content.match(pattern);
      if (matches) {
        for (const m of matches) {
          if (m.length >= 3 && m.length <= 200) ids.add(m);
        }
      }
    }
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Compaction prompt
// ---------------------------------------------------------------------------

function buildCompactionPrompt(
  messages: SessionMessage[],
  identifiers: string[],
  config: CompactionConfig
): string {
  const conversation = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const idList = identifiers.length > 0
    ? `\n\n### Identifiers to PRESERVE EXACTLY (do not paraphrase, abbreviate, or omit):\n${identifiers.map((id) => `- \`${id}\``).join('\n')}`
    : '';

  const extraInstructions = config.identifierInstructions
    ? `\n\n### Additional preservation rules:\n${config.identifierInstructions}`
    : '';

  return `You are a conversation summarizer. Compress the following conversation into a structured summary.

## Rules:
1. Preserve ALL file paths, directory paths, project names, URLs, hostnames, port numbers, API keys, model names, and numeric IDs EXACTLY as they appear.
2. Preserve the user's stated intent, preferences, and decisions.
3. Preserve any ongoing task context: what has been done, what remains to do, and the current state.
4. Preserve tool names and their results (what data was retrieved, what files were modified).
5. Use structured sections: "## Context", "## Completed Tasks", "## Current State", "## Key Identifiers".
6. Output ONLY the summary. No preamble, no explanation.
7. Target length: 300-800 words.${idList}${extraInstructions}

---
## Conversation to summarize:

${conversation}`;
}

// ---------------------------------------------------------------------------
// LLM call (direct OpenAI-compatible API, no SDK overhead)
// ---------------------------------------------------------------------------

async function callLLM(prompt: string, config: CompactionConfig): Promise<string> {
  const manager = getProviderManager();
  const agentCfg = manager.getConfig().agent?.config as Record<string, unknown> | undefined;

  const apiKey = (agentCfg?.apiKey as string)
    || process.env.ANTHROPIC_API_KEY
    || process.env.OPENAI_API_KEY;
  const baseUrl = (agentCfg?.baseUrl as string)
    || process.env.ANTHROPIC_BASE_URL
    || process.env.OPENAI_BASE_URL
    || 'https://api.anthropic.com';
  const model = (agentCfg?.model as string)
    || process.env.AGENT_MODEL
    || 'claude-sonnet-4-20250514';
  const apiType = (agentCfg?.apiType as string) || 'openai-completions';

  if (!apiKey) {
    throw new Error('No API key configured for compaction');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const url = apiType === 'anthropic-messages'
      ? `${baseUrl}/v1/messages`
      : `${baseUrl}/v1/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    let body: string;

    if (apiType === 'anthropic-messages') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: 'You are a precise conversation summarizer. Follow instructions exactly.' },
          { role: 'user', content: prompt },
        ],
      });
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Compaction API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json = await res.json() as Record<string, unknown>;

    if (apiType === 'anthropic-messages') {
      const content = json.content as Array<{ type: string; text?: string }>;
      return content?.find((b) => b.type === 'text')?.text || '';
    } else {
      const choices = json.choices as Array<{ message?: { content?: string } }>;
      return choices?.[0]?.message?.content || '';
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compact older messages into a summary.
 *
 * @param messages - All conversation messages
 * @param keepRecentCount - Number of recent messages to keep in full
 * @param config - Compaction configuration
 * @returns CompactionSummary or null if not enough messages to compact
 */
export async function compactMessages(
  messages: SessionMessage[],
  keepRecentCount?: number,
  config?: Partial<CompactionConfig>
): Promise<CompactionSummary | null> {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  const keepCount = keepRecentCount ?? cfg.keepRecentMessages;

  if (messages.length <= keepCount) {
    return null;
  }

  const cutoff = messages.length - keepCount;
  const toCompact = messages.slice(0, cutoff);
  const identifiers = extractIdentifiers(toCompact);

  console.log(`[Compaction] Compacting ${toCompact.length} messages, keeping ${keepCount} recent`);
  console.log(`[Compaction] Extracted ${identifiers.length} identifiers to preserve`);

  const prompt = buildCompactionPrompt(toCompact, identifiers, cfg);
  const summary = await callLLM(prompt, cfg);

  if (!summary) {
    console.warn('[Compaction] Model returned empty summary');
    return null;
  }

  const result: CompactionSummary = {
    summary,
    compactedUpTo: cutoff,
    tokenEstimate: estimateTokens(summary),
    createdAt: new Date().toISOString(),
    identifiers,
  };

  console.log(`[Compaction] Summary generated: ${result.tokenEstimate} tokens (from ${toCompact.reduce((s, m) => s + m.tokenEstimate, 0)} tokens)`);
  return result;
}

/**
 * Manual compaction with user-provided focus instructions.
 */
export async function compactWithInstructions(
  messages: SessionMessage[],
  instructions: string,
  config?: Partial<CompactionConfig>
): Promise<CompactionSummary | null> {
  return compactMessages(messages, undefined, {
    ...config,
    identifierInstructions: instructions,
  });
}

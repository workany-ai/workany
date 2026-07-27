/**
 * Context Assembler — builds the conversation context string for the model.
 *
 * Lifecycle (inspired by OpenClaw's Context Engine):
 *   1. Ingest  — persist incoming messages to session store
 *   2. Assemble — build context within token budget
 *   3. Compact — if over budget, summarize older messages
 *   4. Format  — return a structured context string
 */

import type { ConversationMessage } from '@/core/agent/types';
import {
  loadSession,
  createSession as createSessionData,
  appendMessages,
  setCompaction,
  getRecentMessages,
  type SessionData,
  type SessionMessage,
} from './session-store';
import {
  compactMessages,
  estimateTokens,
  DEFAULT_COMPACTION_CONFIG,
  type CompactionConfig,
} from './compaction';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AssemblerConfig {
  /** Max tokens for the assembled conversation context */
  maxContextTokens: number;
  /** Compaction config */
  compaction: CompactionConfig;
}

const DEFAULT_ASSEMBLER_CONFIG: AssemblerConfig = {
  maxContextTokens: 12000,
  compaction: DEFAULT_COMPACTION_CONFIG,
};

// ---------------------------------------------------------------------------
// Ingest — convert frontend messages and persist
// ---------------------------------------------------------------------------

function toSessionMessages(conversation: ConversationMessage[]): SessionMessage[] {
  return conversation.map((msg) => ({
    role: msg.role,
    content: msg.content,
    timestamp: new Date().toISOString(),
    tokenEstimate: estimateTokens(
      msg.content + (msg.imagePaths?.join(' ') || '')
    ),
  }));
}

/**
 * Ingest conversation messages into the session store.
 * Only appends messages that are NEW (not already persisted).
 */
function ingestMessages(
  sessionId: string,
  conversation: ConversationMessage[]
): SessionData {
  let data = loadSession(sessionId);
  if (!data) data = createSessionData(sessionId);

  const existingCount = data.messages.length;
  const incoming = toSessionMessages(conversation);

  if (incoming.length > existingCount) {
    const newMsgs = incoming.slice(existingCount);
    data = appendMessages(sessionId, newMsgs);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Assemble — build context within budget, compacting if needed
// ---------------------------------------------------------------------------

export interface AssembleResult {
  /** Formatted context string to inject into the prompt */
  context: string;
  /** Whether compaction was triggered during this assembly */
  compacted: boolean;
  /** Total estimated tokens in the assembled context */
  estimatedTokens: number;
  /** Number of recent messages included in full */
  recentMessageCount: number;
}

/**
 * Assemble conversation context for the model.
 *
 * Steps:
 * 1. Ingest new messages into session store
 * 2. Check if total tokens exceed budget
 * 3. If over budget, trigger compaction
 * 4. Format: compaction summary (if any) + recent messages
 */
export async function assembleContext(
  sessionId: string,
  conversation: ConversationMessage[],
  config?: Partial<AssemblerConfig>
): Promise<AssembleResult> {
  const cfg: AssemblerConfig = {
    maxContextTokens: config?.maxContextTokens ?? DEFAULT_ASSEMBLER_CONFIG.maxContextTokens,
    compaction: { ...DEFAULT_ASSEMBLER_CONFIG.compaction, ...config?.compaction },
  };

  // 1. Ingest
  let data = ingestMessages(sessionId, conversation);

  // 2. Check budget
  const recentMsgs = getRecentMessages(data);
  const recentTokens = recentMsgs.reduce((s, m) => s + m.tokenEstimate, 0);
  const summaryTokens = data.compaction?.tokenEstimate ?? 0;
  const totalTokens = recentTokens + summaryTokens;

  let compacted = false;

  // 3. Compact if over budget and we have enough messages
  if (totalTokens > cfg.maxContextTokens && recentMsgs.length > cfg.compaction.keepRecentMessages) {
    try {
      console.log(`[Assembler] Over budget (${totalTokens} > ${cfg.maxContextTokens}), triggering compaction...`);

      const summary = await compactMessages(
        data.messages,
        cfg.compaction.keepRecentMessages,
        cfg.compaction
      );

      if (summary) {
        data = setCompaction(sessionId, summary);
        compacted = true;
      }
    } catch (err) {
      console.warn('[Assembler] Compaction failed, using truncation fallback:', err);
    }
  }

  // 4. Format
  const context = formatContext(data, cfg.maxContextTokens);

  return {
    context,
    compacted,
    estimatedTokens: estimateTokens(context),
    recentMessageCount: getRecentMessages(data).length,
  };
}

// ---------------------------------------------------------------------------
// Format — produce the final context string
// ---------------------------------------------------------------------------

function formatContext(data: SessionData, maxTokens: number): string {
  const parts: string[] = [];
  const recent = getRecentMessages(data);

  // Add compaction summary if present
  if (data.compaction) {
    parts.push('## Conversation Summary (earlier context)\n');
    parts.push(data.compaction.summary);
    parts.push('\n\n---\n');
  }

  // Add recent messages (within budget)
  if (recent.length > 0) {
    parts.push('## Recent Conversation\n');

    let tokenBudget = maxTokens - estimateTokens(parts.join(''));
    const recentParts: string[] = [];

    // Work backwards from most recent, stop when budget exhausted
    for (let i = recent.length - 1; i >= 0; i--) {
      const msg = recent[i];
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const line = `${role}: ${msg.content}`;
      const lineTokens = estimateTokens(line);

      if (tokenBudget - lineTokens < 0 && recentParts.length >= 2) {
        // Budget exceeded, insert truncation notice
        recentParts.unshift(`[... ${i + 1} earlier messages omitted ...]`);
        break;
      }

      recentParts.unshift(line);
      tokenBudget -= lineTokens;
    }

    parts.push(recentParts.join('\n\n'));
  }

  if (parts.length === 0) return '';

  return parts.join('\n') + '\n\n---\n## Current Request\n';
}

// ---------------------------------------------------------------------------
// Manual compact (for /compact command)
// ---------------------------------------------------------------------------

export async function manualCompact(
  sessionId: string,
  instructions?: string
): Promise<{ summary: string; ok: boolean }> {
  const data = loadSession(sessionId);
  if (!data || data.messages.length < 3) {
    return { summary: '', ok: false };
  }

  try {
    const cfg = { ...DEFAULT_COMPACTION_CONFIG };
    if (instructions) {
      cfg.identifierInstructions = instructions;
    }

    const summary = await compactMessages(
      data.messages,
      cfg.keepRecentMessages,
      cfg
    );

    if (summary) {
      setCompaction(sessionId, summary);
      return { summary: summary.summary, ok: true };
    }
  } catch (err) {
    console.error('[Assembler] Manual compaction failed:', err);
  }

  return { summary: '', ok: false };
}

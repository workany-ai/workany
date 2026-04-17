/**
 * Session Store — disk-persisted conversation context.
 *
 * Stores full conversation messages and compaction summaries per sessionId
 * in ~/.workany/sessions/{sessionId}.json.
 *
 * The full message history is NEVER truncated on disk — compaction only
 * affects what gets assembled into the model's context window.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { getAppDataDir } from '@/shared/utils/paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  tokenEstimate: number;
}

export interface CompactionSummary {
  summary: string;
  compactedUpTo: number;      // index in messages[] up to which compaction covers
  tokenEstimate: number;
  createdAt: string;
  identifiers: string[];      // preserved paths, IDs, URLs
}

export interface SessionData {
  sessionId: string;
  messages: SessionMessage[];
  compaction: CompactionSummary | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function sessionsDir(): string {
  return join(getAppDataDir(), 'sessions');
}

function sessionPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(sessionsDir(), `${safe}.json`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function loadSession(sessionId: string): SessionData | null {
  const p = sessionPath(sessionId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as SessionData;
  } catch {
    return null;
  }
}

export function saveSession(data: SessionData): void {
  const dir = sessionsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  data.updatedAt = new Date().toISOString();
  writeFileSync(sessionPath(data.sessionId), JSON.stringify(data, null, 2), 'utf-8');
}

export function createSession(sessionId: string): SessionData {
  return {
    sessionId,
    messages: [],
    compaction: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Message operations
// ---------------------------------------------------------------------------

export function appendMessages(sessionId: string, msgs: SessionMessage[]): SessionData {
  let data = loadSession(sessionId) || createSession(sessionId);
  data.messages.push(...msgs);
  saveSession(data);
  return data;
}

export function setCompaction(sessionId: string, summary: CompactionSummary): SessionData {
  let data = loadSession(sessionId);
  if (!data) data = createSession(sessionId);
  data.compaction = summary;
  saveSession(data);
  return data;
}

/**
 * Get total estimated tokens for all messages + compaction summary.
 */
export function getTotalTokens(data: SessionData): number {
  const msgTokens = data.messages.reduce((sum, m) => sum + m.tokenEstimate, 0);
  const compTokens = data.compaction?.tokenEstimate ?? 0;
  return msgTokens + compTokens;
}

/**
 * Get messages that are NOT covered by the compaction summary.
 * These are the "recent" messages that the model will see in full.
 */
export function getRecentMessages(data: SessionData): SessionMessage[] {
  if (!data.compaction) return data.messages;
  return data.messages.slice(data.compaction.compactedUpTo);
}

// ---------------------------------------------------------------------------
// Cleanup — remove sessions older than N days
// ---------------------------------------------------------------------------

export function cleanupOldSessions(maxAgeDays: number = 7): number {
  const dir = sessionsDir();
  if (!existsSync(dir)) return 0;

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const filePath = join(dir, file);
    try {
      const stat = statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        unlinkSync(filePath);
        removed++;
      }
    } catch { /* skip */ }
  }

  if (removed > 0) {
    console.log(`[SessionStore] Cleaned up ${removed} old session(s)`);
  }
  return removed;
}

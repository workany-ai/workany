/**
 * Bot Session Sync Utilities
 *
 * Handles syncing bot sessions and messages between cloud and local SQLite.
 */

import {
  getBotMessages,
  getBotSessions,
  updateBotSessionMeta,
  upsertBotMessageRows,
  upsertBotSessions,
} from '@/shared/db/database';
import type { Database } from '@/shared/db/database';
import type { BotMessageRow, BotSessionRow } from '@/shared/db/types';
import type { BotContentPart } from '@/shared/hooks/useBotChats';
import { getOpenClawConfig } from '@/shared/lib/bot-storage';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:2026';

/**
 * Default network timeout in milliseconds
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Normalize role string to valid type
 */
function normalizeRole(
  role: string | undefined
): 'user' | 'assistant' | 'toolResult' {
  if (role === 'user' || role === 'assistant' || role === 'toolResult') {
    return role;
  }
  // Default to assistant for unknown roles - log warning for unexpected roles
  if (role && role !== 'system') {
    console.warn(
      `[bot-sync] Unknown message role: "${role}", defaulting to "assistant"`
    );
  }
  return 'assistant';
}

/**
 * Safely parse JSON with fallback
 */
function safeParseJson<T>(json: string | undefined | null): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

/**
 * Sync state for UI
 */
export interface BotSyncState {
  isSyncingSessions: boolean;
  syncingSessionKey: string | null;
  lastSyncTime: number | null;
  syncError: string | null;
}

/**
 * Fetch sessions from cloud
 */
export async function fetchCloudSessions(): Promise<BotSessionRow[]> {
  const config = getOpenClawConfig();
  const response = await fetchWithTimeout(`${API_BASE}/openclaw/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gatewayUrl: config.gatewayUrl,
      authToken: config.authToken,
      includeLastMessage: true,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch sessions: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const sessions = data.sessions ?? [];

  return sessions.map((s: any) => ({
    session_key: s.key,
    friendly_id: s.friendlyId,
    label: s.label ?? s.derivedTitle,
    last_message: extractLastMessageText(s.lastMessage),
    message_count: 0, // Will be updated when messages are synced
    updated_at: s.updatedAt,
    synced_at: Date.now(),
  }));
}

/**
 * Extract text from last message for preview
 */
function extractLastMessageText(msg: any): string | undefined {
  if (!msg?.content) return undefined;
  const textParts = msg.content.filter((c: any) => c.type === 'text');
  const text = textParts.map((c: any) => c.text || '').join(' ');
  return text.slice(0, 200) || undefined;
}

/**
 * Sync all sessions from cloud to local database
 */
export async function syncBotSessions(db: Database): Promise<BotSessionRow[]> {
  const cloudSessions = await fetchCloudSessions();
  await upsertBotSessions(db, cloudSessions);
  return getBotSessions(db);
}

/**
 * Fetch messages from cloud for a specific session
 */
export async function fetchCloudMessages(
  sessionKey: string
): Promise<BotMessageRow[]> {
  const config = getOpenClawConfig();
  const response = await fetchWithTimeout(`${API_BASE}/openclaw/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionKey,
      gatewayUrl: config.gatewayUrl,
      authToken: config.authToken,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch messages: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const messages = data.messages ?? [];

  return messages.map((m: any, index: number) => ({
    session_key: sessionKey,
    // Prefer server-provided id; fallback includes index to prevent same-timestamp collisions
    msg_id:
      m.__optimisticId ??
      `${sessionKey}_${m.timestamp ?? Date.now()}_${m.role}_${index}`,
    role: normalizeRole(m.role),
    content: extractMessageText(m.content),
    raw_content: m.content ? JSON.stringify(m.content) : undefined,
    tool_call_id: m.toolCallId,
    tool_name: m.toolName,
    details: m.details ? JSON.stringify(m.details) : undefined,
    is_error: m.isError ?? false,
    timestamp: m.timestamp ?? Date.now(),
  }));
}

/**
 * Extract text content from message
 */
function extractMessageText(content: any[]): string {
  if (!content) return '';
  const textParts = content.filter((c: any) => c.type === 'text');
  return textParts.map((c: any) => c.text || '').join('\n');
}

/**
 * Sync messages for a specific session
 */
export async function syncBotMessages(
  db: Database,
  sessionKey: string
): Promise<BotMessageRow[]> {
  const cloudMessages = await fetchCloudMessages(sessionKey);
  await upsertBotMessageRows(db, cloudMessages);

  // Update session metadata
  const lastMessage = cloudMessages[cloudMessages.length - 1];
  await updateBotSessionMeta(db, sessionKey, {
    last_message: lastMessage?.content?.slice(0, 200),
    message_count: cloudMessages.length,
    updated_at: lastMessage?.timestamp,
  });

  return getBotMessages(db, sessionKey);
}

/**
 * Convert BotMessageRow to BotChatMessage format
 */
export function rowToBotChatMessage(row: BotMessageRow) {
  return {
    role: row.role,
    content: row.content ?? '',
    timestamp: row.timestamp,
    rawContent: safeParseJson<BotContentPart[]>(row.raw_content),
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    details: safeParseJson<Record<string, unknown>>(row.details),
    isError: row.is_error,
  };
}

/**
 * Convert BotSessionRow to BotChatSession format
 */
export function rowToBotChatSession(
  row: BotSessionRow,
  messages: BotMessageRow[] = []
) {
  return {
    sessionKey: row.session_key,
    friendlyId: row.friendly_id,
    label: row.label,
    messages: messages.map(rowToBotChatMessage),
    lastMessage: row.last_message,
    messageCount: row.message_count,
    updatedAt: row.updated_at,
  };
}

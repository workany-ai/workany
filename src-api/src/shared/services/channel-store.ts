/**
 * Channel Conversation Store
 *
 * Persistent store for conversations originating from external channels.
 * Data is kept in-memory for fast access and periodically flushed to disk
 * (~/.workany/channel-conversations.json) so conversations survive sidecar restarts.
 *
 * Supports session continuity: messages from the same channel within
 * a time window are grouped into one conversation.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getAppDataDir } from '@/shared/utils/paths';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const PERSIST_DEBOUNCE_MS = 2000; // flush to disk at most every 2s

export interface ChannelMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChannelConversation {
  id: string;
  channel: string;
  prompt: string;
  messages: ChannelMessage[];
  status: 'completed' | 'error';
  createdAt: number;
  updatedAt: number;
  synced: boolean;
  /** Increments on each new exchange so the frontend knows to re-sync */
  version: number;
}

// ─── Persistence layer ───────────────────────────────────────────────────────

interface PersistedState {
  conversations: [string, ChannelConversation][];
  activeConvByChannel: [string, string][];
}

function getPersistPath(): string {
  const dir = getAppDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, 'channel-conversations.json');
}

function loadFromDisk(): {
  conversations: Map<string, ChannelConversation>;
  activeConvByChannel: Map<string, string>;
} {
  const filePath = getPersistPath();
  const convMap = new Map<string, ChannelConversation>();
  const activeMap = new Map<string, string>();

  if (!existsSync(filePath)) {
    return { conversations: convMap, activeConvByChannel: activeMap };
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const state: PersistedState = JSON.parse(raw);

    if (Array.isArray(state.conversations)) {
      for (const [k, v] of state.conversations) {
        convMap.set(k, v);
      }
    }
    if (Array.isArray(state.activeConvByChannel)) {
      for (const [k, v] of state.activeConvByChannel) {
        activeMap.set(k, v);
      }
    }

    console.log(`[ChannelStore] Restored ${convMap.size} conversations from disk`);
  } catch (err) {
    console.error('[ChannelStore] Failed to load persisted state, starting fresh:', err);
  }

  return { conversations: convMap, activeConvByChannel: activeMap };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (persistTimer) return; // already scheduled
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushToDisk();
  }, PERSIST_DEBOUNCE_MS);
}

function flushToDisk(): void {
  try {
    const state: PersistedState = {
      conversations: Array.from(conversations.entries()),
      activeConvByChannel: Array.from(activeConvByChannel.entries()),
    };
    writeFileSync(getPersistPath(), JSON.stringify(state), 'utf-8');
  } catch (err) {
    console.error('[ChannelStore] Failed to persist to disk:', err);
  }
}

// ─── In-memory state (hydrated from disk on module load) ─────────────────────

const { conversations: _loadedConvs, activeConvByChannel: _loadedActive } = loadFromDisk();
const conversations = _loadedConvs;
const activeConvByChannel = _loadedActive;

// ─── Core logic ──────────────────────────────────────────────────────────────

function findActiveConversation(channel: string): ChannelConversation | null {
  const activeId = activeConvByChannel.get(channel);
  if (!activeId) return null;

  const conv = conversations.get(activeId);
  if (!conv) {
    activeConvByChannel.delete(channel);
    return null;
  }

  if (Date.now() - conv.updatedAt > SESSION_TIMEOUT_MS) {
    activeConvByChannel.delete(channel);
    return null;
  }

  return conv;
}

/**
 * Extract display-friendly channel name from the routing key.
 * e.g. 'feishu:oc_abc123' → 'feishu', 'wechat' → 'wechat'
 */
function displayChannel(channelKey: string): string {
  const idx = channelKey.indexOf(':');
  return idx > 0 ? channelKey.slice(0, idx) : channelKey;
}

export function appendOrCreateConversation(
  channel: string,
  userMessage: string,
  assistantReply: string
): ChannelConversation {
  const now = Date.now();
  const existing = findActiveConversation(channel);

  if (existing) {
    existing.messages.push(
      { role: 'user', content: userMessage, timestamp: now },
      { role: 'assistant', content: assistantReply, timestamp: now + 1 },
    );
    existing.updatedAt = now;
    existing.version++;
    existing.synced = false;

    console.log(`[ChannelStore] Appended to ${existing.id} (v${existing.version})`);
    schedulePersist();
    return existing;
  }

  const id = `ch-${now}-${Math.random().toString(36).slice(2, 6)}`;
  const conv: ChannelConversation = {
    id,
    channel: displayChannel(channel),
    prompt: userMessage,
    messages: [
      { role: 'user', content: userMessage, timestamp: now },
      { role: 'assistant', content: assistantReply, timestamp: now + 1 },
    ],
    status: 'completed',
    createdAt: now,
    updatedAt: now,
    synced: false,
    version: 1,
  };

  conversations.set(id, conv);
  activeConvByChannel.set(channel, id);

  console.log(`[ChannelStore] Created conversation ${id} from ${channel}`);
  schedulePersist();
  return conv;
}

/** Force start a new conversation for a channel (used by /new command) */
export function resetChannelSession(channel: string): void {
  activeConvByChannel.delete(channel);
  console.log(`[ChannelStore] Session reset for ${channel}`);
  schedulePersist();
}

export function getUnsyncedConversations(): ChannelConversation[] {
  return Array.from(conversations.values())
    .filter((c) => !c.synced)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function getAllChannelConversations(): ChannelConversation[] {
  return Array.from(conversations.values()).sort(
    (a, b) => b.createdAt - a.createdAt
  );
}

export function markSynced(ids: string[]): number {
  let count = 0;
  for (const id of ids) {
    const conv = conversations.get(id);
    if (conv) {
      conv.synced = true;
      count++;
    }
  }
  if (count > 0) schedulePersist();
  return count;
}

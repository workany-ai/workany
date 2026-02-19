# Bot Session SQLite Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Sync bot sessions and messages to local SQLite for offline access and fast loading.

**Architecture:** Create independent `bot_sessions` and `bot_messages` tables in SQLite. On app start, sync session list from cloud. When opening a session, show local data immediately then sync in background.

**Tech Stack:** TypeScript, SQLite (via Tauri plugin), React hooks

---

## Task 1: Add Database Schema Migration

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add bot_sessions table migration**

In `src-tauri/src/lib.rs`, find the migrations array and add:

```rust
// Migration for bot_sessions and bot_messages tables
r#"
CREATE TABLE IF NOT EXISTS bot_sessions (
    session_key TEXT PRIMARY KEY,
    friendly_id TEXT,
    label TEXT,
    last_message TEXT,
    message_count INTEGER DEFAULT 0,
    updated_at INTEGER,
    synced_at INTEGER
);

CREATE TABLE IF NOT EXISTS bot_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key TEXT NOT NULL,
    msg_id TEXT,
    role TEXT NOT NULL,
    content TEXT,
    raw_content TEXT,
    tool_call_id TEXT,
    tool_name TEXT,
    details TEXT,
    is_error INTEGER DEFAULT 0,
    timestamp INTEGER,
    UNIQUE(session_key, msg_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_msgs_session ON bot_messages(session_key);
CREATE INDEX IF NOT EXISTS idx_bot_msgs_timestamp ON bot_messages(timestamp);
"#,
```

**Step 2: Verify migration syntax**

Run: `cd /Users/fch/Documents/github/workany && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: No errors

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(db): add bot_sessions and bot_messages tables"
```

---

## Task 2: Add TypeScript Types for Bot Database

**Files:**
- Modify: `src/shared/db/types.ts`

**Step 1: Add BotSessionRow and BotMessageRow types**

In `src/shared/db/types.ts`, add:

```typescript
/**
 * Bot session row in SQLite database
 */
export interface BotSessionRow {
  session_key: string;
  friendly_id?: string;
  label?: string;
  last_message?: string;
  message_count: number;
  updated_at?: number;
  synced_at?: number;
}

/**
 * Bot message row in SQLite database
 */
export interface BotMessageRow {
  id?: number;
  session_key: string;
  msg_id?: string;
  role: 'user' | 'assistant' | 'toolResult';
  content?: string;
  raw_content?: string;
  tool_call_id?: string;
  tool_name?: string;
  details?: string;
  is_error: boolean;
  timestamp?: number;
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd /Users/fch/Documents/github/workany && pnpm exec tsc --noEmit --project src/tsconfig.json`
Expected: No errors

**Step 3: Commit**

```bash
git add src/shared/db/types.ts
git commit -m "feat(types): add BotSessionRow and BotMessageRow types"
```

---

## Task 3: Implement Bot Session Database Functions

**Files:**
- Modify: `src/shared/db/database.ts`

**Step 1: Add imports at top of file**

```typescript
import type { BotSessionRow, BotMessageRow } from './types';
```

**Step 2: Add session CRUD functions**

Add these functions to `database.ts`:

```typescript
// ============================================================================
// Bot Session Operations
// ============================================================================

/**
 * Upsert a bot session to the database
 */
export async function upsertBotSession(db: Database, session: BotSessionRow): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO bot_sessions
     (session_key, friendly_id, label, last_message, message_count, updated_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      session.session_key,
      session.friendly_id ?? null,
      session.label ?? null,
      session.last_message ?? null,
      session.message_count ?? 0,
      session.updated_at ?? null,
      session.synced_at ?? Date.now(),
    ]
  );
}

/**
 * Upsert multiple bot sessions
 */
export async function upsertBotSessions(db: Database, sessions: BotSessionRow[]): Promise<void> {
  for (const session of sessions) {
    await upsertBotSession(db, session);
  }
}

/**
 * Get all bot sessions from database
 */
export async function getBotSessions(db: Database): Promise<BotSessionRow[]> {
  const result = await db.select<BotSessionRow[]>(
    'SELECT * FROM bot_sessions ORDER BY updated_at DESC'
  );
  return result;
}

/**
 * Get a single bot session by key
 */
export async function getBotSession(db: Database, sessionKey: string): Promise<BotSessionRow | null> {
  const result = await db.select<BotSessionRow[]>(
    'SELECT * FROM bot_sessions WHERE session_key = ?',
    [sessionKey]
  );
  return result[0] ?? null;
}

/**
 * Delete a bot session and its messages
 */
export async function deleteBotSession(db: Database, sessionKey: string): Promise<void> {
  await db.execute('DELETE FROM bot_messages WHERE session_key = ?', [sessionKey]);
  await db.execute('DELETE FROM bot_sessions WHERE session_key = ?', [sessionKey]);
}

/**
 * Update session metadata after message sync
 */
export async function updateBotSessionMeta(
  db: Database,
  sessionKey: string,
  meta: { last_message?: string; message_count?: number; updated_at?: number }
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (meta.last_message !== undefined) {
    sets.push('last_message = ?');
    values.push(meta.last_message);
  }
  if (meta.message_count !== undefined) {
    sets.push('message_count = ?');
    values.push(meta.message_count);
  }
  if (meta.updated_at !== undefined) {
    sets.push('updated_at = ?');
    values.push(meta.updated_at);
  }

  if (sets.length > 0) {
    sets.push('synced_at = ?');
    values.push(Date.now());
    values.push(sessionKey);

    await db.execute(
      `UPDATE bot_sessions SET ${sets.join(', ')} WHERE session_key = ?`,
      values
    );
  }
}
```

**Step 3: Verify TypeScript compilation**

Run: `cd /Users/fch/Documents/github/workany && pnpm exec tsc --noEmit --project src/tsconfig.json`
Expected: No errors

**Step 4: Commit**

```bash
git add src/shared/db/database.ts
git commit -m "feat(db): add bot session CRUD functions"
```

---

## Task 4: Implement Bot Message Database Functions

**Files:**
- Modify: `src/shared/db/database.ts`

**Step 1: Add message CRUD functions**

Add these functions to `database.ts` after session functions:

```typescript
// ============================================================================
// Bot Message Operations
// ============================================================================

/**
 * Generate a unique message ID for deduplication
 */
export function generateBotMsgId(sessionKey: string, timestamp: number, role: string): string {
  return `${sessionKey}_${timestamp}_${role}`;
}

/**
 * Upsert a bot message to the database
 */
export async function upsertBotMessage(db: Database, message: BotMessageRow): Promise<void> {
  const msgId = message.msg_id ?? generateBotMsgId(
    message.session_key,
    message.timestamp ?? Date.now(),
    message.role
  );

  await db.execute(
    `INSERT OR REPLACE INTO bot_messages
     (session_key, msg_id, role, content, raw_content, tool_call_id, tool_name, details, is_error, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.session_key,
      msgId,
      message.role,
      message.content ?? null,
      message.raw_content ?? null,
      message.tool_call_id ?? null,
      message.tool_name ?? null,
      message.details ?? null,
      message.is_error ? 1 : 0,
      message.timestamp ?? Date.now(),
    ]
  );
}

/**
 * Upsert multiple bot messages
 */
export async function upsertBotMessages(db: Database, messages: BotMessageRow[]): Promise<void> {
  for (const message of messages) {
    await upsertBotMessage(db, message);
  }
}

/**
 * Get all messages for a bot session
 */
export async function getBotMessages(db: Database, sessionKey: string): Promise<BotMessageRow[]> {
  const result = await db.select<BotMessageRow[]>(
    'SELECT * FROM bot_messages WHERE session_key = ? ORDER BY timestamp ASC',
    [sessionKey]
  );
  return result;
}

/**
 * Clear all messages for a bot session
 */
export async function clearBotMessages(db: Database, sessionKey: string): Promise<void> {
  await db.execute('DELETE FROM bot_messages WHERE session_key = ?', [sessionKey]);
}

/**
 * Get message count for a session
 */
export async function getBotMessageCount(db: Database, sessionKey: string): Promise<number> {
  const result = await db.select<{ count: number }[]>(
    'SELECT COUNT(*) as count FROM bot_messages WHERE session_key = ?',
    [sessionKey]
  );
  return result[0]?.count ?? 0;
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd /Users/fch/Documents/github/workany && pnpm exec tsc --noEmit --project src/tsconfig.json`
Expected: No errors

**Step 3: Commit**

```bash
git add src/shared/db/database.ts
git commit -m "feat(db): add bot message CRUD functions"
```

---

## Task 5: Create Bot Sync Utility Functions

**Files:**
- Create: `src/shared/lib/bot-sync.ts`

**Step 1: Create bot-sync.ts**

```typescript
/**
 * Bot Session Sync Utilities
 *
 * Handles syncing bot sessions and messages between cloud and local SQLite.
 */

import type { Database } from '@tauri-apps/plugin-sql';
import {
  getBotSessions,
  upsertBotSessions,
  getBotMessages,
  upsertBotMessages,
  updateBotSessionMeta,
} from '@/shared/db/database';
import type { BotSessionRow, BotMessageRow } from '@/shared/db/types';
import type { BotContentPart } from '@/shared/hooks/useBotChats';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:2026';

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
  const response = await fetch(`${API_BASE}/openclaw/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeLastMessage: true }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch sessions: ${response.statusText}`);
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
export async function fetchCloudMessages(sessionKey: string): Promise<BotMessageRow[]> {
  const response = await fetch(`${API_BASE}/openclaw/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionKey }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch messages: ${response.statusText}`);
  }

  const data = await response.json();
  const messages = data.messages ?? [];

  return messages.map((m: any, index: number) => ({
    session_key: sessionKey,
    msg_id: m.__optimisticId ?? `${sessionKey}_${m.timestamp}_${index}`,
    role: m.role === 'system' ? 'assistant' : (m.role ?? 'assistant'),
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
  await upsertBotMessages(db, cloudMessages);

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
    rawContent: row.raw_content ? JSON.parse(row.raw_content) as BotContentPart[] : undefined,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    details: row.details ? JSON.parse(row.details) : undefined,
    isError: row.is_error,
  };
}

/**
 * Convert BotSessionRow to BotChatSession format
 */
export function rowToBotChatSession(row: BotSessionRow, messages: BotMessageRow[] = []) {
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
```

**Step 2: Verify TypeScript compilation**

Run: `cd /Users/fch/Documents/github/workany && pnpm exec tsc --noEmit --project src/tsconfig.json`
Expected: No errors

**Step 3: Commit**

```bash
git add src/shared/lib/bot-sync.ts
git commit -m "feat(sync): add bot session sync utilities"
```

---

## Task 6: Update BotChatProvider for SQLite Sync

**Files:**
- Modify: `src/shared/providers/bot-chat-provider.tsx`

**Step 1: Read current provider file**

First read the file to understand current structure, then modify.

**Step 2: Add imports and sync logic**

Add at top of file:
```typescript
import { getDatabase } from '@/shared/db/database';
import {
  getBotSessions,
  getBotMessages,
} from '@/shared/db/database';
import {
  syncBotSessions,
  syncBotMessages,
  rowToBotChatSession,
  rowToBotChatMessage,
  type BotSyncState,
} from '@/shared/lib/bot-sync';
import type { BotSessionRow, BotMessageRow } from '@/shared/db/types';
```

**Step 3: Add sync state to context**

In the provider, add sync state and modify initialization:

```typescript
// Add to context value
const [syncState, setSyncState] = useState<BotSyncState>({
  isSyncingSessions: false,
  syncingSessionKey: null,
  lastSyncTime: null,
  syncError: null,
});

// Add sync function
const syncSessions = useCallback(async () => {
  try {
    setSyncState(s => ({ ...s, isSyncingSessions: true, syncError: null }));
    const db = await getDatabase();
    await syncBotSessions(db);
    const sessions = await getBotSessions(db);
    // Update sessions state with converted data
    // setSessions(sessions.map(...))
    setSyncState(s => ({
      ...s,
      isSyncingSessions: false,
      lastSyncTime: Date.now(),
    }));
  } catch (error) {
    setSyncState(s => ({
      ...s,
      isSyncingSessions: false,
      syncError: error instanceof Error ? error.message : 'Sync failed',
    }));
  }
}, []);

// Add message sync function
const syncMessages = useCallback(async (sessionKey: string) => {
  try {
    setSyncState(s => ({ ...s, syncingSessionKey: sessionKey }));
    const db = await getDatabase();
    await syncBotMessages(db, sessionKey);
    setSyncState(s => ({ ...s, syncingSessionKey: null }));
  } catch (error) {
    setSyncState(s => ({
      ...s,
      syncingSessionKey: null,
      syncError: error instanceof Error ? error.message : 'Sync failed',
    }));
  }
}, []);
```

**Step 4: Commit**

```bash
git add src/shared/providers/bot-chat-provider.tsx
git commit -m "feat(provider): integrate SQLite sync in BotChatProvider"
```

---

## Task 7: Update BotChat Page to Use Local Data First

**Files:**
- Modify: `src/app/pages/BotChat.tsx`

**Step 1: Read current BotChat page**

Understand current message loading logic.

**Step 2: Modify to load local data first, then sync**

When opening a session:
1. Load messages from SQLite immediately
2. Trigger background sync
3. Refresh when sync completes

**Step 3: Commit**

```bash
git add src/app/pages/BotChat.tsx
git commit -m "feat(botchat): load local messages first with background sync"
```

---

## Task 8: Test and Verify

**Step 1: Build and run the app**

```bash
cd /Users/fch/Documents/github/workany
pnpm dev:app
```

**Step 2: Test scenarios**

1. Open app - verify sessions sync on startup
2. Open a bot session - verify local messages show immediately
3. Wait for sync - verify messages update
4. Close and reopen - verify cached data persists

**Step 3: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: resolve sync issues"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add database schema | `src-tauri/src/lib.rs` |
| 2 | Add TypeScript types | `src/shared/db/types.ts` |
| 3 | Session CRUD functions | `src/shared/db/database.ts` |
| 4 | Message CRUD functions | `src/shared/db/database.ts` |
| 5 | Sync utilities | `src/shared/lib/bot-sync.ts` |
| 6 | Update provider | `src/shared/providers/bot-chat-provider.tsx` |
| 7 | Update BotChat page | `src/app/pages/BotChat.tsx` |
| 8 | Test and verify | - |

# Bot Session SQLite 同步设计文档

## 概述

实现 Bot Session 和消息历史同步到本地 SQLite 数据库，支持离线访问和快速加载。

## 需求

1. **应用启动时**：同步 bot session 列表到本地 SQLite
2. **打开 Session 时**：先显示本地数据，后台静默同步云端历史，更新本地数据库

## 数据库 Schema

### bot_sessions 表

```sql
CREATE TABLE bot_sessions (
    session_key TEXT PRIMARY KEY,      -- 对应 sessionKey
    friendly_id TEXT,                   -- 对应 friendlyId
    label TEXT,                         -- 对应 label (标题)
    last_message TEXT,                  -- 对应 lastMessage (预览)
    message_count INTEGER DEFAULT 0,    -- 对应 messageCount
    updated_at INTEGER,                 -- 对应 updatedAt (云端时间戳)
    synced_at INTEGER                   -- 本地同步时间戳
);
```

### bot_messages 表

```sql
CREATE TABLE bot_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key TEXT NOT NULL,          -- 关联 session
    msg_id TEXT,                        -- 消息唯一标识 (用于去重)
    role TEXT NOT NULL,                 -- 'user' | 'assistant' | 'toolResult'
    content TEXT,                       -- 文本内容
    raw_content TEXT,                   -- JSON: BotContentPart[]
    tool_call_id TEXT,                  -- 对应 toolCallId
    tool_name TEXT,                     -- 对应 toolName
    details TEXT,                       -- JSON: 额外信息
    is_error INTEGER DEFAULT 0,         -- 对应 isError
    timestamp INTEGER,                  -- 消息时间戳
    UNIQUE(session_key, msg_id)         -- 去重约束
);
```

### 索引

```sql
CREATE INDEX idx_bot_msgs_session ON bot_messages(session_key);
CREATE INDEX idx_bot_msgs_timestamp ON bot_messages(timestamp);
```

## 同步流程

### 应用启动时同步 Session 列表

```
App 启动
    │
    ▼
BotChatProvider 初始化
    │
    ▼
POST /openclaw/sessions → 获取云端 session 列表
    │
    ▼
UPSERT 到 bot_sessions 表
    │
    ▼
UI 从 SQLite 加载显示
```

### 打开 Session 时同步消息

```
用户打开 Session
    │
    ▼
立即从 SQLite 加载本地消息显示 (用户可立即看到历史)
    │
    ▼ (后台)
POST /openclaw/history → 获取云端消息
    │
    ▼
基于 msg_id 去重，UPSERT 到 bot_messages 表
    │
    ▼
UI 刷新显示最新数据
```

## 实现组件

### 需要修改/新增的文件

| 文件 | 变更 | 说明 |
|------|------|------|
| `src-tauri/src/lib.rs` | 修改 | 添加表迁移 |
| `src/shared/db/database.ts` | 新增函数 | bot session/message CRUD |
| `src/shared/db/types.ts` | 新增类型 | `BotSessionRow`, `BotMessageRow` |
| `src/shared/providers/bot-chat-provider.tsx` | 修改 | 集成 SQLite 同步 |
| `src/shared/hooks/useBotChats.ts` | 修改 | 从 SQLite 读取 |

### 新增数据库函数

```typescript
// Session 操作
upsertBotSession(session: BotSessionRow): Promise<void>
getBotSessions(): Promise<BotSessionRow[]>
getBotSession(sessionKey: string): Promise<BotSessionRow | null>
deleteBotSession(sessionKey: string): Promise<void>

// Message 操作
upsertBotMessages(sessionKey: string, messages: BotMessageRow[]): Promise<void>
getBotMessages(sessionKey: string): Promise<BotMessageRow[]>
clearBotMessages(sessionKey: string): Promise<void>
```

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| OpenClaw 未配置 | 跳过同步，只显示本地数据 |
| 网络请求失败 | 静默失败，不阻塞 UI |
| 同步中途断开 | 下次打开时重新同步 |
| 数据库写入失败 | 记录日志，降级到 localStorage |

## 状态管理

```typescript
interface BotSyncState {
  isSyncingSessions: boolean;
  syncingSessionKey: string | null;
  lastSyncTime: number | null;
  syncError: string | null;
}
```

## 类型定义

### BotSessionRow

```typescript
interface BotSessionRow {
  session_key: string;
  friendly_id?: string;
  label?: string;
  last_message?: string;
  message_count: number;
  updated_at?: number;
  synced_at?: number;
}
```

### BotMessageRow

```typescript
interface BotMessageRow {
  session_key: string;
  msg_id?: string;
  role: 'user' | 'assistant' | 'toolResult';
  content?: string;
  raw_content?: string; // JSON string
  tool_call_id?: string;
  tool_name?: string;
  details?: string; // JSON string
  is_error: boolean;
  timestamp?: number;
}
```

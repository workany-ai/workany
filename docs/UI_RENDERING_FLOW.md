# 界面渲染流程

## 架构概览

WebClaw 使用 **TanStack Router** 文件路由 + **TanStack Query** 服务端状态管理 + **React 19** 进行渲染。

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │  TanStack Router│◄──►│   React UI      │                │
│  │   (File Routes) │    │   Components    │                │
│  └────────┬────────┘    └────────┬────────┘                │
│           │                     │                           │
│           │                ┌────▼────────┐                  │
│           │                │ TanStack    │                  │
│           │                │ QueryClient │                  │
│           │                └────┬────────┘                  │
│           │                     │                           │
│           ▼                     ▼                           │
│  ┌─────────────────────────────────────────────┐           │
│  │          HTTP API (/api/*)                   │           │
│  └────────────────────┬────────────────────────┘           │
└───────────────────────┼──────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────┐
│                    Server (Node.js)                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Route Handlers (SSR)                    │   │
│  │  /api/sessions | /api/history | /api/send | /api/ping│   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │               gatewayRpc() - WebSocket Client       │   │
│  └──────────────────────┬──────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                  ClawBot Gateway                             │
│                  (ws://127.0.0.1:18789)                     │
└─────────────────────────────────────────────────────────────┘
```

## 目录结构

```
src/
├── routes/                    # TanStack 文件路由
│   ├── __root.tsx            # 根布局（QueryClient + 主题）
│   ├── index.tsx             # 重定向到 /chat/main
│   ├── connect.tsx           # 连接配置页
│   ├── new.tsx               # 新建聊天页
│   └── chat/
│       └── $sessionKey.tsx   # 动态聊天路由
│
├── screens/                   # 屏幕级组件
│   └── chat/
│       ├── chat-screen.tsx   # 主聊天屏幕
│       ├── chat-queries.ts   # Query 函数和缓存操作
│       ├── chat-ui.ts        # UI 状态管理
│       ├── pending-send.ts   # 待发送消息管理
│       ├── components/       # 聊天相关组件
│       │   ├── chat-sidebar.tsx
│       │   ├── chat-header.tsx
│       │   ├── chat-message-list.tsx
│       │   └── chat-composer.tsx
│       └── hooks/            # 聊天相关 hooks
│           ├── use-chat-sessions.ts
│           ├── use-chat-history.ts
│           └── use-chat-measurements.ts
│
├── components/                # 共享组件
│   ├── ui/                   # Base UI 组件
│   └── prompt-kit/           # 聊天输入相关
│
└── server/
    └── gateway.ts            # Gateway RPC 客户端
```

## 渲染流程

### 1. 应用初始化

**文件**: `src/routes/__root.tsx`

```typescript
// 1. 主题脚本（避免闪烁）
<script dangerouslySetInnerHTML={{ __html: themeScript }} />

// 2. QueryClient Provider
<QueryClientProvider client={queryClient}>
  <Outlet />
</QueryClientProvider>
```

### 2. 路由层

**文件**: `src/routes/chat/$sessionKey.tsx`

```typescript
function ChatRoute() {
  const params = Route.useParams()
  const activeFriendlyId = params.sessionKey  // 从 URL 获取

  return (
    <ChatScreen
      activeFriendlyId={activeFriendlyId}
      isNewChat={activeFriendlyId === 'new'}
      onSessionResolved={handleSessionResolved}
    />
  )
}
```

### 3. 屏幕层 (ChatScreen)

**文件**: `src/screens/chat/chat-screen.tsx`

#### 数据获取

```typescript
// 1. 会话列表
const { sessions, activeSession, activeSessionKey, activeTitle } =
  useChatSessions({ activeFriendlyId })

// 2. 聊天历史
const { historyMessages, displayMessages, resolvedSessionKey } =
  useChatHistory({ activeFriendlyId, activeSessionKey })

// 3. Gateway 状态
const gatewayStatusQuery = useQuery({
  queryKey: ['gateway', 'status'],
  queryFn: fetchGatewayStatus,
})
```

#### UI 组件树

```
ChatScreen
├── ChatSidebar         // 会话列表侧边栏
├── main
│   ├── ChatHeader      // 标题栏（导出、Token 使用）
│   ├── ChatMessageList // 消息列表
│   └── ChatComposer    // 输入框
```

### 4. 数据流

#### 获取会话列表

```
useChatSessions (hook)
    │
    ├─► useQuery({
    │      queryKey: ['chat', 'sessions'],
    │      queryFn: fetchSessions
    │    })
    │         │
    │         ▼
    │    fetch('/api/sessions')
    │         │
    │         ▼
    │    sessions.list RPC
    │         │
    │         ▼
    │    normalizeSessions() // 处理 friendlyId
    │         │
    │         ▼
    └─► { sessions, activeSession, activeTitle }
```

#### 获取聊天历史

```
useChatHistory (hook)
    │
    ├─► useQuery({
    │      queryKey: ['chat', 'history', friendlyId, sessionKey],
    │      queryFn: () => fetchHistory({ sessionKey, friendlyId })
    │    })
    │         │
    │         ▼
    │    fetch('/api/history?sessionKey=xxx&friendlyId=yyy')
    │         │
    │         ▼
    │    chat.history RPC
    │         │
    │         ▼
    └─► { historyMessages, displayMessages }
```

#### 发送消息流程

```
ChatComposer.onSubmit
    │
    ▼
send(body, helpers)
    │
    ├─► isNewChat?
    │   │
    │   ├─ Yes → createSessionForMessage()
    │   │          │
    │   │          ▼
    │   │     fetch('/api/sessions', { method: 'POST' })
    │   │          │
    │   │          ▼
    │   │     stashPendingSend() // 暂存消息
    │   │          │
    │   │          ▼
    │   │     navigate('/chat/' + friendlyId)
    │   │
    │   └─ No → sendMessage(sessionKey, friendlyId, body)
    │              │
    │              ├─► createOptimisticMessage() // 创建乐观消息
    │              │      │
    │              │      ▼
    │              │ appendHistoryMessage() // 立即更新 UI
    │              │      │
    │              │      ▼
    │              ├─► fetch('/api/send', { method: 'POST' })
    │              │      │
    │              │      ▼
    │              │      chat.send RPC
    │              │      │
    │              │      ▼
    │              │    streamStart() // 开始轮询历史
    │              │      │
    │              │      ▼
    │              │    setInterval(() => {
    │              │      historyQuery.refetch() // 每 350ms 刷新
    │              │    }, 350)
```

### 5. 乐观更新 (Optimistic Updates)

```typescript
// 1. 创建乐观消息
const { clientId, optimisticMessage } = createOptimisticMessage(body, attachments)

// 2. 立即写入缓存
appendHistoryMessage(queryClient, friendlyId, sessionKey, optimisticMessage)

// 3. 更新会话列表的最后消息
updateSessionLastMessage(queryClient, sessionKey, friendlyId, optimisticMessage)

// 4. 发送实际请求
fetch('/api/send', { ... })

// 5. 轮询获取真实响应
setInterval(() => historyQuery.refetch(), 350)

// 6. 通过 clientId 匹配，替换乐观消息为真实消息
```

### 6. Query Keys 结构

```typescript
export const chatQueryKeys = {
  sessions: ['chat', 'sessions'],                           // 会话列表
  history: (friendlyId, sessionKey) =>                      // 聊天历史
    ['chat', 'history', friendlyId, sessionKey],
}

// UI 状态
chatUiQueryKey: ['chat', 'ui']

// Gateway 状态
['gateway', 'status']
```

### 7. 渲染关键点

#### 防止全量重渲染

```typescript
// 1. 输入框状态本地化
const [value, setValue] = useState('')  // 在 Composer 内部

// 2. 消息行 memo 化
const MessageRow = memo(({ message }) => { ... }, contentEquality)

// 3. 传递派生数据而非完整数组
// 不好: 传递整个 messages 数组
//好: 传递 messages Map 或只需要的消息 ID
```

#### 滚动容器优化

```typescript
// Memoize 滚动外壳，portal 变化内容
<ScrollShell memo>
  {changingContent}
</ScrollShell>
```

#### 流式检测

```typescript
// 通过消息签名检测变化
const signature = `${historyMessages.length}:${textFromMessage(latestMessage).slice(-64)}`

// 4 秒无变化则停止轮询
setTimeout(() => streamFinish(), 4000)
```

## 状态管理

| 状态类型 | 方案 | 存储位置 |
|---------|------|---------|
| 服务端状态 | TanStack Query | QueryClient Cache |
| 本地设置 | Zustand | localStorage (chat-settings) |
| UI 状态 | TanStack Query Cache | QueryClient Cache |
| 待发送消息 | localStorage | pending-send |

## 相关文件

| 文件 | 作用 |
|------|------|
| `src/routes/__root.tsx` | 根布局，主题初始化 |
| `src/routes/chat/$sessionKey.tsx` | 聊天路由，处理参数 |
| `src/screens/chat/chat-screen.tsx` | 主聊天屏幕 |
| `src/screens/chat/chat-queries.ts` | Query 函数和缓存操作 |
| `src/screens/chat/hooks/use-chat-sessions.ts` | 会话列表 hook |
| `src/screens/chat/hooks/use-chat-history.ts` | 聊天历史 hook |
| `src/screens/chat/pending-send.ts` | 待发送消息管理 |
| `src/server/gateway.ts` | Gateway RPC 客户端 |

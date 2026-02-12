# WorkAny WebSocket Protocol

本文档定义 WorkAny API 服务器与前端客户端之间的 WebSocket 通信协议。

## 架构概览

```
┌─────────────┐     WebSocket      ┌─────────────┐     WebSocket      ┌─────────────┐
│   Frontend  │◄──────────────────►│  WorkAny    │◄──────────────────►│  MoltBot    │
│   (Client)  │    Port 2026       │  API Server │   Port 18789       │  Gateway    │
└─────────────┘                    └─────────────┘                    └─────────────┘
```

## 1. 连接建立

### 1.1 前端 → WorkAny API

前端连接到 WorkAny API 的 WebSocket 端点：
```
ws://localhost:2026/openclaw/ws
```

### 1.2 连接确认

服务器立即发送 `connected` 消息：
```json
{
  "type": "connected"
}
```

---

## 2. 订阅管理

### 2.1 订阅会话

**客户端发送：**
```json
{
  "type": "subscribe",
  "sessionKey": "bot_1734567890123",
  "config": {
    "gatewayUrl": "ws://127.0.0.1:18789",
    "authToken": "optional-token"
  }
}
```

**服务器响应：**
```json
{
  "type": "subscribed",
  "sessionKey": "bot_1734567890123"
}
```

### 2.2 取消订阅

**客户端发送：**
```json
{
  "type": "unsubscribe",
  "sessionKey": "bot_1734567890123"
}
```

**服务器响应：**
```json
{
  "type": "unsubscribed",
  "sessionKey": "bot_1734567890123"
}
```

### 2.3 Session Key 格式

| 格式 | 示例 | 说明 |
|------|------|------|
| 短格式 (前端使用) | `bot_1734567890123` | 前端创建和存储 |
| 规范格式 (MoltBot) | `agent:main:bot_1734567890123` | MoltBot 事件中使用 |

**重要**：服务器自动将短格式转换为规范格式进行订阅匹配。

---

## 3. 事件类型

MoltBot Gateway 会发送两种事件类型，WorkAny API 转发给客户端：

### 3.1 Chat 事件 (`event: "chat"`)

用于传递完整的聊天消息。

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "run_1734567890123_abc",
    "sessionKey": "agent:main:bot_1734567890123",
    "seq": 5,
    "state": "delta | final | error | aborted",
    "message": {
      "role": "assistant",
      "content": [{"type": "text", "text": "Hello!"}],
      "timestamp": 1734567890123
    },
    "errorMessage": "optional error message"
  }
}
```

| state | 说明 | UI 处理 |
|-------|------|---------|
| `delta` | 流式文本片段 | 更新 `chatStream` 显示流式文本 |
| `final` | 完成消息 | 添加到消息历史，清除 loading |
| `error` | 错误 | 显示错误消息，清除 loading |
| `aborted` | 中止 | 清除 loading |

### 3.2 Agent 事件 (`event: "agent"`)

用于传递 Agent 执行过程中的详细事件。

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "runId": "run_1734567890123_abc",
    "sessionKey": "agent:main:bot_1734567890123",
    "seq": 10,
    "stream": "tool | lifecycle | assistant | error",
    "ts": 1734567890123,
    "data": { ... }
  }
}
```

#### 3.2.1 `stream: "assistant"` - 流式文本

**当 MoltBot 不发送 chat 事件时，这是主要的文本来源**

```json
{
  "stream": "assistant",
  "data": {
    "text": "Hello! How can I help?",
    "delta": " help?"
  }
}
```

| 字段 | 说明 |
|------|------|
| `text` | 累积的完整文本 |
| `delta` | 本次新增的文本片段 |

**UI 处理**：使用 `data.text` 更新 `chatStream` 显示流式文本。

#### 3.2.2 `stream: "lifecycle"` - 生命周期

```json
{
  "stream": "lifecycle",
  "data": {
    "phase": "start | end | error",
    "startedAt": 1734567890123,
    "endedAt": 1734567891234
  }
}
```

| phase | 说明 | UI 处理 |
|-------|------|---------|
| `start` | Agent 开始执行 | 可选：显示开始状态 |
| `end` | Agent 执行完成 | **必须**：使用当前 `chatStream` 创建消息，添加到历史，清除 loading |
| `error` | 执行出错 | 显示错误，清除 loading |

#### 3.2.3 `stream: "tool"` - 工具调用

```json
{
  "stream": "tool",
  "data": {
    "phase": "start | update | result | end | error",
    "name": "search",
    "toolCallId": "call_abc123",
    "args": {"query": "hello"},
    "result": {...},
    "error": "optional error"
  }
}
```

**UI 处理**：显示工具调用状态，可用于展示 Agent 正在执行的操作。

---

## 4. 消息发送流程

### 4.1 发送消息

前端通过 REST API 发送消息：

```http
POST /openclaw/chat
Content-Type: application/json

{
  "message": "Hello",
  "sessionId": "bot_1734567890123",
  "gatewayUrl": "ws://127.0.0.1:18789",
  "authToken": "optional-token"
}
```

**响应：**
```json
{
  "success": true,
  "runId": "run_1734567890123_abc",
  "sessionKey": "bot_1734567890123",
  "status": "accepted"
}
```

### 4.2 完整流程

```
┌──────────┐          ┌──────────┐          ┌──────────┐
│ Frontend │          │WorkAny API│          │ MoltBot  │
└────┬─────┘          └────┬─────┘          └────┬─────┘
     │                     │                     │
     │  1. POST /openclaw/chat                   │
     │────────────────────►│                     │
     │                     │                     │
     │  2. {status: "accepted"}                  │
     │◄────────────────────│                     │
     │                     │                     │
     │                     │  3. chat.send       │
     │                     │────────────────────►│
     │                     │                     │
     │                     │  4. {runId, status} │
     │                     │◄────────────────────│
     │                     │                     │
     │  5. agent.lifecycle.start                 │
     │◄────────────────────│◄────────────────────│
     │                     │                     │
     │  6. agent.assistant (multiple)            │
     │◄────────────────────│◄────────────────────│
     │     text: "Hello..."                      │
     │                     │                     │
     │  7. agent.lifecycle.end                   │
     │◄────────────────────│◄────────────────────│
     │                     │                     │
     │  (可能) chat.final   │                     │
     │◄────────────────────│◄────────────────────│
     │                     │                     │
```

---

## 5. UI 状态管理

### 5.1 状态定义

```typescript
interface BotChatState {
  // 消息历史
  messages: BotMessage[];

  // 流式文本（正在生成的回复）
  chatStream: string | null;

  // 工具调用流
  toolStream: Map<string, ToolStreamEntry>;

  // 加载状态
  isLoading: boolean;

  // 连接状态
  isConnected: boolean;
  isSubscribed: boolean;
}
```

### 5.2 事件处理逻辑

```typescript
function handleEvent(event: WebSocketEvent) {
  switch (event.event) {
    case 'chat':
      handleChatEvent(event.payload);
      break;
    case 'agent':
      handleAgentEvent(event.payload);
      break;
  }
}

function handleChatEvent(payload: ChatPayload) {
  switch (payload.state) {
    case 'delta':
      // 更新 chatStream
      setChatStream(extractText(payload.message));
      break;
    case 'final':
      // 添加到消息历史
      addMessage(payload.message);
      clearLoading();
      break;
    case 'error':
      showError(payload.errorMessage);
      clearLoading();
      break;
    case 'aborted':
      clearLoading();
      break;
  }
}

function handleAgentEvent(payload: AgentPayload) {
  switch (payload.stream) {
    case 'assistant':
      // 更新 chatStream（当没有 chat 事件时）
      setChatStream(payload.data.text);
      break;
    case 'lifecycle':
      if (payload.data.phase === 'end') {
        // 使用 chatStream 创建消息
        if (chatStream) {
          addMessage({ role: 'assistant', content: chatStream });
        }
        clearLoading();
      }
      break;
    case 'tool':
      // 更新工具调用显示
      updateToolStream(payload.data);
      break;
  }
}
```

### 5.3 UI 显示优先级

1. **消息历史 (`messages`)**：显示已完成的消息
2. **流式文本 (`chatStream`)**：显示正在生成的回复
3. **工具调用 (`toolStream`)**：可选，显示 Agent 正在执行的操作

---

## 6. 错误处理

### 6.1 连接错误

```json
{
  "type": "error",
  "message": "Failed to connect to gateway"
}
```

### 6.2 超时处理

前端应设置超时（建议 60 秒），超时后：
1. 清除 loading 状态
2. 显示超时错误消息
3. 建议用户检查 Gateway 是否运行

### 6.3 断线重连

- WorkAny API 会自动尝试重连 MoltBot Gateway
- 前端应监听 `isConnected` 状态变化
- 重连后需要重新订阅 session

---

## 7. Keep-Alive

客户端每 30 秒发送 ping：
```json
{
  "type": "ping"
}
```

服务器响应：
```json
{
  "type": "pong"
}
```

---

## 8. 注意事项

### 8.1 事件来源的双重性

MoltBot Gateway 可能通过两种方式发送事件：
- `broadcast()` - 发送给所有 operator
- `nodeSendToSession()` - 发送给订阅的 node

WorkAny API 使用 `role: 'node'` 连接，理论上只应收到 `nodeSendToSession` 的事件。
但如果收到重复事件，WorkAny API 会通过 `(runId, seq)` 进行去重。

### 8.2 事件类型的兼容性

不同版本的 MoltBot 可能发送不同的事件类型：
- **有 `chat` 事件**：使用 `chat.delta` / `chat.final`
- **无 `chat` 事件**：使用 `agent.assistant` / `agent.lifecycle.end`

前端应同时支持两种情况，优先处理 `chat` 事件，`agent.lifecycle.end` 作为兜底。

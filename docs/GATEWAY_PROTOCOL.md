# Claw Bot Gateway 通信协议文档

## 概述

WebClaw 通过 WebSocket 与 OpenClaw Gateway 进行通信，使用自定义的 JSON-RPC 协议。

**默认地址**: `ws://127.0.0.1:18789`

## 认证方式

支持两种认证方式（推荐 Token）：

| 方式 | 环境变量 | 说明 |
|------|----------|------|
| Token | `CLAWDBOT_GATEWAY_TOKEN` | 推荐（更安全） |
| Password | `CLAWDBOT_GATEWAY_PASSWORD` | 备选方案 |

## 协议帧类型

所有帧均为 JSON 格式：

### 1. 请求帧 (Request)

```typescript
{
  type: 'req',
  id: string,           // UUID，用于匹配响应
  method: string,       // 方法名
  params?: unknown      // 参数
}
```

### 2. 响应帧 (Response)

```typescript
{
  type: 'res',
  id: string,           // 对应请求的 ID
  ok: boolean,          // 是否成功
  payload?: unknown,    // 成功时的数据
  error?: {             // 失败时的错误信息
    code: string,
    message: string,
    details?: unknown
  }
}
```

### 3. 事件帧 (Event)

```typescript
{
  type: 'event',
  event: string,        // 事件名
  payload?: unknown,    // 事件数据
  seq?: number          // 序列号
}
```

## 通信流程

```
Client                    Gateway
  |                          |
  |-------- WebSocket ------->|  (连接建立)
  |                          |
  |---- { type: 'req',       |
  |      method: 'connect',  |
  |      params: {...} } --->|  (握手，必须是第一个请求)
  |                          |
  |<--- { type: 'res',       |
  |      ok: true } ---------|  (握手成功)
  |                          |
  |---- { type: 'req',       |
  |      method: 'xxx',      |
  |      params: {...} } --->|  (实际业务请求)
  |                          |
  |<--- { type: 'res',       |
  |      payload: {...} } ---|  (业务响应)
```

## 连接握手 (connect)

**必须是第一个请求**。

### 请求格式

```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "gateway-client",
      "displayName": "webclaw",
      "version": "dev",
      "platform": "darwin",
      "mode": "ui",
      "instanceId": "<uuid>"
    },
    "auth": {
      "token": "<token>"
    },
    "role": "operator",
    "scopes": ["operator.admin"]
  }
}
```

### 参数说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `minProtocol` / `maxProtocol` | number | 协议版本范围 |
| `client.id` | string | 客户端 ID |
| `client.displayName` | string | 显示名称 |
| `client.version` | string | 版本号 |
| `client.platform` | string | 系统平台 (darwin/linux/win32) |
| `client.mode` | string | 客户端模式 (ui/cli) |
| `client.instanceId` | string | 实例 UUID |
| `auth.token` / `auth.password` | string | 认证凭据 |
| `role` | string | 角色 (operator/node) |
| `scopes` | string[] | 权限范围 |

## RPC 方法列表

### sessions.list - 获取会话列表

```typescript
// 请求
{
  method: 'sessions.list',
  params: {
    limit: 50,
    includeLastMessage: true,
    includeDerivedTitles: true
  }
}

// 响应
{
  sessions: Array<{
    key: string,           // 会话唯一标识
    friendlyId?: string,   // 友好 ID
    label?: string,        // 会话标签
    // ...
  }>
}
```

### sessions.resolve - 解析会话 ID

将 `friendlyId` 解析为真实的 `sessionKey`：

```typescript
// 请求
{
  method: 'sessions.resolve',
  params: {
    key: friendlyId,       // 传入 friendlyId
    includeUnknown: true,
    includeGlobal: true
  }
}

// 响应
{
  ok: boolean,
  key: string             // 返回真实的 sessionKey
}
```

### sessions.patch - 创建/更新会话

```typescript
// 请求（创建）
{
  method: 'sessions.patch',
  params: {
    key: friendlyId,       // 新会话的 key
    label: '可选标签'      // 可选
  }
}

// 响应
{
  ok: boolean,
  key: string,
  path?: string,
  entry?: Record<string, unknown>
}
```

### sessions.delete - 删除会话

```typescript
// 请求
{
  method: 'sessions.delete',
  params: {
    key: sessionKey
  }
}
```

### chat.history - 获取聊天历史

```typescript
// 请求
{
  method: 'chat.history',
  params: {
    sessionKey: 'main',   // 默认 'main'
    limit: 200            // 消息数量限制
  }
}

// 响应
{
  sessionKey: string,
  sessionId?: string,
  messages: Array<any>,
  thinkingLevel?: string
}
```

### chat.send - 发送消息

```typescript
// 请求
{
  method: 'chat.send',
  params: {
    sessionKey: 'main',
    message: '用户消息',
    thinking: 'high',              // 可选：思考级别
    attachments: [                 // 可选：附件
      {
        mimeType: 'image/png',
        content: 'base64...'
      }
    ],
    deliver: false,                // 是否推送
    timeoutMs: 120000,             // 超时时间
    idempotencyKey: 'uuid'         // 幂等性 key
  }
}

// 响应
{
  runId: string         // 运行 ID
}
```

## HTTP API 映射

WebClaw 通过 TanStack Router 的文件路由提供 HTTP API，后端调用 Gateway RPC：

| HTTP 方法 | 路由 | Gateway 方法 | 功能 |
|-----------|------|-------------|------|
| GET | `/api/ping` | (仅握手) | 检查 Gateway 连接 |
| GET | `/api/sessions` | `sessions.list` | 获取会话列表 |
| POST | `/api/sessions` | `sessions.patch` + `sessions.resolve` | 创建新会话 |
| PATCH | `/api/sessions` | `sessions.resolve` + `sessions.patch` | 更新会话标签 |
| DELETE | `/api/sessions` | `sessions.resolve` + `sessions.delete` | 删除会话 |
| GET | `/api/history` | `sessions.resolve` + `chat.history` | 获取聊天历史 |
| POST | `/api/send` | `sessions.resolve` + `chat.send` | 发送消息 |

## FriendlyID 机制

应用使用**双层 ID 系统**：

1. **`friendlyId`**: 前端生成的 UUID，用于 URL 和用户识别
2. **`sessionKey`**: Gateway 内部使用的真实会话标识

每次操作前先通过 `sessions.resolve` 将 `friendlyId` 转换为 `sessionKey`。

```
用户请求 (friendlyId)
       |
       v
sessions.resolve
       |
       v
Gateway 返回 (sessionKey)
       |
       v
实际业务操作 (sessionKey)
```

## RPC 调用模式

当前实现是**短连接模式**：每次 RPC 调用都创建新 WebSocket，发送请求后关闭连接。

```typescript
// 使用示例
const result = await gatewayRpc<YourType>('method.name', { param1: 'value' })
```

**流程**：
1. 创建 WebSocket 连接
2. 发送 `connect` 握手请求
3. 等待握手响应
4. 发送实际业务请求
5. 等待业务响应
6. 关闭连接

## 相关文件

- `src/server/gateway.ts` - Gateway RPC 客户端实现
- `src/routes/api/sessions.ts` - 会话管理 API
- `src/routes/api/history.ts` - 聊天历史 API
- `src/routes/api/send.ts` - 发送消息 API
- `src/routes/api/ping.ts` - 健康检查 API

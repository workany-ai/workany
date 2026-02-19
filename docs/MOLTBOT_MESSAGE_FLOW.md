# MoltBot Bot Chat Message Flow Documentation

This document describes the complete message flow for Bot chat scenarios in the moltbot project, serving as a reference for developing the WorkAny OpenClaw integration.

## 1. Connection & Authentication

### WebSocket Connection Establishment

The WebSocket connection flow works as follows:

1. **Server sends challenge**: Upon WebSocket connection, the server immediately sends a `connect.challenge` event with a nonce:
```json
{
  "type": "event",
  "event": "connect.challenge",
  "payload": { "nonce": "<uuid>", "ts": 1699999999999 }
}
```

2. **Client must respond with connect**: The client must send a `connect` request within the handshake timeout:
```json
{
  "type": "req",
  "id": "<client-request-id>",
  "method": "connect",
  "params": { /* ConnectParams */ }
}
```

3. **Server validates and responds**: Upon successful authentication, the server sends `hello-ok`.

### Role Differences: `operator` vs `node`

| Aspect | `role: 'operator'` | `role: 'node'` |
|--------|-------------------|----------------|
| **Default scopes** | `["operator.admin"]` | `[]` (empty) |
| **Command allowlist** | Not restricted | Restricted to allowed commands |
| **Node registration** | Not registered in NodeRegistry | Registered in `nodeRegistry.register()` |
| **Can use node.event** | No (unauthorized) | Yes |
| **Receives node events** | No (unless subscribed) | Yes, via `node.event` |

**Important**: For `chat.subscribe` via `node.event`, you MUST use `role: 'node'`.

---

## 2. Session Management

### Session Key Format

The canonical session key format is:
```
agent:{agentId}:{mainKey}
```

**Examples**:
- `agent:main:main` - Default agent's main session
- `agent:main:bot_1770879717221` - Bot chat session
- `agent:main:telegram:direct:12345678` - Telegram DM session

### Session Resolution

When a session key is provided to `chat.send`:
1. The key is resolved via `loadSessionEntry(sessionKey)`
2. Returns `{ cfg, entry, canonicalKey }` where `canonicalKey` is the normalized form
3. Events are broadcast with the `canonicalKey` as `sessionKey`

**Critical**: When subscribing, use the SAME sessionKey format that moltbot will use in events.

---

## 3. Message Sending Flow (`chat.send`)

### Complete Flow:

1. **Validate params** via `validateChatSendParams()`
2. **Resolve session** via `loadSessionEntry()`
3. **Check send policy** via `resolveSendPolicy()`
4. **Check for deduplication** using `idempotencyKey`
5. **Create AbortController** for the run
6. **Send immediate ACK** with `runId` and `status: "started"`
7. **Dispatch message** to agent
8. **Handle completion**: broadcast `chat` event with `state: "final"` or `state: "error"`

### ACK Response

```json
{
  "runId": "run_1770879717221_abc123",
  "status": "started"
}
```

---

## 4. Event Broadcasting

### `broadcast()` Function

Broadcasts events to ALL connected WebSocket clients (operators).

### `nodeSendToSession()` Function

Sends events ONLY to nodes subscribed to a specific session.

**Both are called for chat events**:
```typescript
broadcast("chat", payload);
nodeSendToSession(sessionKey, "chat", payload);
```

### Chat Event Types

| State | Description | When sent |
|-------|-------------|-----------|
| `delta` | Streaming text chunk | During response generation |
| `final` | Complete message | When agent run completes successfully |
| `error` | Error occurred | When agent run fails |
| `aborted` | Run was stopped | When user aborts |

### Event Format

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "run_1770879717221_abc123",
    "sessionKey": "agent:main:bot_1770879717221",
    "seq": 1,
    "state": "final",
    "message": {
      "role": "assistant",
      "content": [{"type": "text", "text": "Hello!"}],
      "timestamp": 1770879717221
    }
  }
}
```

---

## 5. Subscribing to Events (`node.event` with `chat.subscribe`)

### Subscription Request

```json
{
  "type": "req",
  "id": "req-123",
  "method": "node.event",
  "params": {
    "event": "chat.subscribe",
    "payloadJSON": "{\"sessionKey\":\"agent:main:bot_1770879717221\"}"
  }
}
```

### Unsubscription Request

```json
{
  "type": "req",
  "id": "req-456",
  "method": "node.event",
  "params": {
    "event": "chat.unsubscribe",
    "payloadJSON": "{\"sessionKey\":\"agent:main:bot_1770879717221\"}"
  }
}
```

### Server Handling

When `chat.subscribe` is received:
1. Parse `payloadJSON` to get `sessionKey`
2. Call `ctx.nodeSubscribe(nodeId, sessionKey)`
3. Store in `sessionSubscribers: Map<sessionKey, Set<nodeId>>`

---

## 6. Common Pitfalls

### Role Permission Issues

**Problem**: `node.event` returns `unauthorized role: operator`

**Solution**: Use `role: 'node'` in connect params to access `node.event` methods.

### Session Key Format Mismatches

**Problem**: Events not received after subscription.

**Causes**:
1. Using `bot_123` instead of `agent:main:bot_123`
2. Case sensitivity issues
3. Key normalization differences

**Solution**: Always use the canonical format `agent:{agentId}:{mainKey}`.

### Agent Not Processing Messages

**Problem**: `chat.send` succeeds but no events are received.

**Cause**: The agent/model is not connected or configured properly.

**Solution**:
1. Check moltbot config has valid agent configuration
2. Verify model API is accessible
3. Check moltbot logs for agent errors

---

## 7. WorkAny Integration Notes

### Connection Params

```typescript
const connectParams = {
  minProtocol: 3,
  maxProtocol: 3,
  client: {
    id: 'gateway-client',  // Must be this constant
    displayName: 'workany',
    version: '1.0.0',
    platform: platform(),
    mode: 'node',
    instanceId: randomUUID(),
  },
  auth: {
    token: config.authToken,
    password: config.password,
  },
  role: 'node',  // Required for node.event access
  commands: [],
};
```

### Session Key Handling

When creating a session key:
```typescript
// Frontend creates: bot_${Date.now()}
const frontendSessionKey = 'bot_1770879717221';

// Moltbot canonical form: agent:main:{sessionKey}
const canonicalSessionKey = `agent:main:${frontendSessionKey}`;
```

For subscription, use the SAME key that moltbot will use in events.

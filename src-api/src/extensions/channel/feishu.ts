/**
 * Feishu (飞书) Channel Adapter
 *
 * Supports two connection modes:
 *  - **websocket** (recommended): Uses @larksuiteoapi/node-sdk WSClient for
 *    long-lived WebSocket connection. No public URL needed.
 *  - **webhook** (legacy): Receives HTTP POST from Feishu Open Platform.
 *
 * Features:
 *  - Event parsing: im.message.receive_v1 (text messages)
 *  - Bot API message sending with tenant_access_token auto-refresh
 *  - Feishu interactive card formatting (Markdown)
 *  - Message deduplication (prevents retry-induced duplicates)
 *  - Heartbeat watchdog: detects stale connections and auto-reconnects
 *  - Message compensation: polls REST API to recover missed messages
 */

import { createHmac } from 'node:crypto';

import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  ConnectionMode,
  IncomingMessage,
  OutgoingMessage,
} from '@/core/channel/types';
import type { AgentMessage } from '@/core/agent/types';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

const ARTIFACT_BLOCK_RE = /```artifact:[\w-]+\s*\n[\s\S]*?```/g;

// Dedup: keep message IDs for 5 minutes
const DEDUP_TTL_MS = 5 * 60 * 1000;
const DEDUP_CLEANUP_INTERVAL_MS = 60 * 1000;

// Heartbeat watchdog: if no WS frame arrives within this window, force reconnect.
// Feishu server sends pong frames every ~90s, so 3 minutes is a safe threshold.
const HEARTBEAT_TIMEOUT_MS = 3 * 60 * 1000;
const HEARTBEAT_CHECK_INTERVAL_MS = 30 * 1000;

// Connection cooldown: wait this long after closing before reconnecting,
// so the Feishu server has time to release the old session.
const RECONNECT_COOLDOWN_MS = 3_000;

// Message compensation: poll interval for REST API fallback
const COMPENSATION_INTERVAL_MS = 5 * 1000;
// Only compensate messages from the last N seconds
const COMPENSATION_WINDOW_MS = 120 * 1000;
// Debounce immediate compensation triggers
const COMPENSATION_IMMEDIATE_DEBOUNCE_MS = 2_000;

interface FeishuConfig extends ChannelAdapterConfig {
  appId: string;
  appSecret: string;
  connectionMode?: ConnectionMode;
  verificationToken?: string;
  encryptKey?: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

export class FeishuAdapter implements ChannelAdapter {
  readonly id = 'feishu';
  readonly name = 'Feishu (飞书)';

  private config: FeishuConfig | null = null;
  private tokenCache: TokenCache | null = null;
  private connectionMode: ConnectionMode = 'websocket';

  // WebSocket mode
  private wsClient: unknown = null;
  private larkClient: unknown = null;
  private larkModule: typeof import('@larksuiteoapi/node-sdk') | null = null;
  private connected = false;

  // Heartbeat watchdog
  private lastFrameTime = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnecting = false;
  private onMessageCallback: ((msg: IncomingMessage) => Promise<void>) | null = null;

  // Message compensation
  private compensationTimer: ReturnType<typeof setInterval> | null = null;
  /** chat_id → timestamp of last compensated message (ms) */
  private compensationCursors = new Map<string, number>();
  private lastImmediateCompensationTs = 0;
  private immediateCompensationTimer: ReturnType<typeof setTimeout> | null = null;

  // Diagnostic: last send errors for debugging via /channels/feishu/last-errors
  private _lastErrors: { time: string; step: string; error: string }[] = [];

  get lastErrors() { return this._lastErrors; }

  private logSendError(step: string, err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Feishu] ${step}:`, msg);
    this._lastErrors.push({
      time: new Date().toISOString(),
      step,
      error: msg,
    });
    if (this._lastErrors.length > 10) this._lastErrors.shift();
  }

  // Message deduplication
  private processedMessages = new Map<string, number>();
  private dedupTimer: ReturnType<typeof setInterval> | null = null;

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async initialize(config: ChannelAdapterConfig): Promise<void> {
    this.config = config as FeishuConfig;
    this.connectionMode = this.config.connectionMode || 'websocket';

    // Start dedup cleanup timer
    this.dedupTimer = setInterval(() => this.cleanupDedup(), DEDUP_CLEANUP_INTERVAL_MS);

    console.log('[Feishu] Adapter initialized', {
      mode: this.connectionMode,
      hasAppId: !!this.config.appId,
      hasAppSecret: !!this.config.appSecret,
    });
  }

  async shutdown(): Promise<void> {
    if (this.dedupTimer) {
      clearInterval(this.dedupTimer);
      this.dedupTimer = null;
    }
    this.stopHeartbeatWatchdog();
    this.stopCompensation();
    await this.disconnect();
    this.config = null;
    this.tokenCache = null;
    this.processedMessages.clear();
    this.onMessageCallback = null;
    console.log('[Feishu] Adapter shut down');
  }

  // ─── WebSocket Mode ─────────────────────────────────────────────────

  async connect(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
    if (!this.config?.appId || !this.config?.appSecret) {
      throw new Error('[Feishu] appId / appSecret not configured');
    }

    this.onMessageCallback = onMessage;

    // Close any existing connection first to prevent duplicate WS sessions.
    // The Feishu server distributes messages across all active connections
    // for the same app — zombie connections cause message loss.
    if (this.wsClient) {
      console.log('[Feishu] Closing previous connection before reconnecting');
      await this.disconnect();
      // Wait for the server to release the old session
      console.log(`[Feishu] Waiting ${RECONNECT_COOLDOWN_MS}ms for server-side session release...`);
      await new Promise((r) => setTimeout(r, RECONNECT_COOLDOWN_MS));
    }

    const lark = await import('@larksuiteoapi/node-sdk');
    this.larkModule = lark;

    const baseConfig = {
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: lark.Domain.Feishu,
    };

    this.larkClient = new lark.Client(baseConfig);

    // Create EventDispatcher
    // CRITICAL: handler must return immediately — do NOT await long-running work.
    // The SDK's WSClient awaits the handler return value (via `yield dispatcher.invoke(data)`).
    // If the handler returns a Promise (even implicitly), the SDK blocks subsequent events.
    // We use setImmediate() to fully detach onMessage from the SDK's event loop.
    const eventDispatcher = new lark.EventDispatcher({
      encryptKey: this.config.encryptKey || '',
    }).register({
      'im.message.receive_v1': (data: unknown) => {
        try {
          const rawMsg = (data as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
          const rawMsgId = rawMsg?.message_id as string | undefined;

          const incoming = this.parseLarkEvent(data);

          if (incoming) {
            // Detach from SDK event loop — setImmediate ensures the handler
            // returns synchronously (undefined), so the SDK can immediately
            // process the next queued event without waiting.
            setImmediate(() => {

              onMessage(incoming).catch(err => {
                console.error('[Feishu] Background message handler error:', err);
              });
            });

            // Track this chat for message compensation
            this.compensationCursors.set(incoming.conversationId, Date.now());

            // Trigger immediate compensation check to catch messages
            // the SDK may have dropped around the same time
            this.scheduleImmediateCompensation(onMessage);
          }
        } catch (err) {
          console.error('[Feishu] Error parsing WS event:', err);
        }
      },
    });

    const wsClient = new lark.WSClient({
      ...baseConfig,
      loggerLevel: lark.LoggerLevel.info,
    });

    await wsClient.start({ eventDispatcher });

    // Attach heartbeat watchdog: monitor raw WS frames to detect stale connections.
    // SDK's start() calls reConnect() which connects asynchronously, so we poll.
    this.attachHeartbeatMonitor(wsClient);

    this.wsClient = wsClient;
    this.connected = true;
    console.log('[Feishu] WebSocket connected');

    // Start heartbeat watchdog timer
    this.startHeartbeatWatchdog();

    // Start message compensation polling
    this.startCompensation(onMessage);
  }

  /**
   * Attach a raw frame listener to the SDK's internal WebSocket instance.
   * Updates `lastFrameTime` on every frame so the heartbeat watchdog can
   * detect stale connections.
   */
  private attachHeartbeatMonitor(wsClient: unknown): void {
    const tryAttach = (): boolean => {
      try {
        const wsConfig = (wsClient as Record<string, unknown>).wsConfig as {
          getWSInstance: () => {
            on: (event: string, cb: (...args: unknown[]) => void) => void;
            prependListener?: (event: string, cb: (...args: unknown[]) => void) => void;
          } | null;
        };
        const wsInstance = wsConfig?.getWSInstance?.();
        if (!wsInstance) return false;

        const prependFn = (wsInstance as unknown as Record<string, (...args: unknown[]) => void>).prependListener
          || (wsInstance as unknown as Record<string, (...args: unknown[]) => void>).on;
        prependFn.call(wsInstance, 'message', () => {
          this.lastFrameTime = Date.now();
        });
        this.lastFrameTime = Date.now();
        console.log('[Feishu] Heartbeat monitor attached to WebSocket');
        return true;
      } catch (err) {
        console.error('[Feishu] Failed to attach heartbeat monitor:', err);
        return false;
      }
    };

    if (!tryAttach()) {
      let attempts = 0;
      const maxAttempts = 30; // 30 × 500ms = 15s
      const pollTimer = setInterval(() => {
        attempts++;
        if (tryAttach()) {
          clearInterval(pollTimer);
        } else if (attempts >= maxAttempts) {
          clearInterval(pollTimer);
          console.warn('[Feishu] WebSocket instance not available after 15s, heartbeat monitor not attached');
        }
      }, 500);
    }
  }

  /**
   * Heartbeat watchdog: periodically checks if we've received any WS frame
   * recently. If not, the connection is likely dead (zombie) and we force-reconnect.
   */
  private startHeartbeatWatchdog(): void {
    this.stopHeartbeatWatchdog();
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected || this.reconnecting) return;

      const elapsed = Date.now() - this.lastFrameTime;
      if (this.lastFrameTime > 0 && elapsed > HEARTBEAT_TIMEOUT_MS) {
        console.warn(`[Feishu] Heartbeat timeout: no WS frame for ${Math.round(elapsed / 1000)}s, forcing reconnect...`);
        this.forceReconnect();
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS);
  }

  private stopHeartbeatWatchdog(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Force-reconnect: tear down the current connection and establish a new one.
   * Serialized to prevent concurrent reconnect storms.
   */
  private async forceReconnect(): Promise<void> {
    if (this.reconnecting || !this.onMessageCallback) return;
    this.reconnecting = true;

    try {
      console.log('[Feishu] Force reconnecting...');
      await this.connect(this.onMessageCallback);
    } catch (err) {
      console.error('[Feishu] Force reconnect failed:', err);
    } finally {
      this.reconnecting = false;
    }
  }

  // ─── Message Compensation ────────────────────────────────────────────

  /**
   * Periodically poll the Feishu REST API for recent messages in active chats.
   * If we find messages that weren't received via WebSocket (not in dedup set),
   * inject them into the message handler as if they came from WS.
   *
   * This compensates for messages lost due to zombie connections or server-side
   * load balancing across multiple WS sessions.
   */
  private startCompensation(onMessage: (msg: IncomingMessage) => Promise<void>): void {
    this.stopCompensation();
    this.compensationTimer = setInterval(async () => {
      if (!this.connected || !this.config) {
        return;
      }

      const chatIds = Array.from(this.compensationCursors.keys());

      if (chatIds.length === 0) return;

      for (const [chatId, lastTs] of this.compensationCursors) {
        // Only compensate recent chats
        if (Date.now() - lastTs > COMPENSATION_WINDOW_MS) {
          this.compensationCursors.delete(chatId);
          continue;
        }

        try {
          const recovered = await this.pollMissedMessages(chatId);
          for (const msg of recovered) {
            console.log(`[Feishu] Compensation: recovered message ${msg.replyToMessageId} in ${chatId}`);
            onMessage(msg).catch(err => {
              console.error('[Feishu] Compensation handler error:', err);
            });
          }
        } catch (err) {
        }
      }
    }, COMPENSATION_INTERVAL_MS);
  }

  private stopCompensation(): void {
    if (this.compensationTimer) {
      clearInterval(this.compensationTimer);
      this.compensationTimer = null;
    }
    if (this.immediateCompensationTimer) {
      clearTimeout(this.immediateCompensationTimer);
      this.immediateCompensationTimer = null;
    }
  }

  /**
   * Schedule an immediate compensation check after a short debounce.
   * When WS delivers a message, nearby messages may have been dropped.
   * A quick poll 2s later catches them much faster than the 5s interval.
   */
  private scheduleImmediateCompensation(onMessage: (msg: IncomingMessage) => Promise<void>): void {
    const now = Date.now();
    if (now - this.lastImmediateCompensationTs < COMPENSATION_IMMEDIATE_DEBOUNCE_MS) return;

    if (this.immediateCompensationTimer) clearTimeout(this.immediateCompensationTimer);

    this.immediateCompensationTimer = setTimeout(async () => {
      this.immediateCompensationTimer = null;
      this.lastImmediateCompensationTs = Date.now();

      if (!this.connected || !this.config) return;

      for (const [chatId, lastTs] of this.compensationCursors) {
        if (Date.now() - lastTs > COMPENSATION_WINDOW_MS) continue;
        try {
          const recovered = await this.pollMissedMessages(chatId);
          for (const msg of recovered) {
            onMessage(msg).catch(err => {
              console.error('[Feishu] Immediate compensation handler error:', err);
            });
          }
        } catch (err) {
        }
      }
    }, COMPENSATION_IMMEDIATE_DEBOUNCE_MS);
  }

  /**
   * Poll Feishu REST API for recent messages in a chat.
   * Returns only messages that we haven't already processed (not in dedup set).
   */
  private async pollMissedMessages(chatId: string): Promise<IncomingMessage[]> {
    const token = await this.getTenantAccessToken();

    // Fetch the last 10 messages in this chat
    // user_id_type=open_id ensures sender_id contains open_id for user identification
    const url = `${FEISHU_API_BASE}/im/v1/messages?container_id_type=chat&container_id=${chatId}&page_size=10&sort_type=ByCreateTimeDesc&user_id_type=open_id`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return [];
    }

    const result = (await res.json()) as {
      code: number;
      msg?: string;
      data?: {
        items?: Array<{
          message_id: string;
          msg_type: string;
          sender: {
            sender_type: string;
            // REST API may return sender_id as a nested object or as a direct string
            sender_id?: { open_id?: string; user_id?: string; union_id?: string } | string;
            id?: string; // some API versions use flat 'id'
          };
          body: { content: string };
          create_time: string;
          chat_id: string;
        }>;
      };
    };

    if (result.code !== 0 || !result.data?.items) {
      return [];
    }

    const recovered: IncomingMessage[] = [];
    const now = Date.now();

    for (const item of result.data.items) {
      try {
        // Skip bot messages and already-processed messages
        // Support text, post, image, file, audio, video, sticker
        const supportedTypes = new Set(['text', 'post', 'image', 'file', 'audio', 'video', 'media', 'sticker']);
        if (!supportedTypes.has(item.msg_type)) continue;
        if (item.sender?.sender_type === 'app') continue;

        const alreadyProcessed = this.processedMessages.has(item.message_id);
        if (alreadyProcessed) continue;

        // Feishu create_time is in milliseconds (13-digit string).
        // Guard against seconds (10-digit) by checking length.
        let createTime = parseInt(item.create_time, 10);
        if (item.create_time.length <= 10) {
          createTime *= 1000; // Convert seconds to milliseconds
        }
        const msgAge = now - createTime;

        if (msgAge > COMPENSATION_WINDOW_MS || msgAge < 0) continue;

        // Parse content based on message type
        let content = '';
        try {
          const parsed = JSON.parse(item.body.content);
          switch (item.msg_type) {
            case 'text': content = parsed.text || ''; break;
            case 'post': content = this.parsePostContent(parsed); break;
            case 'image': content = '[Image]'; break;
            case 'file': content = `[File: ${parsed.file_name || 'unknown'}]`; break;
            case 'audio': content = '[Audio]'; break;
            case 'video': case 'media': content = '[Video]'; break;
            case 'sticker': content = '[Sticker]'; break;
            default: content = parsed.text || '';
          }
        } catch {
          content = item.body?.content || '';
        }
        content = content.replace(/@_all\s*/g, '').replace(/@_user_\d+\s*/g, '').trim();
        if (!content) continue;

        // Extract sender ID safely — REST API sender structure varies:
        // - WS events: sender.sender_id.open_id (nested object)
        // - REST API: sender.sender_id may be a string or nested object
        const rawSenderId = item.sender?.sender_id;
        let senderId: string;
        if (typeof rawSenderId === 'string') {
          senderId = rawSenderId;
        } else if (rawSenderId && typeof rawSenderId === 'object') {
          senderId = rawSenderId.open_id || rawSenderId.user_id || rawSenderId.union_id || '';
        } else {
          senderId = item.sender?.id || '';
        }
        if (!senderId) senderId = 'unknown';

        // Mark as processed to prevent future re-compensation
        this.processedMessages.set(item.message_id, Date.now());

        recovered.push({
          senderId,
          content,
          conversationId: chatId,
          replyToMessageId: item.message_id,
          raw: item,
        });
      } catch (itemErr) {
        // Continue processing remaining items — don't let one bad item kill the loop
      }
    }

    return recovered;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.stopHeartbeatWatchdog();
    this.stopCompensation();

    // Properly close WSClient to release the server-side connection.
    // Without this, the Feishu server keeps zombie connections alive and
    // distributes incoming messages across them, causing message loss.
    if (this.wsClient && this.larkModule) {
      try {
        const ws = this.wsClient as InstanceType<typeof this.larkModule.WSClient>;
        ws.close({ force: true });
        console.log('[Feishu] WSClient closed (force)');
      } catch (err) {
        console.error('[Feishu] Error closing WSClient:', err);
      }
    }

    this.wsClient = null;
    this.larkClient = null;
    this.larkModule = null;
    this.lastFrameTime = 0;
    console.log('[Feishu] WebSocket disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Parse a Lark SDK event object into IncomingMessage.
   * The SDK already handles decryption and verification.
   */
  private parseLarkEvent(data: unknown): IncomingMessage | null {
    const event = data as Record<string, unknown>;
    const sender = event.sender as Record<string, unknown> | undefined;
    const message = event.message as Record<string, unknown> | undefined;

    if (!message) return null;

    // Skip bot's own messages
    const senderType = sender?.sender_type as string;
    if (senderType === 'app') {
      return null;
    }

    // Dedup check
    const messageId = message.message_id as string;
    if (messageId && this.isDuplicate(messageId)) {
      console.log('[Feishu] Duplicate message skipped:', messageId);
      return null;
    }

    // Parse message content based on type
    const msgType = message.message_type as string;
    let content = '';

    switch (msgType) {
      case 'text': {
        try {
          const parsed = JSON.parse(message.content as string);
          content = parsed.text || '';
        } catch {
          content = (message.content as string) || '';
        }
        break;
      }

      case 'post': {
        // Rich text (post) — extract text from nested structure
        try {
          const parsed = JSON.parse(message.content as string);
          content = this.parsePostContent(parsed);
        } catch {
          content = '[Rich Text Message]';
        }
        break;
      }

      case 'image':
        content = '[Image]';
        break;

      case 'file': {
        try {
          const parsed = JSON.parse(message.content as string);
          content = `[File: ${parsed.file_name || 'unknown'}]`;
        } catch {
          content = '[File]';
        }
        break;
      }

      case 'audio':
        content = '[Audio]';
        break;

      case 'video':
      case 'media':
        content = '[Video]';
        break;

      case 'sticker':
        content = '[Sticker]';
        break;

      case 'merge_forward':
        content = '[Merged and Forwarded Message]';
        break;

      default:
        console.log('[Feishu] Unsupported message type:', msgType);
        return null;
    }

    // Strip @mentions
    content = content.replace(/@_all\s*/g, '').replace(/@_user_\d+\s*/g, '').trim();
    if (!content) return null;

    const senderId = (sender?.sender_id as Record<string, string>)?.open_id || '';
    const chatId = message.chat_id as string;

    return {
      senderId,
      content,
      conversationId: chatId,
      replyToMessageId: messageId,
      raw: data,
    };
  }

  /**
   * Parse Feishu post (rich text) content into plain text.
   * Post format: { "zh_cn": { "title": "...", "content": [[{"tag":"text","text":"..."}, ...]] } }
   */
  private parsePostContent(parsed: Record<string, unknown>): string {
    const parts: string[] = [];
    // Post content can be under locale keys (zh_cn, en_us, etc.) or directly
    const locales = Object.values(parsed);
    for (const locale of locales) {
      if (!locale || typeof locale !== 'object') continue;
      const loc = locale as Record<string, unknown>;
      const title = loc.title as string;
      if (title) parts.push(title);
      const contentRows = loc.content as unknown[][];
      if (!Array.isArray(contentRows)) continue;
      for (const row of contentRows) {
        if (!Array.isArray(row)) continue;
        for (const element of row) {
          const el = element as Record<string, unknown>;
          if (el.tag === 'text' && el.text) parts.push(el.text as string);
          else if (el.tag === 'a' && el.text) parts.push(el.text as string);
          else if (el.tag === 'at' && el.user_name) parts.push(`@${el.user_name}`);
          else if (el.tag === 'img') parts.push('[Image]');
          else if (el.tag === 'media') parts.push('[Media]');
        }
      }
      if (parts.length > 0) break; // Use first locale with content
    }
    return parts.join(' ').trim() || '[Rich Text]';
  }

  // ─── Webhook Mode (legacy, kept for backward compatibility) ─────────

  async verifyWebhook(
    headers: Record<string, string>,
    body: string
  ): Promise<boolean> {
    if (!this.config?.encryptKey) return true;

    const timestamp = headers['x-lark-request-timestamp'] || '';
    const nonce = headers['x-lark-request-nonce'] || '';
    const signature = headers['x-lark-signature'] || '';

    if (!timestamp || !nonce || !signature) return true;

    const toSign = timestamp + nonce + this.config.encryptKey + body;
    const expected = createHmac('sha256', '')
      .update(toSign)
      .digest('hex');

    return expected === signature;
  }

  async parseIncoming(
    body: unknown,
    _headers: Record<string, string>
  ): Promise<IncomingMessage | null> {
    const payload = body as Record<string, unknown>;

    // URL verification challenge
    if (payload.type === 'url_verification') {
      console.log('[Feishu] Handling url_verification challenge');
      return {
        senderId: '',
        content: '',
        conversationId: '',
        raw: body,
        directResponse: { challenge: payload.challenge },
      };
    }

    // V2 event schema
    if (payload.schema === '2.0') {
      return this.parseV2Event(payload);
    }

    // V1 event schema
    if (payload.event) {
      return this.parseV1Event(payload);
    }

    console.log('[Feishu] Unrecognized event schema:', Object.keys(payload));
    return null;
  }

  private parseV2Event(payload: Record<string, unknown>): IncomingMessage | null {
    const header = payload.header as Record<string, unknown> | undefined;
    const event = payload.event as Record<string, unknown> | undefined;

    if (!header || !event) return null;

    const eventType = header.event_type as string;

    if (this.config?.verificationToken && header.token !== this.config.verificationToken) {
      console.warn('[Feishu] Verification token mismatch');
      return null;
    }

    if (eventType !== 'im.message.receive_v1') {
      console.log('[Feishu] Skipping event type:', eventType);
      return null;
    }

    const sender = event.sender as Record<string, unknown> | undefined;
    const message = event.message as Record<string, unknown> | undefined;

    if (!message) return null;

    const senderId = (sender?.sender_id as Record<string, string>)?.open_id || '';
    const senderType = sender?.sender_type as string;

    if (senderType === 'app') {
      console.log('[Feishu] Ignoring bot message');
      return null;
    }

    // Dedup check
    const messageId = message.message_id as string;
    if (messageId && this.isDuplicate(messageId)) {
      console.log('[Feishu] Duplicate message skipped:', messageId);
      return null;
    }

    const msgType = message.message_type as string;
    if (msgType !== 'text') {
      console.log('[Feishu] Unsupported message type:', msgType);
      return null;
    }

    let content = '';
    try {
      const parsed = JSON.parse(message.content as string);
      content = parsed.text || '';
    } catch {
      content = (message.content as string) || '';
    }

    content = content.replace(/@_all\s*/g, '').replace(/@_user_\d+\s*/g, '').trim();

    if (!content) return null;

    return {
      senderId,
      content,
      conversationId: message.chat_id as string,
      replyToMessageId: message.message_id as string,
      raw: payload,
    };
  }

  private parseV1Event(payload: Record<string, unknown>): IncomingMessage | null {
    if (this.config?.verificationToken && payload.token !== this.config.verificationToken) {
      console.warn('[Feishu] Verification token mismatch (v1)');
      return null;
    }

    const event = payload.event as Record<string, unknown>;
    if (!event) return null;

    const msgType = event.msg_type as string;
    if (msgType !== 'text') {
      console.log('[Feishu] Unsupported v1 message type:', msgType);
      return null;
    }

    const content = ((event.text_without_at_bot || event.text) as string || '').trim();
    if (!content) return null;

    return {
      senderId: event.open_id as string,
      content,
      conversationId: event.open_chat_id as string,
      replyToMessageId: event.open_message_id as string,
      raw: payload,
    };
  }

  // ─── Response Formatting & Sending ──────────────────────────────────

  async formatResponse(
    agentMessages: AgentMessage[],
    conversationId: string
  ): Promise<OutgoingMessage> {
    // Collect text from content-bearing message types
    // 'result' is SDK metadata (subtype like "end_turn"/"error"), not user-facing content
    const CONTENT_TYPES = new Set(['text', 'direct_answer']);
    const textParts = agentMessages
      .filter((m): m is AgentMessage & { content: string } =>
        CONTENT_TYPES.has(m.type) && !!m.content
      )
      .map((m) => m.content);

    // If no content messages, check for error messages
    if (textParts.length === 0) {
      const errorMsgs = agentMessages.filter((m) => m.type === 'error' && (m as any).message);
      const resultErrorMsgs = agentMessages.filter((m) => m.type === 'result' && (m as any).content === 'error');

      if (errorMsgs.length > 0) {
        const errMsg = (errorMsgs[0] as any).message as string;
        if (errMsg.includes('__API_KEY_ERROR__')) {
          textParts.push('⚠️ AI 模型未配置或 API Key 无效，请在设置中检查模型配置。');
        } else if (errMsg.includes('__CUSTOM_API_ERROR__')) {
          textParts.push('⚠️ 自定义 API 连接失败，请检查 API 地址和模型配置。');
        } else {
          textParts.push('⚠️ 处理消息时出现错误，请稍后重试。');
        }
      } else if (resultErrorMsgs.length > 0) {
        textParts.push('⚠️ AI 模型调用失败，可能是 API 格式不兼容，请在设置中检查模型的 API 类型配置。');
      }
    }

    let text = textParts.join('\n\n') || '⚠️ 未能生成回复，请稍后重试。';
    text = text.replace(ARTIFACT_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trim();

    // After stripping artifacts, if text becomes empty, provide fallback
    if (!text) {
      text = '处理完成。';
    }

    // No truncation here — chunking is handled in send()
    // Keep full text for streaming card and multi-chunk delivery

    console.log(`[Feishu] formatResponse: ${agentMessages.length} messages → ${text.length} chars`);

    return {
      conversationId,
      content: text,
    };
  }

  /**
   * Chunk text into segments for multi-message delivery.
   * Splits on paragraph boundaries (double newline) when possible,
   * falls back to hard split at maxLen.
   */
  private chunkText(text: string, maxLen = 3800): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      // Try to split at paragraph boundary
      let splitAt = remaining.lastIndexOf('\n\n', maxLen);
      if (splitAt < maxLen * 0.3) {
        // No good paragraph break — try single newline
        splitAt = remaining.lastIndexOf('\n', maxLen);
      }
      if (splitAt < maxLen * 0.3) {
        // No good newline — hard split
        splitAt = maxLen;
      }

      chunks.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
  }

  async send(message: OutgoingMessage): Promise<void> {
    if (!this.config) throw new Error('[Feishu] Adapter not initialized');

    this._sendTrace = [];
    const st = (step: string, status: 'ok' | 'fail', detail?: string) => {
      this._sendTrace.push({ step, status, detail, ts: Date.now() });
      console.log(`[Feishu:Send] ${status === 'ok' ? '✅' : '❌'} ${step}: ${detail || status}`);
    };

    // Chunk long messages
    const chunks = this.chunkText(message.content);
    if (chunks.length > 1) {
      console.log(`[Feishu] Splitting message into ${chunks.length} chunks`);
    }

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const chunkLabel = chunks.length > 1 ? ` [${ci + 1}/${chunks.length}]` : '';
      let sent = false;

      for (let attempt = 1; attempt <= 2 && !sent; attempt++) {
        // Strategy 1: Schema 2.0 Markdown card
        const cardOk = await this.sendViaSDKCard(message.conversationId, chunk);
        if (cardOk) { st(`card${chunkLabel} (attempt ${attempt})`, 'ok'); sent = true; break; }
        st(`card${chunkLabel} (attempt ${attempt})`, 'fail', this._lastErrors.at(-1)?.error || 'unknown');

        // Strategy 2: SDK plain text
        const textOk = await this.sendViaSDKText(message.conversationId, chunk);
        if (textOk) { st(`text${chunkLabel} (attempt ${attempt})`, 'ok'); sent = true; break; }
        st(`text${chunkLabel} (attempt ${attempt})`, 'fail', this._lastErrors.at(-1)?.error || 'unknown');

        // Strategy 3: REST plain text
        try {
          await this.sendViaREST(message.conversationId, chunk);
          st(`REST${chunkLabel} (attempt ${attempt})`, 'ok');
          sent = true; break;
        } catch (err) {
          st(`REST${chunkLabel} (attempt ${attempt})`, 'fail', (err as Error).message);
          this.logSendError(`REST attempt ${attempt}`, err);
        }

        if (attempt < 2) {
          this.tokenCache = null;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (!sent) throw new Error(`[Feishu] Send failed for chunk ${ci + 1}/${chunks.length}`);

      // Small delay between chunks to maintain order
      if (ci < chunks.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
  }

  private _sendTrace: { step: string; status: string; detail?: string; ts: number }[] = [];
  get sendTrace() { return this._sendTrace; }

  // ─── Schema 2.0 Card Helpers ────────────────────────────────────────

  /**
   * Build a Schema 2.0 Markdown card JSON.
   * This renders markdown properly in Feishu (code blocks, tables, bold/italic, etc.)
   */
  private buildMarkdownCard(text: string, streaming = false): string {
    const card: Record<string, unknown> = {
      schema: '2.0',
      config: {
        width_mode: 'fill',
        ...(streaming ? { streaming_mode: true } : {}),
      },
      body: {
        elements: [{ tag: 'markdown', content: text || ' ' }],
      },
    };
    return JSON.stringify(card);
  }

  /**
   * Strategy 1: Schema 2.0 Markdown card via REST API.
   * Renders markdown properly (code blocks, tables, links, etc.)
   */
  private async sendViaSDKCard(chatId: string, text: string): Promise<boolean> {
    try {
      const token = await this.getTenantAccessToken();
      const res = await fetch(
        `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: 'interactive',
            content: this.buildMarkdownCard(text),
          }),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        this.logSendError(`Schema2 card HTTP ${res.status}`, errText.slice(0, 300));
        return false;
      }

      const result = (await res.json()) as Record<string, unknown>;
      if (result.code !== 0) {
        this.logSendError(`Schema2 card code=${result.code}`, result.msg);
        return false;
      }

      console.log('[Feishu] Sent via Schema 2.0 card to', chatId);
      return true;
    } catch (err) {
      this.logSendError('Schema2 card exception', err);
      return false;
    }
  }

  // ─── Streaming Card API ─────────────────────────────────────────────

  /**
   * Create a streaming card. Returns the message_id for subsequent updates.
   */
  async sendStreamingCard(chatId: string, initialText: string): Promise<string | null> {
    try {
      const token = await this.getTenantAccessToken();
      const res = await fetch(
        `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: 'interactive',
            content: this.buildMarkdownCard(initialText || '思考中...', true),
          }),
        },
      );

      if (!res.ok) {
        this.logSendError('Streaming card create HTTP', `${res.status}`);
        return null;
      }

      const result = (await res.json()) as {
        code: number;
        msg?: string;
        data?: { message_id?: string };
      };

      if (result.code !== 0 || !result.data?.message_id) {
        this.logSendError('Streaming card create', result.msg || `code=${result.code}`);
        return null;
      }

      console.log('[Feishu] Streaming card created:', result.data.message_id);
      return result.data.message_id;
    } catch (err) {
      this.logSendError('Streaming card create exception', err);
      return null;
    }
  }

  /**
   * Update a streaming card's content via PATCH.
   */
  async updateStreamingCard(messageId: string, text: string): Promise<boolean> {
    try {
      const token = await this.getTenantAccessToken();
      const res = await fetch(
        `${FEISHU_API_BASE}/im/v1/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            msg_type: 'interactive',
            content: this.buildMarkdownCard(text, true),
          }),
        },
      );

      if (!res.ok) return false;

      const result = (await res.json()) as { code: number };
      return result.code === 0;
    } catch {
      return false;
    }
  }

  /**
   * Close a streaming card — set streaming_mode to false with final content.
   */
  async closeStreamingCard(messageId: string, finalText: string): Promise<boolean> {
    try {
      const token = await this.getTenantAccessToken();
      const res = await fetch(
        `${FEISHU_API_BASE}/im/v1/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            msg_type: 'interactive',
            content: this.buildMarkdownCard(finalText, false),
          }),
        },
      );

      if (!res.ok) return false;

      const result = (await res.json()) as { code: number };
      if (result.code === 0) {
        console.log('[Feishu] Streaming card closed:', messageId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Strategy 2: SDK plain text message — simplest format, most reliable.
   */
  private async sendViaSDKText(chatId: string, text: string): Promise<boolean> {
    if (!this.larkClient || !this.larkModule) return false;

    try {
      const lark = this.larkModule;
      const client = this.larkClient as InstanceType<typeof lark.Client>;

      const res = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: JSON.stringify({ text }),
          msg_type: 'text',
        },
      });

      if (res && typeof res.code === 'number' && res.code !== 0) {
        this.logSendError(`SDK text code=${res.code}`, res.msg);
        return false;
      }

      console.log('[Feishu] Sent via SDK text to', chatId);
      return true;
    } catch (err) {
      this.logSendError('SDK text exception', err);
      return false;
    }
  }

  /**
   * Strategy 3: REST plain text — bypass SDK entirely, use fetch + tenant token.
   */
  private async sendViaREST(chatId: string, text: string): Promise<void> {
    const token = await this.getTenantAccessToken();

    const res = await fetch(
      `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      this.logSendError(`REST HTTP ${res.status}`, errText.slice(0, 500));
      throw new Error(`Feishu API error: ${res.status} - ${errText.slice(0, 200)}`);
    }

    const result = (await res.json()) as Record<string, unknown>;
    if (result.code !== 0) {
      this.logSendError(`REST API code=${result.code}`, result.msg);
      throw new Error(`Feishu API code: ${result.code} msg: ${result.msg}`);
    }

    console.log('[Feishu] Sent via REST text to', chatId);
  }

  // ─── Internal Helpers ───────────────────────────────────────────────

  private async getTenantAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }

    if (!this.config?.appId || !this.config?.appSecret) {
      throw new Error('[Feishu] appId / appSecret not configured');
    }

    const res = await fetch(
      `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      }
    );

    if (!res.ok) {
      throw new Error(`[Feishu] Token request failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      code: number;
      tenant_access_token: string;
      expire: number;
    };

    if (data.code !== 0) {
      throw new Error(`[Feishu] Token API error code: ${data.code}`);
    }

    this.tokenCache = {
      token: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire - 300) * 1000,
    };

    console.log('[Feishu] Tenant access token refreshed');
    return this.tokenCache.token;
  }

  // ─── Deduplication ──────────────────────────────────────────────────

  private isDuplicate(messageId: string): boolean {
    if (this.processedMessages.has(messageId)) {
      return true;
    }
    this.processedMessages.set(messageId, Date.now());
    return false;
  }

  private cleanupDedup(): void {
    const now = Date.now();
    for (const [id, ts] of this.processedMessages) {
      if (now - ts > DEDUP_TTL_MS) {
        this.processedMessages.delete(id);
      }
    }
  }
}

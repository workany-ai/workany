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

// Heartbeat watchdog: if no WS frame arrive within this window, force reconnect.
// Feishu server sends pong frames every ~90s, so 3 minutes is a safe threshold.
const HEARTBEAT_TIMEOUT_MS = 3 * 60 * 1000;
const HEARTBEAT_CHECK_INTERVAL_MS = 30 * 1000;

// Connection cooldown: wait this long after closing before reconnecting.
const RECONNECT_COOLDOWN_MS = 3_000;

// Message compensation: poll interval for REST API fallback
const COMPENSATION_INTERVAL_MS = 5 * 1000;
const COMPENSATION_WINDOW_MS = 120 * 1000;
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
  private compensationCursors = new Map<string, number>();
  private lastImmediateCompensationTs = 0;
  private immediateCompensationTimer: ReturnType<typeof setTimeout> | null = null;

  // Diagnostic: last send errors
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

    if (this.wsClient) {
      console.log('[Feishu] Closing previous connection before reconnecting');
      await this.disconnect();
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

    const eventDispatcher = new lark.EventDispatcher({
      encryptKey: this.config.encryptKey || '',
    }).register({
      'im.message.receive_v1': (data: unknown) => {
        try {
          const rawMsg = (data as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
          const rawMsgId = rawMsg?.message_id as string | undefined;

          console.log(`[Feishu] WS event received: messageId=${rawMsgId}`);
          const incoming = this.parseLarkEvent(data);

          if (incoming) {
            // Detach from SDK event loop so the SDK can process the next event immediately
            setImmediate(() => {
              console.log(`[Feishu] Dispatching message: content="${incoming.content.slice(0, 60)}", conversationId=${incoming.conversationId}`);
              onMessage(incoming).catch(err => {
                console.error('[Feishu] Background message handler error:', err);
              });
            });

            this.compensationCursors.set(incoming.conversationId, Date.now());
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
    this.attachHeartbeatMonitor(wsClient);
    this.wsClient = wsClient;
    this.connected = true;
    console.log('[Feishu] WebSocket connected');

    this.startHeartbeatWatchdog();
    this.startCompensation(onMessage);
  }

  private attachHeartbeatMonitor(wsClient: unknown): void {
    const tryAttach = (): boolean => {
      try {
        const wsConfig = (wsClient as Record<string, unknown>).wsConfig as {
          getWSInstance: () => {
            on: (event: string, cb: (...args: unknown[]) => void) => void;
            prependListener?: (event: string, cb: (...args: unknown[]) => void) => void;
          } | null;
        } | undefined;
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
      const maxAttempts = 30;
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

  private async forceReconnect(): Promise<void> {
    if (this.reconnecting || !this.onMessageCallback) return;
    this.reconnecting = true;

    try {
      console.log('[Feishu] Force reconnecting...');
      await this.connect(this.onMessageCallback);
      console.log('[Feishu] Force reconnect complete');
    } catch (err) {
      console.error('[Feishu] Force reconnect failed:', err);
    } finally {
      this.reconnecting = false;
    }
  }

  // ─── Message Compensation ────────────────────────────────────────────

  private startCompensation(onMessage: (msg: IncomingMessage) => Promise<void>): void {
    this.stopCompensation();
    console.log(`[Feishu] Starting message compensation, interval=${COMPENSATION_INTERVAL_MS}ms`);

    this.compensationTimer = setInterval(async () => {
      if (!this.connected || !this.config) return;

      const chatIds = Array.from(this.compensationCursors.keys());
      if (chatIds.length === 0) return;

      for (const [chatId, lastTs] of this.compensationCursors) {
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
          console.error(`[Feishu] Compensation poll failed for ${chatId}:`, err);
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
            console.log(`[Feishu] Immediate compensation: recovered message ${msg.replyToMessageId} in ${chatId}`);
            onMessage(msg).catch(err => {
              console.error('[Feishu] Immediate compensation handler error:', err);
            });
          }
        } catch (err) {
          console.error(`[Feishu] Immediate compensation failed for ${chatId}:`, err);
        }
      }
    }, COMPENSATION_IMMEDIATE_DEBOUNCE_MS);
  }

  private async pollMissedMessages(chatId: string): Promise<IncomingMessage[]> {
    const token = await this.getTenantAccessToken();

    const url = `${FEISHU_API_BASE}/im/v1/messages?container_id_type=chat&container_id=${chatId}&page_size=10&sort_type=ByCreateTimeDesc&user_id_type=open_id`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      console.warn(`[Feishu] REST API poll failed for ${chatId}: ${res.status}`);
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
            sender_id?: { open_id?: string; user_id?: string; union_id?: string } | string;
            id?: string;
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
        const supportedTypes = new Set(['text', 'post', 'image', 'file', 'audio', 'video', 'media', 'sticker']);
        if (!supportedTypes.has(item.msg_type)) continue;
        if (item.sender?.sender_type === 'app') continue;

        if (this.processedMessages.has(item.message_id)) continue;

        let createTime = parseInt(item.create_time, 10);
        if (item.create_time.length <= 10) createTime *= 1000;
        const msgAge = now - createTime;

        if (msgAge > COMPENSATION_WINDOW_MS || msgAge < 0) continue;

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

        const rawSenderId = item.sender?.sender_id;
        let senderId: string;
        if (typeof rawSenderId === 'string') {
          senderId = rawSenderId;
        } else if (rawSenderId && typeof rawSenderId === 'object') {
          senderId = (rawSenderId as Record<string, string>).open_id
            || (rawSenderId as Record<string, string>).user_id
            || (rawSenderId as Record<string, string>).union_id
            || '';
        } else {
          senderId = item.sender?.id || '';
        }
        if (!senderId) senderId = 'unknown';

        this.processedMessages.set(item.message_id, Date.now());

        recovered.push({
          senderId,
          content,
          conversationId: chatId,
          replyToMessageId: item.message_id,
          raw: item,
        });
      } catch (itemErr) {
        console.warn(`[Feishu] Failed to process compensation item ${item.message_id}:`, itemErr);
      }
    }

    return recovered;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.stopHeartbeatWatchdog();
    this.stopCompensation();

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

  // ─── Parse Lark Events ───────────────────────────────────────────────

  private parseLarkEvent(data: unknown): IncomingMessage | null {
    const event = data as Record<string, unknown>;
    const sender = event.sender as Record<string, unknown> | undefined;
    const message = event.message as Record<string, unknown> | undefined;

    if (!message) return null;

    const senderType = sender?.sender_type as string;
    if (senderType === 'app') return null;

    const messageId = message.message_id as string;
    if (messageId && this.isDuplicate(messageId)) {
      console.log('[Feishu] Duplicate message skipped:', messageId);
      return null;
    }

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
        try {
          const parsed = JSON.parse(message.content as string);
          content = this.parsePostContent(parsed);
        } catch {
          content = '[Rich Text Message]';
        }
        break;
      }
      case 'image': content = '[Image]'; break;
      case 'file': {
        try {
          const parsed = JSON.parse(message.content as string);
          content = `[File: ${parsed.file_name || 'unknown'}]`;
        } catch {
          content = '[File]';
        }
        break;
      }
      case 'audio': content = '[Audio]'; break;
      case 'video': case 'media': content = '[Video]'; break;
      case 'sticker': content = '[Sticker]'; break;
      case 'merge_forward': content = '[Merged and Forwarded Message]'; break;
      default:
        console.log('[Feishu] Unsupported message type:', msgType);
        return null;
    }

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

  private parsePostContent(parsed: Record<string, unknown>): string {
    const parts: string[] = [];
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
      if (parts.length > 0) break;
    }
    return parts.join(' ').trim() || '[Rich Text]';
  }

  // ─── Webhook Mode ───────────────────────────────────────────────────

  async verifyWebhook(headers: Record<string, string>, body: string): Promise<boolean> {
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

  async parseIncoming(body: unknown, _headers: Record<string, string>): Promise<IncomingMessage | null> {
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

    if (payload.schema === '2.0') return this.parseV2Event(payload);
    if (payload.event) return this.parseV1Event(payload);

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

  async formatResponse(agentMessages: AgentMessage[], conversationId: string): Promise<OutgoingMessage> {
    const CONTENT_TYPES = new Set(['text', 'direct_answer']);
    const textParts = agentMessages
      .filter((m): m is AgentMessage & { content: string } =>
        CONTENT_TYPES.has(m.type) && !!m.content
      )
      .map((m) => m.content);

    if (textParts.length === 0) {
      const errorMsgs = agentMessages.filter((m) => m.type === 'error' && (m as any).message);
      const resultErrorMsgs = agentMessages.filter((m) => m.type === 'result' && (m as any).content === 'error');

      if (errorMsgs.length > 0) {
        const errMsg = (errorMsgs[0] as any).message as string;
        if (errMsg.includes('__API_KEY_ERROR__')) {
          textParts.push('⚠️ AI model not configured or API Key invalid. Please check settings in the desktop app.');
        } else if (errMsg.includes('__CUSTOM_API_ERROR__')) {
          textParts.push('⚠️ Custom API connection failed. Please check the API address and model configuration.');
        } else {
          textParts.push('⚠️ An error occurred while processing your message. Please try again later.');
        }
      } else if (resultErrorMsgs.length > 0) {
        textParts.push('⚠️ AI model call failed. Please check the API type configuration in settings.');
      }
    }

    let text = textParts.join('\n\n') || '⚠️ No response generated. Please try again.';
    text = text.replace(ARTIFACT_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trim();

    if (!text) {
      text = 'Done.';
    }

    console.log(`[Feishu] formatResponse: ${agentMessages.length} messages → ${text.length} chars`);

    return { conversationId, content: text };
  }

  private chunkText(text: string, maxLen = 3800): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf('\n\n', maxLen);
      if (splitAt < maxLen * 0.3) {
        splitAt = remaining.lastIndexOf('\n', maxLen);
      }
      if (splitAt < maxLen * 0.3) {
        splitAt = maxLen;
      }

      chunks.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
  }

  // Internal send trace for debugging
  private _sendTrace: { step: string; status: string; detail?: string; ts: number }[] = [];

  async send(message: OutgoingMessage): Promise<void> {
    if (!this.config) throw new Error('[Feishu] Adapter not initialized');

    this._sendTrace = [];
    const st = (step: string, status: 'ok' | 'fail', detail?: string) => {
      this._sendTrace.push({ step, status, detail, ts: Date.now() });
      console.log(`[Feishu:Send] ${status === 'ok' ? '✅' : '❌'} ${step}: ${detail || status}`);
    };

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

        // Strategy 2: SDK plain text
        const textOk = await this.sendViaSDKText(message.conversationId, chunk);
        if (textOk) { st(`text${chunkLabel} (attempt ${attempt})`, 'ok'); sent = true; break; }
        st(`${chunkLabel} (attempt ${attempt})`, 'fail', this._lastErrors.at(-1)?.error || 'unknown');
      }

      if (!sent) {
        // Strategy 3: REST plain text as last resort
        try {
          await this.sendViaREST(message.conversationId, chunk);
          st(`REST${chunkLabel}`, 'ok');
        } catch (err) {
          st(`REST${chunkLabel}`, 'fail', err instanceof Error ? err.message : String(err));
          throw err;
        }
      }
    }
  }

  private async sendViaSDKCard(chatId: string, text: string): Promise<boolean> {
    if (!this.larkClient || !this.larkModule) return false;

    try {
      const lark = this.larkModule;
      const client = this.larkClient as InstanceType<typeof lark.Client>;

      const cardContent = JSON.stringify({
        schema: '2.0',
        config: { wide_screen_mode: true },
        elements: [{
          tag: 'markdown',
          content: text.slice(0, 4000),
        }],
      });

      const res = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: cardContent,
        },
      });

      if (res && typeof res.code === 'number' && res.code !== 0) {
        this.logSendError(`SDK card code=${res.code}`, res.msg);
        return false;
      }

      console.log('[Feishu] Sent card via SDK to', chatId);
      return true;
    } catch (err) {
      this.logSendError('SDK card exception', err);
      return false;
    }
  }

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

/**
 * Channel Manager
 *
 * Central registry for channel adapters.
 * Handles webhook dispatch, WebSocket lifecycle, and session management.
 */

import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  ChannelSession,
  IncomingMessage,
} from './types';
import { createSession, runAgent, type AgentMessage } from '@/shared/services/agent';
import { getProviderManager } from '@/shared/provider/manager';
import { getConfigLoader } from '@/config/loader';
import {
  appendOrCreateConversation,
  getAllChannelConversations,
  resetChannelSession,
} from '@/shared/services/channel-store';

// ─── Message Trace System ─────────────────────────────────────────────────────

export interface TraceNode {
  node: number;
  label: string;
  status: 'ok' | 'error' | 'skip';
  detail?: string;
  ts: number;
}

export interface MessageTrace {
  id: string;
  channel: string;
  prompt: string;
  startedAt: string;
  nodes: TraceNode[];
}

const MAX_TRACES = 20;
const traceStore: MessageTrace[] = [];

export function getMessageTraces(): MessageTrace[] {
  return traceStore;
}

function createTrace(channel: string, prompt: string): MessageTrace {
  const trace: MessageTrace = {
    id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    channel,
    prompt: prompt.slice(0, 100),
    startedAt: new Date().toISOString(),
    nodes: [],
  };
  traceStore.push(trace);
  if (traceStore.length > MAX_TRACES) traceStore.shift();
  return trace;
}

function traceNode(trace: MessageTrace, node: number, label: string, status: 'ok' | 'error' | 'skip', detail?: string) {
  const entry: TraceNode = { node, label, status, ts: Date.now(), detail };
  trace.nodes.push(entry);
  const icon = status === 'ok' ? '✅' : status === 'error' ? '❌' : '⏭️';
  console.log(`[Trace:${trace.id}] ${icon} Node ${node}: ${label} — ${detail || status}`);
}

// ─── Slash Commands ───────────────────────────────────────────────────────

interface SlashCommand {
  name: string;
  match: (text: string) => boolean;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'new',     match: (t) => /^\/(new|新对话)\s*$/i.test(t.trim()) },
  { name: 'reset',   match: (t) => /^\/(reset|重置)\s*$/i.test(t.trim()) },
  { name: 'help',    match: (t) => /^\/(help|帮助|命令)\s*$/i.test(t.trim()) },
];

export class ChannelManager {
  private adapters = new Map<string, ChannelAdapter>();
  private sessions = new Map<string, ChannelSession>();

  /**
   * Per-channel serial queue.
   * Ensures messages from the same channel are processed one at a time,
   * preventing concurrent appendOrCreateConversation calls from corrupting
   * the conversation state (message ordering, version counter, etc.).
   */
  private channelQueues = new Map<string, Promise<void>>();

  private enqueue(channelKey: string, fn: () => Promise<void>): void {
    const prev = this.channelQueues.get(channelKey) ?? Promise.resolve();
    const next = prev.then(fn, fn); // always chain, even if prev rejected
    this.channelQueues.set(channelKey, next);
    // Cleanup: when the chain settles and is still the latest, remove it
    next.then(() => {
      if (this.channelQueues.get(channelKey) === next) {
        this.channelQueues.delete(channelKey);
      }
    });
  }

  async register(
    adapter: ChannelAdapter,
    config: ChannelAdapterConfig
  ): Promise<void> {
    if (!config.enabled) {
      console.log(`[Channel] Adapter "${adapter.id}" is disabled, skipping`);
      return;
    }

    // If an adapter with the same ID is already registered, shut it down first
    const existing = this.adapters.get(adapter.id);
    if (existing) {
      console.log(`[Channel] Replacing existing adapter: ${adapter.id}`);
      try {
        if (existing.disconnect) await existing.disconnect();
        await existing.shutdown();
      } catch (err) {
        console.error(`[Channel] Error shutting down existing ${adapter.id}:`, err);
      }
      this.adapters.delete(adapter.id);
    }

    await adapter.initialize(config);
    this.adapters.set(adapter.id, adapter);
    console.log(`[Channel] Registered adapter: ${adapter.id} (${adapter.name})`);

    // If the adapter supports WebSocket mode, connect it
    const mode = config.connectionMode || 'webhook';
    if (mode === 'websocket' && adapter.connect) {
      console.log(`[Channel] Starting WebSocket connection for ${adapter.id}...`);
      await adapter.connect((msg) => this.handleIncomingMessage(adapter, msg));
      console.log(`[Channel] WebSocket connected for ${adapter.id}`);
    }
  }

  /**
   * Handle an incoming message from any adapter (WebSocket or Webhook).
   * Intercepts slash commands, then runs the agent for normal messages.
   *
   * Messages from the same channel are serialized via enqueue() to prevent
   * concurrent agent runs from corrupting conversation state.
   */
  async handleIncomingMessage(
    adapter: ChannelAdapter,
    incoming: IncomingMessage
  ): Promise<void> {
    const channelKey = `${adapter.id}:${incoming.conversationId}`;

    // ── T4: 消息入队 ──

    this.enqueue(channelKey, () => this._processMessage(adapter, incoming));
  }

  /**
   * Internal: process a single message (runs inside the per-channel serial queue).
   */
  private async _processMessage(
    adapter: ChannelAdapter,
    incoming: IncomingMessage
  ): Promise<void> {
    const trace = createTrace(adapter.id, incoming.content);

    // ── T5: _processMessage 开始执行 ──

    // ─── Node 1: Message received ────────────────────────────────────
    traceNode(trace, 1, '消息接收', 'ok', `from=${incoming.senderId}, content="${incoming.content.slice(0, 60)}"`);

    // ─── Node 2: Slash command check ─────────────────────────────────
    const command = SLASH_COMMANDS.find((c) => c.match(incoming.content));
    if (command) {
      traceNode(trace, 2, '斜杠命令拦截', 'ok', `command=/${command.name}`);
      await this.handleSlashCommand(adapter, incoming, command.name);
      return;
    }
    traceNode(trace, 2, '斜杠命令检查', 'skip', '非命令，继续常规流程');

    // ─── Node 3: Model config ────────────────────────────────────────
    const modelConfig = this.resolveModelConfig();
    if (!modelConfig?.apiKey) {
      traceNode(trace, 3, '模型配置加载', 'error', 'API Key 缺失');
      await this.sendTextReply(
        adapter, incoming,
        '⚠️ AI 模型未配置或 API Key 无效，请在桌面端设置中检查模型配置。',
      );
      return;
    }
    traceNode(trace, 3, '模型配置加载', 'ok', `model=${modelConfig.model || '(default)'}, baseUrl=${modelConfig.baseUrl || '(default)'}, apiType=${modelConfig.apiType || '(default)'}, apiKey=${modelConfig.apiKey.slice(0, 6)}...`);

    const channelSession = this.getOrCreateSession(adapter.id, incoming.conversationId);
    const agentSession = createSession('execute');
    const agentMessages: AgentMessage[] = [];

    // Streaming card state
    const supportsStreaming = !!(adapter.sendStreamingCard && adapter.updateStreamingCard && adapter.closeStreamingCard);
    let streamingMessageId: string | null = null;
    let streamingText = '';
    let lastUpdateTs = 0;
    let pendingUpdateTimer: ReturnType<typeof setTimeout> | null = null;
    const STREAM_MIN_DELAY_MS = 300;
    const STREAM_MAX_DELAY_MS = 1500;

    const flushStreamingUpdate = async () => {
      if (!streamingMessageId || !streamingText) return;
      const now = Date.now();
      if (now - lastUpdateTs < STREAM_MIN_DELAY_MS) return;
      lastUpdateTs = now;
      await adapter.updateStreamingCard!(streamingMessageId, streamingText);
    };

    const scheduleStreamingUpdate = () => {
      if (pendingUpdateTimer) return;
      const elapsed = Date.now() - lastUpdateTs;
      const delay = Math.max(STREAM_MIN_DELAY_MS - elapsed, 0);
      pendingUpdateTimer = setTimeout(async () => {
        pendingUpdateTimer = null;
        await flushStreamingUpdate();
      }, Math.min(delay, STREAM_MAX_DELAY_MS));
    };

    try {
      // ─── Node 4: Agent run (streaming) ─────────────────────────────
      traceNode(trace, 4, 'Agent 开始运行', 'ok', `sessionId=${agentSession.id}, historyLen=${channelSession.history.length}, streaming=${supportsStreaming}`);

      const CONTENT_TYPES = new Set(['text', 'direct_answer']);

      for await (const msg of runAgent(
        incoming.content,
        agentSession,
        channelSession.history,
        undefined,
        undefined,
        modelConfig,
      )) {
        agentMessages.push(msg);

        // ─── Streaming: update card on each text block ──────────────
        if (supportsStreaming && CONTENT_TYPES.has(msg.type) && (msg as any).content) {
          const textContent = (msg as any).content as string;
          streamingText += (streamingText ? '\n' : '') + textContent;

          if (!streamingMessageId) {
            // Create streaming card on first text
            streamingMessageId = await adapter.sendStreamingCard!(
              incoming.conversationId,
              streamingText,
            );
            if (streamingMessageId) {
              lastUpdateTs = Date.now();
              traceNode(trace, 41, '流式卡片创建', 'ok', `messageId=${streamingMessageId}`);
            }
          } else {
            // Schedule coalesced update
            scheduleStreamingUpdate();
          }
        }
      }

      // Clear any pending update timer
      if (pendingUpdateTimer) {
        clearTimeout(pendingUpdateTimer);
        pendingUpdateTimer = null;
      }

      // ─── Node 5: Agent results ──────────────────────────────────────
      const typeCounts: Record<string, number> = {};
      for (const m of agentMessages) {
        typeCounts[m.type] = (typeCounts[m.type] || 0) + 1;
      }

      const errorMsgs = agentMessages.filter(m => m.type === 'error');
      const hasError = errorMsgs.length > 0;
      const errorDetail = errorMsgs.map(m => (m as any).message || '').join('; ');

      traceNode(trace, 5, 'Agent 结果收集', hasError ? 'error' : 'ok',
        `total=${agentMessages.length}, types=${JSON.stringify(typeCounts)}${hasError ? `, errors=[${errorDetail}]` : ''}`
      );

      // ─── Node 6: Collect assistant text ─────────────────────────────
      const assistantText = agentMessages
        .filter((m): m is AgentMessage & { content: string } =>
          CONTENT_TYPES.has(m.type) && !!m.content
        )
        .map((m) => m.content)
        .join('\n');

      traceNode(trace, 6, '文本提取', assistantText ? 'ok' : 'error',
        `length=${assistantText.length}, preview="${assistantText.slice(0, 80)}"`
      );

      channelSession.history.push(
        { role: 'user', content: incoming.content },
        { role: 'assistant', content: assistantText },
      );

      const channelKey = `${adapter.id}:${incoming.conversationId}`;
      const storeResult = appendOrCreateConversation(channelKey, incoming.content, assistantText);

      const allConvs = getAllChannelConversations();
      traceNode(trace, 65, '对话存储', 'ok',
        `convId=${storeResult.id}, msgCount=${storeResult.messages.length}, version=${storeResult.version}, totalConvs=${allConvs.length}, channelKey=${channelKey}`
      );

      // ─── Node 7 & 8: Close streaming card or fallback send ─────────
      if (streamingMessageId) {
        // Close streaming card with final formatted content
        const response = await adapter.formatResponse(agentMessages, incoming.conversationId);
        const closed = await adapter.closeStreamingCard!(streamingMessageId, response.content);
        traceNode(trace, 8, '流式卡片关闭', closed ? 'ok' : 'error',
          `messageId=${streamingMessageId}, finalLen=${response.content.length}`);

        if (!closed) {
          // Fallback: send as new message if close failed
          response.replyToMessageId = incoming.replyToMessageId;
          await adapter.send(response);
        }
      } else {
        // No streaming card was created — send normally
        const response = await adapter.formatResponse(agentMessages, incoming.conversationId);
        response.replyToMessageId = incoming.replyToMessageId;
        traceNode(trace, 7, '格式化响应', 'ok', `length=${response.content.length}, preview="${response.content.slice(0, 80)}"`);

        try {
          await adapter.send(response);
          traceNode(trace, 8, '发送消息', 'ok', `conversationId=${response.conversationId}`);
        } catch (sendErr) {
          traceNode(trace, 8, '发送消息', 'error', sendErr instanceof Error ? sendErr.message : String(sendErr));
          throw sendErr;
        }
      }

    } catch (error) {
      // Clear pending timer on error
      if (pendingUpdateTimer) {
        clearTimeout(pendingUpdateTimer);
        pendingUpdateTimer = null;
      }

      const errMsg = error instanceof Error ? error.message : String(error);
      traceNode(trace, 9, '异常捕获', 'error', errMsg);
      console.error(`[Channel:${adapter.id}] Message handler error:`, error);

      // If streaming card was created but errored, close it with error message
      if (streamingMessageId && adapter.closeStreamingCard) {
        await adapter.closeStreamingCard(streamingMessageId, '⚠️ 消息处理失败，请稍后重试。').catch(() => {});
      } else {
        await this.sendTextReply(adapter, incoming, '⚠️ 消息处理失败，请稍后重试。');
      }
    }
  }

  /**
   * Handle a slash command by sending a direct response without agent processing.
   */
  private async handleSlashCommand(
    adapter: ChannelAdapter,
    incoming: IncomingMessage,
    command: string,
  ): Promise<void> {
    const channelKey = `${adapter.id}:${incoming.conversationId}`;
    let replyText: string;

    switch (command) {
      case 'new': {
        resetChannelSession(channelKey);
        const session = this.sessions.get(channelKey);
        if (session) session.history = [];
        replyText = '✅ 已开启新对话。之前的上下文已清除，请开始新的提问。';
        break;
      }
      case 'reset': {
        resetChannelSession(channelKey);
        const session = this.sessions.get(channelKey);
        if (session) session.history = [];
        replyText = '✅ 已重置会话。上下文和短期记忆已清除。\n\n长期记忆保留不变，我仍然记得你的偏好。';
        break;
      }
      case 'help':
        replyText = [
          '📋 可用命令：',
          '',
          '/new — 开启新对话，清除当前上下文',
          '/reset — 重置会话（清除上下文+短期记忆）',
          '/help — 显示此帮助信息',
          '',
          '💡 直接发送消息即可正常对话。',
        ].join('\n');
        break;
      default:
        replyText = `未知命令：/${command}`;
    }

    console.log(`[Channel:${adapter.id}] Slash command /${command}`);
    await this.sendTextReply(adapter, incoming, replyText);
  }

  /**
   * Send a plain text reply through the adapter.
   */
  private async sendTextReply(
    adapter: ChannelAdapter,
    incoming: IncomingMessage,
    text: string,
  ): Promise<void> {
    try {
      const response = await adapter.formatResponse(
        [{ type: 'text', content: text }],
        incoming.conversationId,
      );
      response.replyToMessageId = incoming.replyToMessageId;
      await adapter.send(response);
    } catch (err) {
      console.error(`[Channel:${adapter.id}] Failed to send reply:`, err);
    }
  }

  getAdapter(id: string): ChannelAdapter | undefined {
    return this.adapters.get(id);
  }

  getRegisteredIds(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Resolve model configuration from ProviderManager.
   * The frontend syncs its settings (apiKey, baseUrl, model, apiType) to the backend
   * via POST /providers/settings/sync, which updates ProviderManager.config.agent.config.
   *
   * Fallback: if ProviderManager has no config (e.g. app just restarted and frontend
   * hasn't synced yet), read from the persisted agentConfig in config.json.
   */
  private resolveModelConfig(): { apiKey?: string; baseUrl?: string; model?: string; apiType?: 'anthropic-messages' | 'openai-completions' } | undefined {
    // Primary: read from ProviderManager (in-memory, set by frontend sync)
    const agentCfg = getProviderManager().getConfig().agent?.config as Record<string, unknown> | undefined;

    const apiKey = agentCfg?.apiKey as string | undefined;
    const baseUrl = agentCfg?.baseUrl as string | undefined;
    const model = agentCfg?.model as string | undefined;
    const apiType = agentCfg?.apiType as 'anthropic-messages' | 'openai-completions' | undefined;

    if (apiKey) {
      return { apiKey, baseUrl, model, apiType };
    }

    // Fallback: read persisted agentConfig from config.json
    console.warn('[ChannelManager] No apiKey in ProviderManager config. Trying config.json fallback...');
    try {
      const saved = getConfigLoader().get<Record<string, unknown>>('agentConfig');
      if (saved?.apiKey) {
        console.log('[ChannelManager] Loaded agentConfig from config.json fallback');
        // Also hydrate ProviderManager so subsequent calls don't need fallback
        getProviderManager().updateFromSettings({
          agentProvider: (getConfigLoader().get<string>('agentProvider') || 'codeany'),
          agentConfig: saved,
        });
        return {
          apiKey: saved.apiKey as string,
          baseUrl: saved.baseUrl as string | undefined,
          model: saved.model as string | undefined,
          apiType: saved.apiType as 'anthropic-messages' | 'openai-completions' | undefined,
        };
      }
    } catch (err) {
      console.error('[ChannelManager] Failed to read config.json fallback:', err);
    }

    console.warn('[ChannelManager] No apiKey found in ProviderManager or config.json. Frontend may not have synced settings yet.');
    return undefined;
  }

  getOrCreateSession(
    channelId: string,
    conversationId: string
  ): ChannelSession {
    const key = `${channelId}:${conversationId}`;
    let session = this.sessions.get(key);

    if (!session) {
      session = {
        channelId,
        conversationId,
        history: [],
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };
      this.sessions.set(key, session);
    }

    session.lastActiveAt = new Date();
    return session;
  }

  async shutdown(): Promise<void> {
    const shutdownPromises = Array.from(this.adapters.values()).map(
      async (adapter) => {
        try {
          // Disconnect WebSocket adapters first
          if (adapter.disconnect) {
            await adapter.disconnect();
          }
          await adapter.shutdown();
        } catch (err) {
          console.error(`[Channel] Error shutting down ${adapter.id}:`, err);
        }
      }
    );
    await Promise.all(shutdownPromises);
    this.adapters.clear();
    this.sessions.clear();
    console.log('[Channel] All adapters shut down');
  }
}

let globalManager: ChannelManager | null = null;

export function getChannelManager(): ChannelManager {
  if (!globalManager) {
    globalManager = new ChannelManager();
  }
  return globalManager;
}

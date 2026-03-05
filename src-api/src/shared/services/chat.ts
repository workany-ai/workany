/**
 * Lightweight Chat Service
 *
 * Directly calls the Anthropic Messages API for simple conversational queries,
 * bypassing the Claude Agent SDK to avoid CLI subprocess, tools, and thinking mode overhead.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { AgentMessage, ConversationMessage } from '@/core/agent/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ChatService');

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/**
 * Run a lightweight chat using the Anthropic Messages API directly.
 * Yields AgentMessage-compatible events for SSE streaming.
 */
export async function* runChat(
  prompt: string,
  modelConfig?: { apiKey?: string; baseUrl?: string; model?: string },
  language?: string,
  conversation?: ConversationMessage[],
  abortController?: AbortController
): AsyncGenerator<AgentMessage> {
  // Resolve API key: modelConfig > env vars
  const apiKey =
    modelConfig?.apiKey ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_API_KEY ||
    '';

  const baseURL =
    modelConfig?.baseUrl || process.env.ANTHROPIC_BASE_URL || undefined;

  const model = modelConfig?.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    yield { type: 'error', message: 'No API key configured. Please set up your API key in Settings.' };
    yield { type: 'done' };
    return;
  }

  logger.info('[ChatService] Starting chat:', {
    model,
    hasBaseURL: !!baseURL,
    hasConversation: !!(conversation && conversation.length > 0),
    promptLength: prompt.length,
  });

  const client = new Anthropic({
    apiKey,
    baseURL,
  });

  // Build system prompt
  let systemPrompt = 'You are a helpful assistant. Be concise and direct in your responses.';
  if (language) {
    const langMap: Record<string, string> = {
      'zh-CN': 'Chinese (Simplified)',
      'zh-TW': 'Chinese (Traditional)',
      'en-US': 'English',
      'ja-JP': 'Japanese',
      'ko-KR': 'Korean',
    };
    const langName = langMap[language] || language;
    systemPrompt += ` Please respond in ${langName}.`;
  }

  // Build messages array from conversation history
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (conversation && conversation.length > 0) {
    for (const msg of conversation) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: 'user', content: prompt });

  try {
    // Build request params - explicitly disable thinking for fast chat
    const requestParams: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    };

    // Models like claude-sonnet-4 require explicit thinking configuration.
    // Disable it for fast chat to avoid "thinking type should be enabled or disabled" errors.
    // Only add for known Anthropic models; third-party APIs may not support this parameter.
    const isAnthropicModel =
      model.startsWith('claude-') || model.includes('claude');
    if (isAnthropicModel) {
      requestParams.thinking = { type: 'disabled' };
    }

    const stream = client.messages.stream(
      requestParams as Parameters<typeof client.messages.stream>[0]
    );

    // Handle abort
    if (abortController) {
      abortController.signal.addEventListener('abort', () => {
        stream.abort();
      });
    }

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { type: 'text', content: event.delta.text };
      }
    }

    // Get final message for usage stats
    const finalMessage = await stream.finalMessage();
    logger.info('[ChatService] Chat completed:', {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    });

    yield { type: 'done' };
  } catch (error) {
    if (abortController?.signal.aborted) {
      logger.info('[ChatService] Chat aborted by user');
      yield { type: 'done' };
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[ChatService] Chat error:', errorMessage);
    yield { type: 'error', message: errorMessage };
    yield { type: 'done' };
  }
}

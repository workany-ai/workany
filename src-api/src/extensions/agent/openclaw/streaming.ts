/**
 * OpenClaw Polling-Based Streaming
 *
 * This module implements streaming responses via polling the chat.history endpoint.
 * Since OpenClaw Gateway doesn't support SSE, we poll periodically to get new messages.
 */

import type { AgentMessage } from '@/core/agent/types';
import type { OpenClawGateway } from './gateway';
import type { OpenClawMessage } from './types';
import { MessageMapper, createContentSignature } from './messages';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('OpenClawStreaming');

// ============================================================================
// Streaming Options
// ============================================================================

/**
 * Options for polling streaming
 */
export interface StreamingOptions {
  /** Poll interval in milliseconds (default: 350ms) */
  pollInterval?: number;
  /** Idle timeout in milliseconds - no new messages for this long = done (default: 4000ms) */
  idleTimeout?: number;
  /** Maximum polling duration in milliseconds (default: 5 minutes) */
  maxDuration?: number;
  /** Maximum number of messages to fetch from history */
  historyLimit?: number;
}

// ============================================================================
// Streaming State
// ============================================================================

/**
 * Internal streaming state
 */
interface StreamingState {
  processedMessageCount: number;
  sentContentHashes: Set<string>;
  sentToolIds: Set<string>;
  sentToolResultIds: Set<string>;
  lastMessageTime: number;
  lastSignature: string;
}

/**
 * Initialize streaming state
 */
function initStreamingState(): StreamingState {
  return {
    processedMessageCount: 0,
    sentContentHashes: new Set(),
    sentToolIds: new Set(),
    sentToolResultIds: new Set(),
    lastMessageTime: Date.now(),
    lastSignature: '',
  };
}

/**
 * Create a message signature for change detection
 */
function createMessageSignature(messages: OpenClawMessage[]): string {
  if (messages.length === 0) {
    return 'empty';
  }

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage.content || lastMessage.content.length === 0) {
    return 'no-content';
  }

  // Extract text from the last content item
  const lastContent = lastMessage.content[lastMessage.content.length - 1];
  if (lastContent.type === 'text' && lastContent.text) {
    // Use last 64 chars as signature
    return `${messages.length}:${lastContent.text.slice(-64)}`;
  }

  return `${messages.length}:${JSON.stringify(lastContent).slice(-64)}`;
}

// ============================================================================
// Polling Streaming Implementation
// ============================================================================

/**
 * Poll for streaming responses from OpenClaw Gateway
 *
 * @param gateway - OpenClaw Gateway client
 * @param sessionKey - Session key to poll
 * @param options - Streaming options
 * @yields AgentMessage instances
 */
export async function* pollStreamingResponse(
  gateway: OpenClawGateway,
  sessionKey: string,
  options: StreamingOptions = {}
): AsyncGenerator<AgentMessage> {
  const {
    pollInterval = 350,
    idleTimeout = 4000,
    maxDuration = 300000, // 5 minutes
    historyLimit = 50,
  } = options;

  const startTime = Date.now();
  const state = initStreamingState();

  logger.debug(
    `[pollStreamingResponse] Starting polling for session: ${sessionKey}`
  );

  try {
    while (Date.now() - startTime < maxDuration) {
      // Check for idle timeout
      const idleTime = Date.now() - state.lastMessageTime;
      if (idleTime > idleTimeout && state.processedMessageCount > 0) {
        logger.debug(
          `[pollStreamingResponse] Idle timeout after ${idleTime}ms`
        );
        break;
      }

      // Fetch history
      const response = await gateway.chatHistory({
        sessionKey,
        limit: historyLimit,
      });

      const messages = response.messages || [];
      const newSignature = createMessageSignature(messages);

      // Check for changes
      if (newSignature !== state.lastSignature) {
        // There are new messages
        const newMessages = messages.slice(state.processedMessageCount);

        if (newMessages.length > 0) {
          state.lastMessageTime = Date.now();
          logger.debug(
            `[pollStreamingResponse] Received ${newMessages.length} new messages`
          );

          // Process new messages
          for (const message of newMessages) {
            if (message.role === 'assistant') {
              // Convert OpenClaw messages to AgentMessage
              for (const agentMessage of MessageMapper.fromOpenClaw(message)) {
                // Deduplicate messages
                if (shouldEmitMessage(agentMessage, state)) {
                  markMessageAsSent(agentMessage, state);
                  yield agentMessage;
                }
              }
            }
          }

          state.processedMessageCount = messages.length;
          state.lastSignature = newSignature;
        }
      }

      // Check if we're done (no more activity)
      const totalElapsed = Date.now() - startTime;
      const timeSinceLastMessage = Date.now() - state.lastMessageTime;

      if (
        timeSinceLastMessage > idleTimeout &&
        state.processedMessageCount > 0
      ) {
        logger.debug(
          `[pollStreamingResponse] Stream complete after ${totalElapsed}ms`
        );
        break;
      }

      // Wait before next poll
      await sleep(pollInterval);
    }
  } catch (error) {
    logger.error('[pollStreamingResponse] Polling error:', error);
    yield {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    logger.debug('[pollStreamingResponse] Polling finished');
    yield { type: 'done' };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a message should be emitted (deduplication)
 */
function shouldEmitMessage(
  message: AgentMessage,
  state: StreamingState
): boolean {
  const signature = createContentSignature(message);

  // Skip empty text messages
  if (message.type === 'text' && !message.content) {
    return false;
  }

  // Check text content
  if (signature.textHash) {
    if (state.sentContentHashes.has(signature.textHash)) {
      return false;
    }
  }

  // Check tool calls
  if (signature.toolCallId) {
    if (state.sentToolIds.has(signature.toolCallId)) {
      return false;
    }
  }

  return true;
}

/**
 * Mark a message as sent to prevent duplicates
 */
function markMessageAsSent(
  message: AgentMessage,
  state: StreamingState
): void {
  const signature = createContentSignature(message);

  if (signature.textHash) {
    state.sentContentHashes.add(signature.textHash);
  }

  if (signature.toolCallId) {
    state.sentToolIds.add(signature.toolCallId);
  }
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Stream Completion Detection
// ============================================================================

/**
 * Detect if streaming is complete based on message patterns
 *
 * @param messages - Current message history
 * @param lastEmitTime - Time of last message emission
 * @param idleTimeout - Idle timeout threshold
 * @returns True if streaming should be considered complete
 */
export function isStreamComplete(
  messages: OpenClawMessage[],
  lastEmitTime: number,
  idleTimeout: number
): boolean {
  // No messages yet
  if (messages.length === 0) {
    return false;
  }

  // Check idle time
  const idleTime = Date.now() - lastEmitTime;
  if (idleTime > idleTimeout) {
    return true;
  }

  // Check for completion indicators in the last message
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.content) {
    const lastContent = lastMessage.content[lastMessage.content.length - 1];

    // Check for completion text
    if (
      lastContent.type === 'text' &&
      lastContent.text?.includes('[DONE]')
    ) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Process multiple messages in batch, yielding only new ones
 *
 * @param messages - All messages from history
 * @param processedCount - Number of messages already processed
 * @yields New AgentMessage instances
 */
export function* processMessageBatch(
  messages: OpenClawMessage[],
  processedCount: number
): Generator<AgentMessage> {
  const newMessages = messages.slice(processedCount);

  for (const message of newMessages) {
    if (message.role === 'assistant') {
      yield* MessageMapper.fromOpenClaw(message);
    }
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export type { StreamingState };
export { initStreamingState, createMessageSignature };

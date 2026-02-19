/**
 * OpenClaw Message Mapper
 *
 * This module provides bidirectional conversion between WorkAny AgentMessage
 * format and OpenClaw Gateway message format.
 */

import { createHash } from 'node:crypto';

import type { AgentMessage, ConversationMessage } from '@/core/agent/types';
import type {
  OpenClawContent,
  OpenClawMessage,
  ToolCallContent,
  ToolResultContent,
} from './types';

// ============================================================================
// Message Mapper
// ============================================================================

/**
 * Message mapper for converting between WorkAny and OpenClaw formats
 */
export class MessageMapper {
  /**
   * Convert WorkAny AgentMessage to OpenClaw message format
   *
   * @param message - WorkAny AgentMessage
   * @param role - Message role (defaults to 'user' for text/tool_use, 'assistant' for tool_result)
   * @returns OpenClaw message
   */
  static toOpenClaw(
    message: AgentMessage | ConversationMessage,
    role?: 'user' | 'assistant' | 'system'
  ): OpenClawMessage {
    const content: OpenClawContent[] = [];

    // Handle ConversationMessage (simple text + images)
    if ('role' in message && 'content' in message && !('type' in message)) {
      const convMessage = message as ConversationMessage;
      return {
        role: convMessage.role,
        content: [
          {
            type: 'text',
            text: convMessage.content,
          },
        ],
        timestamp: Date.now(),
      };
    }

    // Handle AgentMessage
    const agentMessage = message as AgentMessage;

    switch (agentMessage.type) {
      case 'text':
        content.push({
          type: 'text',
          text: agentMessage.content || '',
        });
        break;

      case 'tool_use':
        content.push({
          type: 'toolCall',
          id: agentMessage.id || '',
          name: agentMessage.name || '',
          arguments: agentMessage.input as Record<string, unknown>,
        });
        break;

      case 'tool_result':
        content.push({
          type: 'toolResult',
          toolCallId: agentMessage.toolUseId || '',
          content: [
            {
              type: 'text',
              text: agentMessage.output || '',
            },
          ],
          isError: agentMessage.isError,
        });
        break;

      case 'error':
        content.push({
          type: 'text',
          text: agentMessage.message || 'An error occurred',
        });
        break;

      case 'plan':
        // Convert plan to text format
        if (agentMessage.plan) {
          const planText = this.formatPlanAsText(agentMessage.plan);
          content.push({
            type: 'text',
            text: planText,
          });
        }
        break;

      case 'done':
      case 'session':
        // These are control messages, don't send to OpenClaw
        content.push({
          type: 'text',
          text: '',
        });
        break;

      default:
        // Fallback for unknown message types
        content.push({
          type: 'text',
          text: agentMessage.content || '',
        });
    }

    return {
      role: role || 'user',
      content,
      timestamp: Date.now(),
    };
  }

  /**
   * Convert OpenClaw message to WorkAny AgentMessage generator
   *
   * @param message - OpenClaw message
   * @yields WorkAny AgentMessage instances
   */
  static *fromOpenClaw(message: OpenClawMessage): Generator<AgentMessage> {
    if (!message.content || message.content.length === 0) {
      return;
    }

    for (const item of message.content) {
      switch (item.type) {
        case 'text':
          if ('text' in item && item.text) {
            yield {
              type: 'text',
              content: item.text,
            };
          }
          break;

        case 'toolCall': {
          const toolCall = item as ToolCallContent;
          if (toolCall.id && toolCall.name) {
            yield {
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.arguments,
            };
          }
          break;
        }

        case 'toolResult': {
          const toolResult = item as ToolResultContent;
          if (toolResult.toolCallId) {
            // Extract text from content array
            let outputText = '';
            if (toolResult.content && toolResult.content.length > 0) {
              outputText = toolResult.content
                .map((c) => c.text || '')
                .join('\n');
            }

            yield {
              type: 'tool_result',
              toolUseId: toolResult.toolCallId,
              output: outputText,
              isError: toolResult.isError,
            };
          }
          break;
        }

        case 'thinking':
          // Thinking content - could emit as text or handle separately
          if ('thinking' in item && item.thinking) {
            // Optionally emit thinking as text with a marker
            // yield {
            //   type: 'text',
            //   content: `<thinking>${item.thinking}</thinking>`,
            // };
          }
          break;
      }
    }
  }

  /**
   * Convert conversation history to OpenClaw messages
   *
   * @param conversation - Array of ConversationMessage
   * @returns Array of OpenClaw messages
   */
  static conversationToOpenClaw(
    conversation: ConversationMessage[]
  ): OpenClawMessage[] {
    return conversation.map((msg) => this.toOpenClaw(msg));
  }

  /**
   * Extract text content from an AgentMessage
   *
   * @param message - AgentMessage
   * @returns Text content or empty string
   */
  static extractText(message: AgentMessage): string {
    if (message.type === 'text' && message.content) {
      return message.content;
    }
    if (message.type === 'error' && message.message) {
      return `Error: ${message.message}`;
    }
    if (message.type === 'tool_use' && message.name) {
      return `[Using tool: ${message.name}]`;
    }
    if (message.type === 'tool_result' && message.output) {
      return message.output;
    }
    return '';
  }

  /**
   * Format a plan as text for display
   *
   * @param plan - Task plan
   * @returns Formatted plan text
   */
  static formatPlanAsText(plan: {
    id: string;
    goal: string;
    steps: Array<{ id: string; description: string; status: string }>;
    notes?: string;
  }): string {
    const steps = plan.steps
      .map((step, index) => `${index + 1}. ${step.description}`)
      .join('\n');

    return `## Plan: ${plan.goal}

Steps:
${steps}

${plan.notes ? `Notes: ${plan.notes}` : ''}`;
  }

  /**
   * Check if a message is a control message (not sent to gateway)
   *
   * @param message - AgentMessage
   * @returns True if message is a control message
   */
  static isControlMessage(message: AgentMessage): boolean {
    return ['done', 'session'].includes(message.type);
  }

  /**
   * Check if a message contains tool use
   *
   * @param message - AgentMessage
   * @returns True if message is a tool_use
   */
  static isToolUse(message: AgentMessage): boolean {
    return message.type === 'tool_use';
  }

  /**
   * Check if a message contains tool result
   *
   * @param message - AgentMessage
   * @returns True if message is a tool_result
   */
  static isToolResult(message: AgentMessage): boolean {
    return message.type === 'tool_result';
  }

  /**
   * Get a hash of text content for deduplication
   *
   * @param text - Text content
   * @returns Hash string (first 16 chars of SHA-256)
   */
  static getTextHash(text: string): string {
    // Use SHA-256 hash for reliable deduplication
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
  }
}

// ============================================================================
// Content Hash Utilities for Streaming Deduplication
// ============================================================================

/**
 * Content signature for deduplication
 */
export interface ContentSignature {
  textHash?: string;
  toolCallId?: string;
  toolName?: string;
}

/**
 * Create a signature for a message for deduplication
 *
 * @param message - AgentMessage
 * @returns Content signature
 */
export function createContentSignature(
  message: AgentMessage
): ContentSignature {
  if (message.type === 'text' && message.content) {
    return { textHash: MessageMapper.getTextHash(message.content) };
  }
  if (message.type === 'tool_use' && message.id) {
    return {
      toolCallId: message.id,
      toolName: message.name,
    };
  }
  if (message.type === 'tool_result' && message.toolUseId) {
    return {
      toolCallId: message.toolUseId,
    };
  }
  return {};
}

/**
 * Check if two signatures match
 *
 * @param a - First signature
 * @param b - Second signature
 * @returns True if signatures match
 */
export function signaturesMatch(
  a: ContentSignature,
  b: ContentSignature
): boolean {
  if (a.textHash && b.textHash) {
    return a.textHash === b.textHash;
  }
  if (a.toolCallId && b.toolCallId) {
    return a.toolCallId === b.toolCallId;
  }
  return false;
}

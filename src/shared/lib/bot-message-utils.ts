/**
 * Bot Message Utilities
 *
 * Shared functions for parsing and cleaning bot messages.
 */

import type {
  BotChatMessage,
  BotContentPart,
} from '@/shared/hooks/useBotChats';

interface OpenClawMessage {
  role: string;
  content?: Array<{ type?: string; text?: string }>;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  details?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Extract real user content from system-polluted text
 * Removes "untrusted" context blocks and JSON artifacts
 */
export function extractRealUserContent(content: string): string {
  if (!content) return '';

  let result = content;

  // Remove blocks like "xxx (untrusted xxx):\n```json ... ```"
  // 1. Matches "xxx (untrusted xxx)" header
  // 2. Matches optional colon and newline
  // 3. Matches ```json ... ``` block
  const untrustedBlockPattern =
    /[^\n]*\(untrusted[^)]*\):\s*\n```json\s*```[\s\n]*/gi;
  result = result.replace(untrustedBlockPattern, '');

  // Remove standalone ```json ... ``` blocks
  const jsonBlockPattern = /```json\s*```[\s\n]*/gi;
  result = result.replace(jsonBlockPattern, '');

  // Remove standalone "untrusted" headers if missed by block pattern
  const titlePattern = /^[^\n]*\(untrusted[^)]*\):\s*\n/gim;
  result = result.replace(titlePattern, '');

  // Remove any remaining empty/malformed json blocks
  const looseJsonPattern = /```json[^`]*```/gi;
  result = result.replace(looseJsonPattern, '');

  return result.trim();
}

/**
 * Convert OpenClaw API message to internal BotChatMessage
 */
export function convertOpenClawMessage(
  message: OpenClawMessage
): BotChatMessage {
  // Extract and clean text content
  const extractCleanContent = (): string => {
    if (!message.content) return '';

    const textParts = message.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text || '')
      .filter((text) => text.trim());

    // Clean each part
    const cleanParts = textParts.map((text) => extractRealUserContent(text));
    return cleanParts.join('\n');
  };

  return {
    role: message.role as BotChatMessage['role'],
    content: extractCleanContent(),
    timestamp: message.timestamp,
    rawContent: (message.content || []) as BotContentPart[],
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    details: message.details,
    isError: message.isError,
  };
}

/**
 * Get preview text for the last message in a conversation
 */
export function getLastMessagePreview(messages: BotChatMessage[]): string {
  const sortByTimestamp = (a: BotChatMessage, b: BotChatMessage) =>
    (b.timestamp || 0) - (a.timestamp || 0);

  const lastAssistant = messages
    .filter((m) => m.role === 'assistant')
    .sort(sortByTimestamp)[0];

  const lastUser = messages
    .filter((m) => m.role === 'user')
    .sort(sortByTimestamp)[0];

  const content = lastAssistant?.content || lastUser?.content || '';
  const previewLength = 50;

  return content.length > previewLength
    ? content.slice(0, previewLength) + '...'
    : content;
}

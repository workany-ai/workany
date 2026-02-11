import { useBotChatContext } from '@/shared/providers/bot-chat-provider';

export interface BotContentPart {
  type: 'text' | 'thinking' | 'toolCall' | 'toolResult';
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  partialJson?: string;
  toolCallId?: string;
  toolName?: string;
  content?: Array<{ type?: string; text?: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

export interface BotChatMessage {
  role: 'user' | 'assistant' | 'toolResult';
  content: string;
  timestamp?: number;
  rawContent?: BotContentPart[];
  toolCallId?: string;
  toolName?: string;
  details?: Record<string, unknown>;
  isError?: boolean;
}

export interface BotChatSession {
  sessionKey: string;
  friendlyId?: string;
  label?: string;
  messages: BotChatMessage[];
  lastMessage?: string;
  messageCount: number;
  updatedAt?: number;
}

export function useBotChats() {
  const { sessions, isLoading } = useBotChatContext();
  return { sessions, isLoading };
}

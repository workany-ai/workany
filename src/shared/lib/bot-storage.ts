/**
 * Bot Chat Storage Utilities
 *
 * Helper functions for managing bot chat session and message storage in localStorage.
 */

export interface BotMessage {
  id: string;
  role: 'user' | 'assistant' | 'toolResult';
  content: string;
  timestamp: Date;
  rawContent?: any[];
  toolCallId?: string;
  toolName?: string;
  details?: Record<string, unknown>;
  isError?: boolean;
}

export interface StoredBotSession {
  sessionKey: string;
  messages: BotMessage[];
  createdAt: string;
}

const BOT_SESSION_KEY = 'openclaw_bot_session';
const BOT_MESSAGES_KEY = 'openclaw_bot_messages';

/**
 * Get or create bot session key from localStorage
 */
export function getBotSessionKey(): string {
  try {
    const stored = localStorage.getItem(BOT_SESSION_KEY);
    if (stored) {
      const session = JSON.parse(stored) as StoredBotSession;
      return session.sessionKey;
    }
  } catch {
    // Ignore parse errors
  }

  const sessionKey = `bot_${Date.now()}`;
  const newSession: StoredBotSession = {
    sessionKey,
    messages: [],
    createdAt: new Date().toISOString(),
  };

  localStorage.setItem(BOT_SESSION_KEY, JSON.stringify(newSession));
  return sessionKey;
}

/**
 * Save bot messages to localStorage
 */
export function saveBotMessages(messages: BotMessage[]): void {
  try {
    localStorage.setItem(BOT_MESSAGES_KEY, JSON.stringify(messages));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Load bot messages from localStorage
 */
export function loadBotMessages(): BotMessage[] {
  try {
    const stored = localStorage.getItem(BOT_MESSAGES_KEY);
    if (stored) {
      const messages = JSON.parse(stored) as BotMessage[];
      return messages.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

/**
 * Create a new bot session
 */
export function createNewBotSession(): string {
  const newSessionKey = `bot_${Date.now()}`;
  const newSession: StoredBotSession = {
    sessionKey: newSessionKey,
    messages: [],
    createdAt: new Date().toISOString(),
  };

  localStorage.setItem(BOT_SESSION_KEY, JSON.stringify(newSession));
  localStorage.removeItem(BOT_MESSAGES_KEY);

  return newSessionKey;
}

/**
 * Update the current session key in localStorage
 */
export function updateBotSessionKey(sessionKey: string): void {
  try {
    const stored = localStorage.getItem(BOT_SESSION_KEY);
    let session: StoredBotSession;

    if (stored) {
      session = JSON.parse(stored) as StoredBotSession;
      session.sessionKey = sessionKey;
    } else {
      session = {
        sessionKey,
        messages: [],
        createdAt: new Date().toISOString(),
      };
    }

    localStorage.setItem(BOT_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore errors
  }
}

/**
 * Get OpenClaw config from localStorage
 */
export function getOpenClawConfig(): {
  gatewayUrl: string;
  authToken: string;
} {
  try {
    const stored = localStorage.getItem('openclaw_config');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }

  return {
    gatewayUrl: 'ws://127.0.0.1:18789',
    authToken: '',
  };
}

/**
 * Convert gateway message to BotMessage format
 */
export function messageToBotMessage(
  m: any,
  index: number,
  sessionKey: string
): BotMessage {
  return {
    id: `history_${sessionKey}_${index}`,
    role: m.role,
    content:
      m.content
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text || '')
        .join('\n') || '',
    timestamp: new Date(m.timestamp || Date.now()),
    rawContent: m.content || [],
    toolCallId: m.toolCallId,
    toolName: m.toolName,
    details: m.details,
    isError: m.isError,
  };
}

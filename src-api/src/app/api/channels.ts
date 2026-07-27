/**
 * Channel Webhook Routes
 *
 * Hono routes for handling incoming webhooks from messaging platforms.
 * Routes: /channels/:channelId/webhook
 *
 * Note: WebSocket-mode adapters don't use these routes — they receive
 * events directly via the SDK and route through ChannelManager.handleIncomingMessage().
 */

import { Hono } from 'hono';

import { getChannelManager } from '@/core/channel';
import {
  getAllChannelConversations,
  getUnsyncedConversations,
  markSynced,
} from '@/shared/services/channel-store';

export const channelRoutes = new Hono();

channelRoutes.post('/:channelId/webhook', async (c) => {
  const channelId = c.req.param('channelId');
  const manager = getChannelManager();
  const adapter = manager.getAdapter(channelId);

  if (!adapter) {
    return c.json({ error: `Unknown channel: ${channelId}` }, 404);
  }

  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const rawBody = await c.req.text();

  const verified = await adapter.verifyWebhook(headers, rawBody);
  if (!verified) {
    return c.json({ error: 'Webhook verification failed' }, 403);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = rawBody;
  }

  const incoming = await adapter.parseIncoming(body, headers);
  if (!incoming) {
    return c.json({ ok: true, message: 'Event acknowledged but not handled' });
  }

  if (incoming.directResponse) {
    return c.json(incoming.directResponse);
  }

  // Delegate to ChannelManager for unified processing
  try {
    await manager.handleIncomingMessage(adapter, incoming);
    return c.json({ ok: true });
  } catch (error) {
    console.error(`[Channel:${channelId}] Webhook handler error:`, error);
    return c.json({ error: 'Internal processing error' }, 500);
  }
});

channelRoutes.get('/', (c) => {
  const manager = getChannelManager();
  const adapters = manager.getRegisteredIds();
  const status: Record<string, { connected?: boolean }> = {};

  for (const id of adapters) {
    const adapter = manager.getAdapter(id);
    status[id] = {
      connected: adapter?.isConnected?.() ?? undefined,
    };
  }

  return c.json({ channels: adapters, status });
});

channelRoutes.get('/conversations/unsynced', (c) => {
  const conversations = getUnsyncedConversations();
  if (conversations.length > 0) {
    console.log(`[ChannelStore] Returning ${conversations.length} unsynced conversations`);
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ conversations });
});

channelRoutes.get('/conversations/all', (c) => {
  const all = getAllChannelConversations();
  c.header('Cache-Control', 'no-store');
  return c.json({
    total: all.length,
    conversations: all,
  });
});

channelRoutes.get('/conversations/debug', (c) => {
  const all = getAllChannelConversations();
  return c.json({
    total: all.length,
    conversations: all.map((conv) => ({
      id: conv.id,
      channel: conv.channel,
      prompt: conv.prompt.slice(0, 50),
      messageCount: conv.messages.length,
      synced: conv.synced,
      version: conv.version,
    })),
  });
});

channelRoutes.post('/conversations/synced', async (c) => {
  const body = await c.req.json<{ ids: string[] }>();
  const count = markSynced(body.ids || []);
  return c.json({ ok: true, count });
});

  c.header('Cache-Control', 'no-store');
  return c.json({
  });
});

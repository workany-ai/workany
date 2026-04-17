/**
 * Skills Configuration API Routes
 *
 * Manages per-skill enable/disable state.
 */

import { Hono } from 'hono';
import {
  getDisabledSkills,
  setSkillEnabled,
  saveSkillsConfig,
} from '@/shared/skills/config';

export const skillsRoutes = new Hono();

/**
 * GET /skills/config — list disabled skills
 */
skillsRoutes.get('/config', (c) => {
  return c.json({ disabledSkills: getDisabledSkills() });
});

/**
 * POST /skills/config — bulk update disabled skills list
 */
skillsRoutes.post('/config', async (c) => {
  const body = await c.req.json<{ disabledSkills: string[] }>();
  if (!Array.isArray(body.disabledSkills)) {
    return c.json({ error: 'disabledSkills must be an array' }, 400);
  }
  saveSkillsConfig({ disabledSkills: body.disabledSkills });
  return c.json({ ok: true, disabledSkills: body.disabledSkills });
});

/**
 * POST /skills/toggle — toggle a single skill
 */
skillsRoutes.post('/toggle', async (c) => {
  const body = await c.req.json<{ name: string; enabled: boolean }>();
  if (!body.name) {
    return c.json({ error: 'name is required' }, 400);
  }
  setSkillEnabled(body.name, body.enabled);
  return c.json({ ok: true, name: body.name, enabled: body.enabled });
});

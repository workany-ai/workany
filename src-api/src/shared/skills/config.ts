/**
 * Per-skill enable/disable configuration.
 *
 * Stores a list of disabled skill names in ~/.workany/skills-config.json.
 * All skills are enabled by default; only explicitly disabled ones are listed.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getAppDir } from '@/config/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillsConfigFile {
  disabledSkills: string[];
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function configPath(): string {
  return join(getAppDir(), 'skills-config.json');
}

export function loadSkillsConfig(): SkillsConfigFile {
  const p = configPath();
  if (!existsSync(p)) return { disabledSkills: [] };
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as SkillsConfigFile;
    return { disabledSkills: Array.isArray(data.disabledSkills) ? data.disabledSkills : [] };
  } catch {
    return { disabledSkills: [] };
  }
}

export function saveSkillsConfig(config: SkillsConfigFile): void {
  const dir = getAppDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export function isSkillDisabled(skillName: string): boolean {
  const config = loadSkillsConfig();
  return config.disabledSkills.includes(skillName);
}

export function setSkillEnabled(skillName: string, enabled: boolean): void {
  const config = loadSkillsConfig();
  const set = new Set(config.disabledSkills);
  if (enabled) {
    set.delete(skillName);
  } else {
    set.add(skillName);
  }
  saveSkillsConfig({ disabledSkills: [...set] });
}

export function getDisabledSkills(): string[] {
  return loadSkillsConfig().disabledSkills;
}

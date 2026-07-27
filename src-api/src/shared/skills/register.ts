/**
 * Filesystem Skills → SDK Registry Bridge
 *
 * Loads SKILL.md-based skills from ~/.workany/skills/ and registers them
 * with @codeany/open-agent-sdk's skill registry so the Agent's Skill
 * tool can discover and invoke them at runtime.
 */

import { registerSkill } from '@codeany/open-agent-sdk';
import type { SkillContentBlock } from '@codeany/open-agent-sdk';

import { loadAllSkills } from './loader';
import type { LoadedSkill } from './loader';
import { getDisabledSkills } from './config';

function buildGetPrompt(skill: LoadedSkill) {
  return async (args: string): Promise<SkillContentBlock[]> => {
    const contextNote = args
      ? `\n\n## User Arguments\n${args}`
      : '';

    return [{ type: 'text', text: skill.content + contextNote }];
  };
}

/**
 * Load all filesystem skills and register enabled ones with the SDK.
 * Skills listed in ~/.workany/skills-config.json as disabled are skipped.
 * Safe to call multiple times; duplicate names are silently skipped by the registry.
 */
export async function registerFilesystemSkills(): Promise<number> {
  const skills = await loadAllSkills();
  const disabled = new Set(getDisabledSkills());

  let registered = 0;
  for (const skill of skills) {
    if (disabled.has(skill.name)) {
      console.log(`[Skills] Skipped disabled skill: ${skill.name}`);
      continue;
    }

    registerSkill({
      name: skill.name,
      description: skill.metadata.description || skill.name,
      whenToUse: skill.metadata.description,
      argumentHint: skill.metadata.argumentHint,
      userInvocable: true,
      allowedTools: ['Bash', 'Read', 'Write', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
      getPrompt: buildGetPrompt(skill),
    });

    console.log(`[Skills] Registered SDK skill: ${skill.name}`);
    registered++;
  }

  if (disabled.size > 0) {
    console.log(`[Skills] ${disabled.size} skill(s) disabled, ${registered} registered`);
  } else {
    console.log(`[Skills] Total registered: ${registered} filesystem skill(s)`);
  }
  return registered;
}

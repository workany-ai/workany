/**
 * Skills Module
 *
 * Provides skill loading and management functionality.
 * Skills are loaded from ~/.claude/skills/ (user directory)
 */

export {
  loadSkills,
  getSkillsPath,
  getSkillNames,
  findSkill,
  type LoadedSkill,
  type SkillMetadata,
  type SkillsConfig,
} from './loader';

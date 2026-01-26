/**
 * Skills Loader
 *
 * Loads skill definitions from ~/.claude/skills (Claude Code user directory)
 * Skills are directories containing a SKILL.md file with frontmatter metadata.
 *
 * Note: Skills are loaded by Claude SDK via settingSources: ['user']
 * This module is used for listing skills in the settings UI.
 */

import fs from 'fs/promises';
import { join, basename } from 'path';

import { getClaudeSkillsDir } from '@/config/constants';

/**
 * Skill metadata from SKILL.md frontmatter
 */
export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  author?: string;
  version?: string;
  argumentHint?: string;
}

/**
 * Loaded skill information
 */
export interface LoadedSkill {
  name: string;
  path: string;
  metadata: SkillMetadata;
  content: string; // Full SKILL.md content
}

/**
 * Skills configuration interface
 */
export interface SkillsConfig {
  enabled: boolean;
}

/**
 * Parse SKILL.md frontmatter to extract metadata
 */
function parseSkillFrontmatter(content: string): SkillMetadata | null {
  // Match YAML frontmatter between --- markers
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const frontmatter = frontmatterMatch[1];
  const metadata: SkillMetadata = {
    name: '',
    description: '',
  };

  // Simple YAML parsing for common fields
  const lines = frontmatter.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    switch (key) {
      case 'name':
        metadata.name = value;
        break;
      case 'description':
        metadata.description = value;
        break;
      case 'license':
        metadata.license = value;
        break;
      case 'author':
        metadata.author = value;
        break;
      case 'version':
        metadata.version = value;
        break;
      case 'argument-hint':
        metadata.argumentHint = value;
        break;
    }
  }

  return metadata.name ? metadata : null;
}

/**
 * Load a single skill from a directory
 */
async function loadSkillFromDir(skillDir: string): Promise<LoadedSkill | null> {
  try {
    // Check for SKILL.md (case-insensitive)
    const files = await fs.readdir(skillDir);
    const skillFile = files.find(
      (f) => f.toLowerCase() === 'skill.md'
    );

    if (!skillFile) {
      return null;
    }

    const skillPath = join(skillDir, skillFile);
    const content = await fs.readFile(skillPath, 'utf-8');
    const metadata = parseSkillFrontmatter(content);

    if (!metadata) {
      console.log(`[Skills] No valid frontmatter in: ${skillPath}`);
      return null;
    }

    // Use directory name as skill name if not specified in metadata
    if (!metadata.name) {
      metadata.name = basename(skillDir);
    }

    return {
      name: metadata.name,
      path: skillDir,
      metadata,
      content,
    };
  } catch {
    // Directory might not be accessible or readable
    return null;
  }
}

/**
 * Get the skills directory path
 */
export function getSkillsPath(): string {
  return getClaudeSkillsDir();
}

/**
 * Load skills from ~/.claude/skills/
 *
 * @param skillsConfig Optional configuration
 * @returns Array of loaded skills
 */
export async function loadSkills(
  skillsConfig?: SkillsConfig
): Promise<LoadedSkill[]> {
  // If skills are globally disabled, return empty
  if (skillsConfig && !skillsConfig.enabled) {
    console.log('[Skills] Skills disabled, skipping load');
    return [];
  }

  const skills: LoadedSkill[] = [];
  const skillsDir = getClaudeSkillsDir();

  try {
    await fs.access(skillsDir);
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden directories and files
      if (entry.name.startsWith('.')) {
        continue;
      }

      if (entry.isDirectory()) {
        const skillDir = join(skillsDir, entry.name);
        const skill = await loadSkillFromDir(skillDir);
        if (skill) {
          skills.push(skill);
          console.log(`[Skills] Loaded skill: ${skill.name}`);
        }
      }
    }
  } catch {
    // Directory doesn't exist or not accessible
    console.log(`[Skills] Directory not accessible: ${skillsDir}`);
  }

  const skillCount = skills.length;
  if (skillCount > 0) {
    console.log(`[Skills] Loaded ${skillCount} skill(s)`);
  } else {
    console.log('[Skills] No skills found');
  }

  return skills;
}

/**
 * Get skill names for display (useful for logging and UI)
 */
export function getSkillNames(skills: LoadedSkill[]): string[] {
  return skills.map((s) => s.name);
}

/**
 * Find a specific skill by name
 */
export function findSkill(skills: LoadedSkill[], name: string): LoadedSkill | undefined {
  return skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

/**
 * Pi Agent SDK Adapter
 *
 * Implementation of the IAgent interface using @mariozechner/pi-coding-agent.
 * Runs in-process — no external binary or CLI subprocess needed.
 */

import { homedir } from 'os';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';

import {
  BaseAgent,
  formatPlanForExecution,
  getWorkspaceInstruction,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
  buildLanguageInstruction,
} from '@/core/agent/base';
import type { PlanningResponse } from '@/core/agent/base';
import { PI_METADATA, defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin } from '@/core/agent/plugin';
import type {
  AgentConfig,
  AgentMessage as WorkanyAgentMessage,
  AgentOptions,
  AgentProvider,
  ExecuteOptions,
  PlanOptions,
} from '@/core/agent/types';
import { DEFAULT_WORK_DIR } from '@/config/constants';
import { loadAllSkills } from '@/shared/skills/loader';
import type { LoadedSkill } from '@/shared/skills/loader';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PiAgent');

// Cached skills content
let cachedSkillsContent: string | null = null;

// ============================================================================
// Type for Pi SDK session (avoid importing concrete types to keep dynamic import)
// ============================================================================

interface PiSessionLike {
  subscribe(listener: (event: PiEvent) => void): () => void;
  prompt(text: string, options?: { images?: Array<{ type: 'image'; data: string; mimeType: string }> }): Promise<void>;
}

interface PiEvent {
  type: string;
  [key: string]: unknown;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the agentDir for Pi SDK session persistence
 */
function getAgentDir(): string {
  return join(homedir(), '.workany', 'pi-agent');
}

/**
 * Map WorkAny model string to Pi SDK provider name
 */
function inferPiProvider(config: AgentConfig): string {
  const model = config.model || '';
  const baseUrl = config.baseUrl || '';

  // Check baseUrl first for third-party API gateways
  if (baseUrl.includes('openrouter')) {
    return 'openrouter';
  }
  if (model.startsWith('claude') || baseUrl.includes('anthropic')) {
    return 'anthropic';
  }
  if (model.startsWith('gpt') || baseUrl.includes('openai')) {
    return 'openai';
  }
  if (model.startsWith('gemini') || baseUrl.includes('google')) {
    return 'google';
  }
  return 'anthropic';
}

/**
 * Load skills content for injection into Pi Agent prompts.
 * Replaces $SKILL_DIR with actual skill paths.
 */
async function getSkillsInstruction(): Promise<string> {
  if (cachedSkillsContent !== null) return cachedSkillsContent;

  try {
    const skills = await loadAllSkills();
    if (skills.length === 0) {
      cachedSkillsContent = '';
      return '';
    }

    const parts: string[] = [];
    for (const skill of skills) {
      // Extract content after frontmatter
      const content = skill.content.replace(/^---[\s\S]*?---\n*/, '');
      // Replace $SKILL_DIR and $CLAUDE_SKILL_DIR with actual skill path
      const resolved = content
        .replace(/\$SKILL_DIR/g, skill.path)
        .replace(/\$CLAUDE_SKILL_DIR/g, skill.path);
      parts.push(resolved);
    }

    cachedSkillsContent = parts.join('\n\n---\n\n');
    logger.info(`[PiAgent] Loaded ${skills.length} skill(s) for prompt injection`);
    return cachedSkillsContent;
  } catch (err) {
    logger.error('[PiAgent] Failed to load skills:', err);
    cachedSkillsContent = '';
    return '';
  }
}

/**
 * Reset cached skills (useful for hot reload)
 */
export function resetSkillsCache(): void {
  cachedSkillsContent = null;
}

/**
 * Expand ~ to homedir in path
 */
function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1));
  }
  return p;
}

/**
 * Extract text content from a Pi SDK message object.
 * Messages have content arrays with { type: "text", text: "..." } blocks.
 */
function extractTextFromMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const msg = message as { content?: unknown[] };
  if (!Array.isArray(msg.content)) return '';
  return msg.content
    .filter((block: unknown) => {
      const b = block as { type?: string };
      return b.type === 'text';
    })
    .map((block: unknown) => {
      const b = block as { text?: string };
      return b.text || '';
    })
    .join('');
}

// ============================================================================
// PiAgent
// ============================================================================

export class PiAgent extends BaseAgent {
  readonly provider: AgentProvider = 'pi';

  constructor(config: AgentConfig) {
    super(config);
    logger.info('[PiAgent] Created with config:', {
      provider: config.provider,
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      workDir: config.workDir,
    });
  }

  /**
   * Create a Pi SDK session with the given configuration
   */
  private async createPiSession(workDir: string): Promise<PiSessionLike> {
    const sdk = await import('@mariozechner/pi-coding-agent');
    const piAi = await import('@mariozechner/pi-ai');
    const agentDir = getAgentDir();

    // Ensure agentDir exists
    if (!existsSync(agentDir)) {
      await mkdir(agentDir, { recursive: true });
    }

    const piProvider = inferPiProvider(this.config);
    const modelId = this.config.model || 'claude-sonnet-4-20250514';

    // Create auth storage (use in-memory to avoid file conflicts)
    const authStorage = sdk.AuthStorage.inMemory();

    // Set API key if provided
    if (this.config.apiKey) {
      authStorage.setRuntimeApiKey(piProvider, this.config.apiKey);
    }

    // Create model registry (requires authStorage)
    const modelRegistry = new sdk.ModelRegistry(authStorage);

    // Create model object using pi-ai's getModel
    let model: unknown;
    try {
      model = piAi.getModel(piProvider as 'anthropic', modelId as 'claude-sonnet-4-20250514');
    } catch {
      // Fallback: construct a full Model object for custom/unknown models
      logger.warn(`[PiAgent] getModel failed for ${piProvider}/${modelId}, constructing model manually`);

      // Determine API type and baseUrl based on provider
      const providerDefaults: Record<string, { api: string; baseUrl: string }> = {
        openrouter: { api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1' },
        openai: { api: 'openai-completions', baseUrl: 'https://api.openai.com/v1' },
        anthropic: { api: 'anthropic', baseUrl: 'https://api.anthropic.com' },
        google: { api: 'google', baseUrl: 'https://generativelanguage.googleapis.com' },
      };
      const defaults = providerDefaults[piProvider] || providerDefaults.openai;

      model = {
        id: modelId,
        name: modelId,
        api: defaults.api,
        provider: piProvider,
        baseUrl: this.config.baseUrl || defaults.baseUrl,
        reasoning: false,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      };
    }

    // Create session and settings managers (in-memory for isolation)
    const sessionManager = sdk.SessionManager.inMemory(workDir);
    const settingsManager = sdk.SettingsManager.inMemory();

    logger.info(`[PiAgent] Creating session with provider: ${piProvider}, model: ${modelId}`);

    const { session } = await sdk.createAgentSession({
      cwd: workDir,
      agentDir,
      authStorage,
      modelRegistry,
      model: model as Parameters<typeof sdk.createAgentSession>[0] extends { model?: infer M } ? M : never,
      sessionManager,
      settingsManager,
    });

    return session as unknown as PiSessionLike;
  }

  /**
   * Async generator that streams events from a Pi SDK session.
   * Uses subscribe() to receive typed AgentSessionEvent objects.
   */
  private async *streamSession(
    piSession: PiSessionLike,
    promptText: string,
    sessionId: string,
    abortController?: AbortController,
    images?: AgentOptions['images']
  ): AsyncGenerator<WorkanyAgentMessage> {
    const queue: WorkanyAgentMessage[] = [];
    let done = false;
    let errorMessage = '';
    let resolveWait: (() => void) | null = null;

    const enqueue = (msg: WorkanyAgentMessage) => {
      queue.push(msg);
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    };

    const wake = () => {
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    };

    // Subscribe to all session events via the unified subscribe() API
    const unsubscribe = piSession.subscribe((event: PiEvent) => {
      switch (event.type) {
        case 'message_update': {
          const text = extractTextFromMessage(event.message);
          if (text) {
            enqueue({
              type: 'text',
              sessionId,
              content: text,
            });
          }
          break;
        }
        case 'tool_execution_start': {
          enqueue({
            type: 'tool_use',
            sessionId,
            name: (event.toolName as string) || 'unknown',
            id: event.toolCallId as string,
            input: event.args,
          });
          break;
        }
        case 'tool_execution_end': {
          enqueue({
            type: 'tool_result',
            sessionId,
            toolUseId: event.toolCallId as string,
            output: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
            isError: event.isError as boolean,
          });
          break;
        }
        case 'agent_end': {
          enqueue({
            type: 'result',
            sessionId,
            content: '',
          });
          done = true;
          wake();
          break;
        }
        default:
          break;
      }
    });

    // Handle abort
    const onAbort = () => {
      done = true;
      enqueue({ type: 'error', sessionId, message: 'Aborted' });
      wake();
    };
    if (abortController) {
      abortController.signal.addEventListener('abort', onAbort);
    }

    // Build prompt options
    const promptOpts: Parameters<PiSessionLike['prompt']>[1] = {};
    if (images && images.length > 0) {
      promptOpts.images = images.map((img) => ({
        type: 'image' as const,
        data: img.data,
        mimeType: img.mimeType,
      }));
    }

    // Start the prompt (don't await — let it run while we yield events)
    piSession.prompt(promptText, promptOpts).then(() => {
      // Prompt completed normally — if agent_end wasn't already received, mark done
      if (!done) {
        done = true;
        wake();
      }
    }).catch((e: unknown) => {
      errorMessage = e instanceof Error ? e.message : String(e);
      done = true;
      wake();
    });

    // Yield from queue
    try {
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else if (!done) {
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
            setTimeout(resolve, 50);
          });
        }
      }

      if (errorMessage) {
        yield { type: 'error', sessionId, message: errorMessage };
      }

      yield { type: 'done', sessionId };
    } finally {
      unsubscribe();
      if (abortController) {
        abortController.signal.removeEventListener('abort', onAbort);
      }
    }
  }

  /**
   * Run the agent with a prompt (direct execution mode)
   */
  async *run(prompt: string, options?: AgentOptions): AsyncGenerator<WorkanyAgentMessage> {
    const session = this.createSession('executing', {
      id: options?.sessionId,
      abortController: options?.abortController,
    });

    yield { type: 'session', sessionId: session.id };

    try {
      const workDir = expandPath(options?.cwd || this.config.workDir || DEFAULT_WORK_DIR);

      const workspaceInstruction = getWorkspaceInstruction(workDir);
      const languageInstruction = options?.language
        ? buildLanguageInstruction(options.language)
        : '';
      const skillsInstruction = await getSkillsInstruction();
      const fullPrompt = [skillsInstruction, workspaceInstruction, languageInstruction, prompt]
        .filter(Boolean)
        .join('\n\n');

      const piSession = await this.createPiSession(workDir);

      yield* this.streamSession(
        piSession,
        fullPrompt,
        session.id,
        options?.abortController,
        options?.images
      );
    } catch (err) {
      logger.error('[PiAgent] run error:', err);
      yield {
        type: 'error',
        sessionId: session.id,
        message: err instanceof Error ? err.message : String(err),
      };
      yield { type: 'done', sessionId: session.id };
    } finally {
      this.updateSessionPhase(session.id, 'idle');
    }
  }

  /**
   * Run planning phase only (returns a plan for approval)
   */
  async *plan(prompt: string, options?: PlanOptions): AsyncGenerator<WorkanyAgentMessage> {
    const session = this.createSession('planning', {
      id: options?.sessionId,
      abortController: options?.abortController,
    });

    yield { type: 'session', sessionId: session.id };

    try {
      const workDir = expandPath(options?.cwd || this.config.workDir || DEFAULT_WORK_DIR);

      const workspaceInstruction = getWorkspaceInstruction(workDir);
      const languageInstruction = options?.language
        ? buildLanguageInstruction(options.language)
        : '';
      const skillsInstruction = await getSkillsInstruction();
      const planningPrompt = [
        PLANNING_INSTRUCTION,
        skillsInstruction,
        workspaceInstruction,
        languageInstruction,
        prompt,
      ]
        .filter(Boolean)
        .join('\n\n');

      const piSession = await this.createPiSession(workDir);

      // Collect full response for plan parsing
      let fullResponse = '';
      const innerGen = this.streamSession(
        piSession,
        planningPrompt,
        session.id,
        options?.abortController,
        options?.images
      );

      for await (const msg of innerGen) {
        if (msg.type === 'text' && msg.content) {
          fullResponse += msg.content;
          yield msg;
        } else if (msg.type === 'done') {
          // Don't yield done yet — parse the plan first
        } else {
          yield msg;
        }
      }

      // Parse planning response
      const planResult: PlanningResponse | undefined = parsePlanningResponse(fullResponse);

      if (planResult) {
        if (planResult.type === 'direct_answer') {
          yield {
            type: 'direct_answer',
            sessionId: session.id,
            content: planResult.answer,
          };
        } else if (planResult.type === 'plan') {
          this.storePlan(planResult.plan);
          yield {
            type: 'plan',
            sessionId: session.id,
            plan: planResult.plan,
          };
        }
      }

      yield { type: 'done', sessionId: session.id };
    } catch (err) {
      logger.error('[PiAgent] plan error:', err);
      yield {
        type: 'error',
        sessionId: session.id,
        message: err instanceof Error ? err.message : String(err),
      };
      yield { type: 'done', sessionId: session.id };
    } finally {
      this.updateSessionPhase(session.id, 'idle');
    }
  }

  /**
   * Execute an approved plan
   */
  async *execute(options: ExecuteOptions): AsyncGenerator<WorkanyAgentMessage> {
    const session = this.createSession('executing', {
      id: options.sessionId,
      abortController: options.abortController,
    });

    yield { type: 'session', sessionId: session.id };

    try {
      const plan = options.plan || this.getPlan(options.planId);
      if (!plan) {
        yield {
          type: 'error',
          sessionId: session.id,
          message: `Plan not found: ${options.planId}`,
        };
        yield { type: 'done', sessionId: session.id };
        return;
      }

      const workDir = expandPath(options.cwd || this.config.workDir || DEFAULT_WORK_DIR);

      const workspaceInstruction = getWorkspaceInstruction(workDir);
      const languageInstruction = options.language
        ? buildLanguageInstruction(options.language)
        : '';
      const executionInstruction = formatPlanForExecution(plan, options.originalPrompt);
      const skillsInstruction = await getSkillsInstruction();
      const fullPrompt = [skillsInstruction, workspaceInstruction, languageInstruction, executionInstruction]
        .filter(Boolean)
        .join('\n\n');

      const piSession = await this.createPiSession(workDir);

      yield* this.streamSession(
        piSession,
        fullPrompt,
        session.id,
        options.abortController,
        options.images
      );

      this.deletePlan(options.planId);
    } catch (err) {
      logger.error('[PiAgent] execute error:', err);
      yield {
        type: 'error',
        sessionId: session.id,
        message: err instanceof Error ? err.message : String(err),
      };
      yield { type: 'done', sessionId: session.id };
    } finally {
      this.updateSessionPhase(session.id, 'idle');
    }
  }
}

// ============================================================================
// Factory & Plugin
// ============================================================================

export function createPiAgent(config: AgentConfig): PiAgent {
  return new PiAgent(config);
}

export const piPlugin: AgentPlugin = defineAgentPlugin({
  metadata: PI_METADATA,
  factory: (config) => createPiAgent(config),
});

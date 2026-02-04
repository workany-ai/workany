/**
 * Agent SDK Abstraction Layer - Base Implementation
 *
 * Provides common functionality for all agent implementations.
 */

import { nanoid } from 'nanoid';

import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  AgentSession,
  ExecuteOptions,
  IAgent,
  PlanOptions,
  TaskPlan,
} from '@/core/agent/types';
import type { ProviderCapabilities } from '@/shared/provider/types';

/**
 * Agent capabilities interface
 */
export interface AgentCapabilities extends ProviderCapabilities {
  supportsPlan: boolean;
  supportsStreaming: boolean;
  supportsSandbox: boolean;
}

/**
 * Base class for agent implementations.
 * Provides common session management and plan storage.
 * Implements IProvider interface methods for compatibility.
 */
export abstract class BaseAgent implements IAgent {
  abstract readonly provider: AgentProvider;

  /** Provider type (alias for provider) */
  get type(): string {
    return this.provider;
  }

  /** Human-readable name */
  get name(): string {
    return `${this.provider} Agent`;
  }

  /** Provider version */
  readonly version: string = '1.0.0';

  protected config: AgentConfig;
  protected sessions: Map<string, AgentSession> = new Map();
  protected plans: Map<string, TaskPlan> = new Map();

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Create a new session
   */
  protected createSession(phase: AgentSession['phase'] = 'idle'): AgentSession {
    const session: AgentSession = {
      id: nanoid(),
      createdAt: new Date(),
      phase,
      isAborted: false,
      abortController: new AbortController(),
      config: this.config,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get an existing session
   */
  protected getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session phase
   */
  protected updateSessionPhase(
    sessionId: string,
    phase: AgentSession['phase']
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.phase = phase;
    }
  }

  /**
   * Store a plan
   */
  protected storePlan(plan: TaskPlan): void {
    this.plans.set(plan.id, plan);
  }

  /**
   * Get a stored plan
   */
  getPlan(planId: string): TaskPlan | undefined {
    return this.plans.get(planId);
  }

  /**
   * Delete a stored plan
   */
  deletePlan(planId: string): void {
    this.plans.delete(planId);
  }

  /**
   * Stop execution for a session
   */
  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isAborted = true;
      session.abortController.abort();
    }
  }

  // ============================================================================
  // IProvider Interface Methods
  // ============================================================================

  /**
   * Check if this agent is available
   * Override in subclasses if specific checks are needed
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * Initialize the agent with configuration
   * Override in subclasses if initialization is needed
   */
  async init(config?: Record<string, unknown>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config } as AgentConfig;
    }
  }

  /**
   * Shutdown the agent and cleanup resources
   */
  async shutdown(): Promise<void> {
    // Stop all active sessions
    for (const [sessionId, session] of this.sessions) {
      if (!session.isAborted) {
        await this.stop(sessionId);
      }
    }
    this.sessions.clear();
    this.plans.clear();
  }

  /**
   * Get agent capabilities
   * Override in subclasses to provide specific capabilities
   */
  getCapabilities(): AgentCapabilities {
    return {
      features: ['run', 'plan', 'execute', 'stop'],
      supportsPlan: true,
      supportsStreaming: true,
      supportsSandbox: false,
    };
  }

  /**
   * Clean up old sessions (call periodically)
   */
  protected cleanupSessions(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt.getTime() > maxAgeMs) {
        this.sessions.delete(id);
      }
    }
  }

  // Abstract methods to be implemented by providers
  abstract run(
    prompt: string,
    options?: AgentOptions
  ): AsyncGenerator<AgentMessage>;

  abstract plan(
    prompt: string,
    options?: PlanOptions
  ): AsyncGenerator<AgentMessage>;

  abstract execute(options: ExecuteOptions): AsyncGenerator<AgentMessage>;
}

/**
 * Planning instruction template with intent detection
 */
export const PLANNING_INSTRUCTION = `You are an AI assistant that helps with various tasks. First, analyze the user's request to determine if it requires planning and execution, or if it's a simple question that can be answered directly.

## INTENT DETECTION

**SIMPLE QUESTIONS (answer directly, NO planning needed):**
- Greetings: "hello", "hi", "who are you", "what can you do"
- Identity questions: "who are u", "你是谁", "what's your name"
- Capability questions: "what can you help with", "how do you work"
- General knowledge questions that don't require tools or file operations
- Conversations or chitchat

**COMPLEX TASKS (require planning):**
- File operations: create, read, modify, delete files
- Code writing or modification
- Document/presentation/spreadsheet creation
- Web searching for specific information
- Multi-step tasks that need tools

## ⚠️ CRITICAL: MANDATORY BACKUP FOR DESTRUCTIVE OPERATIONS

**EXTREMELY IMPORTANT**: Any task that involves MODIFYING, DELETING, MOVING, or RENAMING files MUST include a BACKUP step FIRST in the plan!

**Destructive operations include:**
- Deleting files or folders (rm, delete, 删除, 清空)
- Modifying/editing existing files
- Moving files (mv, move, 移动)
- Renaming files
- Clearing/emptying directories (清空, empty, clear)

**For ANY destructive operation, your plan MUST:**
1. FIRST step: Backup affected files to workspace/backup/ directory
2. THEN proceed with the actual operation

**Example - User asks "清空桌面" (clear desktop):**
\`\`\`json
{"type": "plan", "goal": "清空桌面", "steps": [{"id": "1", "description": "查看桌面文件列表"}, {"id": "2", "description": "备份桌面文件到工作区backup目录"}, {"id": "3", "description": "删除桌面所有项目"}], "notes": "所有文件将先备份到工作区，确保可恢复"}
\`\`\`

**NEVER skip the backup step for destructive operations!**

## CRITICAL: OUTPUT FORMAT

**IMPORTANT**: You are in PLANNING PHASE. You must ONLY output a structured JSON response.
- DO NOT write actual code
- DO NOT generate file contents
- DO NOT include implementation details
- DO NOT show formulas or algorithms
- ONLY describe WHAT will be done, not HOW

For **SIMPLE QUESTIONS**, respond ONLY with:
\`\`\`json
{
  "type": "direct_answer",
  "answer": "Your friendly, helpful response to the user's question"
}
\`\`\`

For **COMPLEX TASKS**, respond ONLY with:
\`\`\`json
{
  "type": "plan",
  "goal": "Clear description of what will be accomplished",
  "steps": [
    { "id": "1", "description": "Brief description of step 1" },
    { "id": "2", "description": "Brief description of step 2" },
    { "id": "3", "description": "Brief description of step 3" }
  ],
  "notes": "Any important considerations"
}
\`\`\`

## STEP GUIDELINES (for complex tasks only)
- Keep step descriptions SHORT (under 50 characters)
- Focus on WHAT, not HOW
- **For destructive ops: ALWAYS include backup step FIRST**
- Examples: "Create Python script file", "Backup files to workspace", "Delete target files"

## EXAMPLES

User: "who are u"
Response:
\`\`\`json
{"type": "direct_answer", "answer": "I'm WorkAny, an AI assistant that can help you with coding, document creation, and more!"}
\`\`\`

User: "写个脚本计算鸡兔同笼"
Response:
\`\`\`json
{"type": "plan", "goal": "创建一个Python脚本来解决鸡兔同笼问题", "steps": [{"id": "1", "description": "创建Python脚本文件 chicken_rabbit.py"}, {"id": "2", "description": "实现鸡兔同笼的数学计算逻辑"}, {"id": "3", "description": "添加输入验证和多种解法"}], "notes": "将包含代数法和枚举法两种解法"}
\`\`\`

User: "删除Downloads文件夹里的所有文件"
Response:
\`\`\`json
{"type": "plan", "goal": "删除Downloads文件夹内容", "steps": [{"id": "1", "description": "查看Downloads文件夹内容"}, {"id": "2", "description": "备份所有文件到工作区backup目录"}, {"id": "3", "description": "删除Downloads文件夹所有文件"}], "notes": "文件将先备份，可随时恢复"}
\`\`\`

**REMEMBER**: Output ONLY the JSON. No explanations, no code, no formulas before or after the JSON.

User request: `;

/**
 * Sandbox configuration for script execution
 */
export interface SandboxOptions {
  enabled: boolean;
  image?: string;
  apiEndpoint?: string;
}

/**
 * Generate workspace instruction for prompts
 */
export function getWorkspaceInstruction(
  workDir: string,
  sandbox?: SandboxOptions
): string {
  let instruction = `
## CRITICAL: Workspace Configuration
**MANDATORY OUTPUT DIRECTORY: ${workDir}**

ALL files you create MUST be saved to this directory. This is NON-NEGOTIABLE.

Rules:
1. ALWAYS use absolute paths starting with ${workDir}/
2. NEVER use any other directory (no ~/.claude/, no ~/Documents/, no /tmp/, no default paths)
3. NEVER use ~/pptx-workspace, ~/docx-workspace, ~/xlsx-workspace or similar
4. Scripts, documents, data files - EVERYTHING goes to ${workDir}/
5. Create subdirectories under ${workDir}/ if needed (e.g., ${workDir}/output/, ${workDir}/data/)

## CRITICAL: Read Before Write Rule
**ALWAYS use the Read tool before using the Write tool, even for new files.**
This is a security requirement. Before writing any file:
1. First, use the Read tool on the file path (it will show "file not found" for new files - this is expected)
2. Then, use the Write tool to create/update the file

Example workflow for creating a new file:
1. Read("${workDir}/script.py")  -> Returns error "file not found" (OK, this is expected)
2. Write("${workDir}/script.py", content)  -> Now this will succeed

## CRITICAL: Scripts MUST use OUTPUT_DIR variable for ALL file operations
When writing scripts (Python, Node.js, etc.), you MUST:
1. Define the output directory at the top of the script: \`OUTPUT_DIR = "${workDir}"\`
2. **ALWAYS create the output directory first** with os.makedirs (Python) or fs.mkdirSync (Node.js)
3. Use the OUTPUT_DIR variable (with os.path.join or path.join) for EVERY file read/write operation
4. NEVER hardcode any path - always use OUTPUT_DIR
5. NEVER use relative paths
6. NEVER use "/workspace" or any other hardcoded path

**CRITICAL**: Use OUTPUT_DIR consistently throughout the ENTIRE script. Do not define it at the top and then forget to use it later!

Python script example:
\`\`\`python
import os
OUTPUT_DIR = "${workDir}"

# IMPORTANT: Always create the output directory first!
os.makedirs(OUTPUT_DIR, exist_ok=True)

# CORRECT: Always use OUTPUT_DIR with os.path.join
output_file = os.path.join(OUTPUT_DIR, "results.json")
with open(output_file, "w") as f:
    f.write(data)

# WRONG examples (NEVER do these):
# with open("results.json", "w") as f:  # relative path
# with open("/workspace/results.json", "w") as f:  # hardcoded path
# output_file = "/workspace/results.txt"  # hardcoded path
\`\`\`

Node.js script example:
\`\`\`javascript
const fs = require('fs');
const path = require('path');
const OUTPUT_DIR = "${workDir}";

// IMPORTANT: Always create the output directory first!
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// CORRECT: Always use OUTPUT_DIR with path.join
const outputFile = path.join(OUTPUT_DIR, "results.json");
fs.writeFileSync(outputFile, data);

// WRONG examples (NEVER do these):
// fs.writeFileSync("results.json", data);  # relative path
// fs.writeFileSync("/workspace/results.json", data);  # hardcoded path
\`\`\`

Examples:
- Script: "${workDir}/crawler.py" (NOT ~/script.py)
- Output: "${workDir}/results.json" (NOT /tmp/results.json)
- Document: "${workDir}/report.docx" (NOT ~/docx-workspace/report.docx)

## ⛔ MANDATORY: BACKUP BEFORE ANY DESTRUCTIVE OPERATION

**THIS IS NON-NEGOTIABLE. FAILURE TO BACKUP IS A CRITICAL ERROR.**

Before executing ANY of these operations, you MUST backup files FIRST:
- ❌ rm / rm -rf / delete / 删除
- ❌ Overwriting files (Write tool on existing file)
- ❌ Edit tool modifications
- ❌ mv / move / 移动
- ❌ Clearing directories (清空)

### MANDATORY Backup Procedure (DO THIS FIRST!)

**Step 1: Create backup directory**
\`\`\`bash
mkdir -p "${workDir}/backup/"
\`\`\`

**Step 2: Copy ALL files to be affected**
\`\`\`bash
# For single file:
cp "/path/to/file.txt" "${workDir}/backup/file_$(date +%Y%m%d_%H%M%S).txt"

# For directory:
cp -r "/path/to/folder" "${workDir}/backup/folder_$(date +%Y%m%d_%H%M%S)"
\`\`\`

**Step 3: ONLY THEN proceed with the destructive operation**

### Example: User asks "清空桌面" (clear desktop)

CORRECT execution order:
\`\`\`bash
# 1. First, create backup directory
mkdir -p "${workDir}/backup/"

# 2. Backup ALL desktop files
cp -r ~/Desktop/* "${workDir}/backup/desktop_backup_$(date +%Y%m%d_%H%M%S)/"

# 3. ONLY NOW delete
rm -rf ~/Desktop/*
\`\`\`

WRONG (NEVER DO THIS):
\`\`\`bash
# ❌ WRONG: Deleting without backup first
rm -rf ~/Desktop/*
\`\`\`

### What REQUIRES backup:
- ✅ Deleting files or folders (rm, delete, 删除, 清空)
- ✅ Modifying existing files (Edit, Write to existing)
- ✅ Moving files (backup source before mv)
- ✅ Renaming files

### What does NOT require backup:
- Creating NEW files (nothing to backup)
- Reading files (non-destructive)

### Additional Safety for Files Outside Workspace (${workDir}/)

For paths NOT under ${workDir}/, also ask user confirmation first:
- ~/Desktop/, ~/Documents/, ~/Downloads/
- System paths: /etc/, /usr/, /var/
- Any absolute path outside workspace

`;

  // Add sandbox instructions when enabled
  if (sandbox?.enabled) {
    instruction += `
## Sandbox Mode (ENABLED)
Sandbox mode is enabled. You MUST use sandbox tools for running scripts.

**CRITICAL: PREFER Node.js SCRIPTS**
The app has a built-in Node.js runtime, but Python requires users to install it separately.
- **ALWAYS prefer writing Node.js (.js) scripts** over Python scripts
- Node.js standard library is powerful enough for most tasks (fs, path, http, https, crypto, child_process, etc.)
- Only use Python if the task specifically requires Python-only libraries (numpy, pandas, etc.)

**CRITICAL RULES**:
1. ALWAYS use \`sandbox_run_script\` to run scripts (Node.js, Python, TypeScript, etc.)
2. NEVER use Bash tool to run scripts directly (no \`node script.js\`, no \`python script.py\`)
3. After sandbox_run_script succeeds, the task is COMPLETE - do NOT run the script again with Bash
4. Scripts MUST use OUTPUT_DIR = "${workDir}" for all file operations

**Workflow**:
1. Create script file using Write tool (prefer .js files)
2. Use \`sandbox_run_script\` to execute it - THIS IS THE ONLY WAY TO RUN SCRIPTS
3. Script execution is DONE after sandbox_run_script returns

Example (Node.js - PREFERRED):
\`\`\`
sandbox_run_script:
  filePath: "${workDir}/script.js"
  workDir: "${workDir}"
  packages: ["axios"]  # optional npm packages
\`\`\`

Example (Python - only if necessary):
\`\`\`
sandbox_run_script:
  filePath: "${workDir}/script.py"
  workDir: "${workDir}"
  packages: ["requests"]  # optional pip packages
\`\`\`

**DO NOT** run the same script twice. Once sandbox_run_script completes successfully, move on to the next step.

`;
  }

  return instruction;
}

export type ResolvedLanguage = 'en-US' | 'zh-CN';

const LANGUAGE_ALIASES: Record<string, ResolvedLanguage> = {
  'en': 'en-US',
  'en-us': 'en-US',
  'english': 'en-US',
  'zh': 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'chinese': 'zh-CN',
  'cn': 'zh-CN',
};

export function detectLanguageFromText(text?: string): ResolvedLanguage {
  if (!text) return 'en-US';
  const hasCjk = /[\u3400-\u9FFF]/.test(text);
  return hasCjk ? 'zh-CN' : 'en-US';
}

export function resolveLanguage(
  language?: string,
  prompt?: string
): ResolvedLanguage {
  const normalized = language?.trim().toLowerCase();
  if (normalized) {
    const mapped = LANGUAGE_ALIASES[normalized];
    if (mapped) return mapped;
    if (normalized.startsWith('zh')) return 'zh-CN';
    if (normalized.startsWith('en')) return 'en-US';
  }
  return detectLanguageFromText(prompt);
}

export function buildLanguageInstruction(
  language?: string,
  prompt?: string
): string {
  const resolved = resolveLanguage(language, prompt);
  const label =
    resolved === 'zh-CN' ? 'Chinese (Simplified)' : 'English';
  const rule =
    resolved === 'zh-CN'
      ? '请仅使用简体中文回答，不要夹杂英文或其他语言。'
      : 'Respond only in English. Do not use Chinese or any other language.';
  return `
## LANGUAGE REQUIREMENT
- Output language: ${label}
- ${rule}
`;
}

/**
 * Format a plan for execution phase
 */
export function formatPlanForExecution(
  plan: TaskPlan,
  workDir?: string,
  sandbox?: SandboxOptions,
  language?: string,
  originalPrompt?: string
): string {
  const stepsText = plan.steps
    .map((step, index) => `${index + 1}. ${step.description}`)
    .join('\n');

  const workspaceNote = workDir
    ? getWorkspaceInstruction(workDir, sandbox)
    : '';
  const languageNote = buildLanguageInstruction(language, originalPrompt);

  return `You are executing a pre-approved plan. Follow these steps in order:
${workspaceNote}${languageNote}
Goal: ${plan.goal}

Steps:
${stepsText}

${plan.notes ? `Notes: ${plan.notes}` : ''}

Now execute this plan. You have full permissions to use all available tools.

Original request: `;
}

/**
 * Response type from planning phase
 */
export type PlanningResponse =
  | { type: 'direct_answer'; answer: string }
  | { type: 'plan'; plan: TaskPlan };

/**
 * Extract a complete JSON object from text, properly handling nested braces and strings
 */
function extractJsonObject(
  text: string,
  startIndex: number = 0
): string | undefined {
  // Find the first opening brace
  const firstBrace = text.indexOf('{', startIndex);
  if (firstBrace === -1) return undefined;

  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = firstBrace; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          return text.slice(firstBrace, i + 1);
        }
      }
    }
  }

  return undefined;
}

/**
 * Parse planning response from text - can be either a direct answer or a plan
 */
export function parsePlanningResponse(
  responseText: string
): PlanningResponse | undefined {
  // Debug: log raw response for troubleshooting
  console.log('[parsePlanningResponse] Raw response length:', responseText.length);
  console.log('[parsePlanningResponse] Raw response (first 500 chars):', responseText.slice(0, 500));

  try {
    // Try to find JSON in the response
    let jsonString: string | undefined;

    // Pattern 1: JSON in markdown code block
    const codeBlockMatch = responseText.match(
      /```(?:json)?\s*(\{[\s\S]*\})\s*```/
    );
    if (codeBlockMatch) {
      // Extract proper JSON from code block
      jsonString = extractJsonObject(codeBlockMatch[1]);
    }

    // Pattern 2: Raw JSON object - use proper extraction
    if (!jsonString) {
      // Look for JSON that starts with {"type"
      const typeIndex = responseText.indexOf('{"type"');
      if (typeIndex !== -1) {
        jsonString = extractJsonObject(responseText, typeIndex);
      }
    }

    // Pattern 3: Try to find any JSON object with "type" field
    if (!jsonString) {
      jsonString = extractJsonObject(responseText);
    }

    if (!jsonString) {
      // No JSON found - treat as direct answer if it looks like conversational text
      if (responseText.length > 0 && !responseText.includes('"steps"')) {
        return { type: 'direct_answer', answer: responseText.trim() };
      }
      return undefined;
    }

    const parsed = JSON.parse(jsonString);

    // Check if it's a direct answer
    if (parsed.type === 'direct_answer' && parsed.answer) {
      return { type: 'direct_answer', answer: parsed.answer };
    }

    // Check if it's a plan (either explicit type or implicit by having steps)
    if (
      parsed.type === 'plan' ||
      (parsed.goal && Array.isArray(parsed.steps))
    ) {
      const plan = parsePlanFromResponse(responseText);
      if (plan) {
        return { type: 'plan', plan };
      }
    }

    // Fallback: if we have parsed JSON but didn't match any type, check for answer field
    if (parsed && typeof parsed.answer === 'string') {
      return { type: 'direct_answer', answer: parsed.answer };
    }

    return undefined;
  } catch (error) {
    console.error('Failed to parse planning response:', error);
    console.log('[parsePlanningResponse] Attempting fallback strategies...');
    // Fallback: try multiple strategies to extract answer

    // Strategy 1: Find "answer": and extract until the end of the JSON string
    try {
      const answerIndex = responseText.indexOf('"answer"');
      if (answerIndex !== -1) {
        // Find the start of the string value (after "answer": ")
        const colonIndex = responseText.indexOf(':', answerIndex);
        if (colonIndex !== -1) {
          const quoteStart = responseText.indexOf('"', colonIndex + 1);
          if (quoteStart !== -1) {
            // Extract string content by tracking escape sequences
            let content = '';
            let i = quoteStart + 1;
            while (i < responseText.length) {
              const char = responseText[i];
              if (char === '\\' && i + 1 < responseText.length) {
                const nextChar = responseText[i + 1];
                if (nextChar === 'n') {
                  content += '\n';
                } else if (nextChar === '"') {
                  content += '"';
                } else if (nextChar === '\\') {
                  content += '\\';
                } else if (nextChar === 't') {
                  content += '\t';
                } else if (nextChar === 'r') {
                  content += '\r';
                } else {
                  content += nextChar;
                }
                i += 2;
              } else if (char === '"') {
                // End of string
                break;
              } else {
                content += char;
                i++;
              }
            }
            if (content.length > 0) {
              console.log('[parsePlanningResponse] Strategy 1 succeeded, extracted', content.length, 'chars');
              return { type: 'direct_answer', answer: content };
            }
          }
        }
      }
    } catch (e) {
      console.log('[parsePlanningResponse] Strategy 1 failed:', e);
    }

    // Strategy 2: Find "answer": " and extract everything until the last "} or "}
    try {
      // Match "answer": " or "answer" : "
      const answerStartMatch = responseText.match(/"answer"\s*:\s*"/);
      if (answerStartMatch && answerStartMatch.index !== undefined) {
        const contentStart = answerStartMatch.index + answerStartMatch[0].length;
        // Find the ending - look for "} at the end of the text
        let contentEnd = responseText.length;

        // Try to find the closing pattern: "}``` or "} or just "
        const endPatterns = ['"}```', '"\n}', '"}', '"```'];
        for (const pattern of endPatterns) {
          const idx = responseText.lastIndexOf(pattern);
          if (idx > contentStart) {
            contentEnd = idx;
            break;
          }
        }

        let content = responseText.slice(contentStart, contentEnd);
        // Unescape common JSON escape sequences
        content = content
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');

        if (content.length > 0) {
          console.log('[parsePlanningResponse] Strategy 2 succeeded, extracted', content.length, 'chars');
          return { type: 'direct_answer', answer: content };
        }
      }
    } catch (e) {
      console.log('[parsePlanningResponse] Strategy 2 failed:', e);
    }

    // Strategy 3: Strip all JSON markers and return raw text
    let strippedText = responseText
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .replace(/^\s*\{\s*/m, '')
      .replace(/\s*\}\s*$/m, '')
      .replace(/"type"\s*:\s*"direct_answer"\s*,?\s*/g, '')
      .replace(/"answer"\s*:\s*"/g, '')
      .replace(/"\s*$/g, '')
      .trim();

    // Unescape
    strippedText = strippedText
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');

    if (strippedText.length > 10 && !strippedText.includes('"steps"')) {
      console.log('[parsePlanningResponse] Strategy 3 succeeded, extracted', strippedText.length, 'chars');
      return { type: 'direct_answer', answer: strippedText };
    }

    console.log('[parsePlanningResponse] All strategies failed');
    return undefined;
  }
}

/**
 * Parse plan JSON from response text
 */
export function parsePlanFromResponse(
  responseText: string
): TaskPlan | undefined {
  try {
    // Try multiple patterns to find JSON in the response
    let jsonString: string | undefined;

    // Pattern 1: JSON in markdown code block
    const codeBlockMatch = responseText.match(
      /```(?:json)?\s*(\{[\s\S]*\})\s*```/
    );
    if (codeBlockMatch) {
      jsonString = extractJsonObject(codeBlockMatch[1]);
    }

    // Pattern 2: Look for JSON with goal and steps
    if (!jsonString) {
      // Find a JSON object that contains "goal"
      const goalIndex = responseText.indexOf('"goal"');
      if (goalIndex !== -1) {
        // Search backward for the opening brace
        let startIndex = goalIndex;
        while (startIndex > 0 && responseText[startIndex] !== '{') {
          startIndex--;
        }
        if (responseText[startIndex] === '{') {
          jsonString = extractJsonObject(responseText, startIndex);
        }
      }
    }

    // Pattern 3: Try to find any JSON object
    if (!jsonString) {
      jsonString = extractJsonObject(responseText);
    }

    if (!jsonString) {
      console.error('No plan JSON found in response');
      console.error('Response text:', responseText.slice(0, 500));
      return undefined;
    }

    const parsed = JSON.parse(jsonString);

    // Validate the parsed object has required fields
    if (!parsed.goal || !Array.isArray(parsed.steps)) {
      console.error('Parsed JSON missing required fields');
      return undefined;
    }

    // Filter out empty or too vague steps
    const validSteps = (parsed.steps || [])
      .filter((step: { description?: string }) => {
        const desc = step.description?.toLowerCase() || '';
        // Filter out generic/vague steps
        return (
          desc.length > 10 &&
          !desc.includes('execute the task') &&
          !desc.includes('do the work') &&
          !desc.includes('complete the request')
        );
      })
      .map((step: { id?: string; description?: string }, index: number) => ({
        id: step.id || String(index + 1),
        description: step.description || 'Unknown step',
        status: 'pending' as const,
      }));

    // If no valid steps after filtering, keep original steps
    const finalSteps =
      validSteps.length > 0
        ? validSteps
        : (parsed.steps || []).map(
            (step: { id?: string; description?: string }, index: number) => ({
              id: step.id || String(index + 1),
              description: step.description || 'Unknown step',
              status: 'pending' as const,
            })
          );

    return {
      id: nanoid(),
      goal: parsed.goal || 'Unknown goal',
      steps: finalSteps,
      notes: parsed.notes,
      createdAt: new Date(),
    };
  } catch (error) {
    console.error('Failed to parse plan:', error);
    console.error('Response text:', responseText.slice(0, 500));
    return undefined;
  }
}

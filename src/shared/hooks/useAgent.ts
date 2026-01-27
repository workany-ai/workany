import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL, API_PORT } from '@/config';
import { translations, type Language } from '@/config/locale';
import {
  createFile,
  createMessage,
  createTask,
  getMessagesByTaskId,
  getTask,
  updateTask,
  updateTaskFromMessage,
  type FileType,
  type Task,
} from '@/shared/db';
import { getSettings } from '@/shared/db/settings';
import {
  loadAttachments,
  saveAttachments,
  type AttachmentReference,
} from '@/shared/lib/attachments';
import {
  addBackgroundTask,
  getBackgroundTask,
  removeBackgroundTask,
  subscribeToBackgroundTasks,
  updateBackgroundTaskStatus,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { getAppDataDir } from '@/shared/lib/paths';

const AGENT_SERVER_URL = API_BASE_URL;

// Helper to get current language translations
function getErrorMessages() {
  const settings = getSettings();
  const lang = (settings.language || 'zh-CN') as Language;
  return (
    translations[lang]?.common?.errors || translations['zh-CN'].common.errors
  );
}

console.log(
  `[API] Environment: ${import.meta.env.PROD ? 'production' : 'development'}, Port: ${API_PORT}`
);

// Helper to format fetch errors with more details (user-friendly, localized)
function formatFetchError(error: unknown, _endpoint: string): string {
  const err = error as Error;
  const message = err.message || String(error);
  const t = getErrorMessages();

  // Common error patterns - use friendly messages
  if (
    message === 'Load failed' ||
    message === 'Failed to fetch' ||
    message.includes('NetworkError')
  ) {
    return t.connectionFailedFinal;
  }

  if (message.includes('CORS') || message.includes('cross-origin')) {
    return t.corsError;
  }

  if (message.includes('timeout') || message.includes('Timeout')) {
    return t.timeout;
  }

  if (message.includes('ECONNREFUSED')) {
    return t.serverNotRunning;
  }

  // Return generic message for other errors
  return t.requestFailed.replace('{message}', message);
}

// Fetch with retry logic for better resilience
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<Response> {
  let lastError: Error | null = null;
  const t = getErrorMessages();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      lastError = error as Error;
      const errorMessage = lastError.message || '';

      // Don't retry if aborted
      if (lastError.name === 'AbortError') {
        throw lastError;
      }

      // Only retry on network errors
      const isNetworkError =
        errorMessage === 'Load failed' ||
        errorMessage === 'Failed to fetch' ||
        errorMessage.includes('NetworkError') ||
        errorMessage.includes('ECONNREFUSED');

      if (!isNetworkError) {
        throw lastError;
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries - 1) {
        const delay = retryDelay * Math.pow(2, attempt);
        const retryMsg = t.retrying
          .replace('{attempt}', String(attempt + 1))
          .replace('{max}', String(maxRetries));
        console.log(`[useAgent] ${retryMsg} (${delay}ms)`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Fetch failed after retries');
}

// Helper to get model configuration from settings
function getModelConfig():
  | { apiKey?: string; baseUrl?: string; model?: string }
  | undefined {
  try {
    const settings = getSettings();

    console.log('[useAgent] getModelConfig called:', {
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
      providersCount: settings.providers.length,
    });

    // Check if settings appear to be default (not loaded from storage)
    // This helps diagnose issues where user settings are not being loaded
    if (
      settings.defaultProvider === 'default' &&
      settings.providers.length === 2 &&
      settings.providers.every((p) => !p.apiKey)
    ) {
      console.warn(
        '[useAgent] WARNING: Settings appear to be defaults. ' +
          'If you configured a custom API provider, it may not have been loaded correctly. ' +
          'Check browser console for [Settings] logs to diagnose the issue.'
      );
    }

    // If using "default" provider, return undefined to use environment variables
    if (settings.defaultProvider === 'default') {
      console.log('[useAgent] Using default provider (environment variables)');
      return undefined;
    }

    const provider = settings.providers.find(
      (p) => p.id === settings.defaultProvider
    );

    console.log(
      '[useAgent] Found provider:',
      provider
        ? {
            id: provider.id,
            name: provider.name,
            hasApiKey: !!provider.apiKey,
            hasBaseUrl: !!provider.baseUrl,
          }
        : 'NOT FOUND'
    );

    if (!provider) return undefined;

    // Only return config if we have custom settings
    const config: { apiKey?: string; baseUrl?: string; model?: string } = {};

    if (provider.apiKey) {
      config.apiKey = provider.apiKey;
    }
    if (provider.baseUrl) {
      config.baseUrl = provider.baseUrl;
    }
    if (settings.defaultModel) {
      config.model = settings.defaultModel;
    }

    // Return undefined if no custom config
    if (!config.apiKey && !config.baseUrl && !config.model) {
      console.log('[useAgent] No custom config found, returning undefined');
      return undefined;
    }

    console.log('[useAgent] Returning modelConfig:', {
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    });

    return config;
  } catch (error) {
    console.error('[useAgent] getModelConfig error:', error);
    return undefined;
  }
}

// Helper to get sandbox configuration from settings
function getSandboxConfig():
  | { enabled: boolean; provider?: string; apiEndpoint?: string }
  | undefined {
  try {
    const settings = getSettings();

    // More detailed logging for debugging production issues
    console.log('[useAgent] getSandboxConfig - Full settings check:', {
      sandboxEnabled: settings.sandboxEnabled,
      sandboxEnabledType: typeof settings.sandboxEnabled,
      defaultSandboxProvider: settings.defaultSandboxProvider,
      hasSettings: !!settings,
      settingsKeys: Object.keys(settings),
    });

    // Only return if sandbox is enabled
    if (!settings.sandboxEnabled) {
      console.warn(
        '[useAgent] ⚠️ Sandbox is DISABLED in settings - sandboxEnabled:',
        settings.sandboxEnabled
      );
      return undefined;
    }

    const config = {
      enabled: true,
      provider: settings.defaultSandboxProvider, // Use selected sandbox provider
      apiEndpoint: AGENT_SERVER_URL, // Use the same server
    };

    console.log('[useAgent] ✅ Sandbox ENABLED, returning config:', config);
    return config;
  } catch (error) {
    console.error('[useAgent] ❌ Error getting sandbox config:', error);
    return undefined;
  }
}

// Helper to get skills configuration from settings
function getSkillsConfig():
  | {
      enabled: boolean;
      userDirEnabled: boolean;
      appDirEnabled: boolean;
      skillsPath?: string;
    }
  | undefined {
  try {
    const settings = getSettings();

    // If global switch is off, return undefined (no skills)
    if (settings.skillsEnabled === false) {
      console.log('[useAgent] Skills disabled globally');
      return undefined;
    }

    const config = {
      enabled: true,
      userDirEnabled: settings.skillsUserDirEnabled !== false,
      appDirEnabled: settings.skillsAppDirEnabled !== false,
      skillsPath: settings.skillsPath || undefined,
    };

    console.log('[useAgent] Skills config:', config);
    return config;
  } catch {
    return undefined;
  }
}

// Helper to get MCP configuration from settings
function getMcpConfig():
  | {
      enabled: boolean;
      userDirEnabled: boolean;
      appDirEnabled: boolean;
      mcpConfigPath?: string;
    }
  | undefined {
  try {
    const settings = getSettings();

    // If global switch is off, return undefined (no MCP)
    if (settings.mcpEnabled === false) {
      console.log('[useAgent] MCP disabled globally');
      return undefined;
    }

    const config = {
      enabled: true,
      userDirEnabled: settings.mcpUserDirEnabled !== false,
      appDirEnabled: settings.mcpAppDirEnabled !== false,
      mcpConfigPath: settings.mcpConfigPath || undefined,
    };

    console.log('[useAgent] MCP config:', config);
    return config;
  } catch {
    return undefined;
  }
}

export interface PermissionRequest {
  id: string;
  tool: string;
  command?: string;
  description: string;
  risk_level?: 'low' | 'medium' | 'high';
}

// Question types for AskUserQuestion tool
export interface QuestionOption {
  label: string;
  description: string;
}

export interface AgentQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface PendingQuestion {
  id: string;
  toolUseId: string;
  questions: AgentQuestion[];
}

// Attachment type for messages with images/files
export interface MessageAttachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  data: string; // Base64 data for images
  mimeType?: string;
  path?: string; // File path when loaded from disk
  isLoading?: boolean; // True when attachment is being loaded
}

export interface AgentMessage {
  type:
    | 'text'
    | 'tool_use'
    | 'tool_result'
    | 'result'
    | 'error'
    | 'session'
    | 'done'
    | 'user'
    | 'permission_request'
    | 'plan'
    | 'direct_answer';
  content?: string;
  name?: string;
  id?: string; // tool_use id
  input?: unknown;
  subtype?: string;
  cost?: number;
  duration?: number;
  message?: string;
  sessionId?: string;
  // Permission request fields
  permission?: PermissionRequest;
  // Tool result fields
  toolUseId?: string;
  output?: string;
  isError?: boolean;
  // Plan fields
  plan?: TaskPlan;
  // Attachments for user messages (images, files)
  attachments?: MessageAttachment[];
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  notes?: string;
  createdAt?: Date;
}

// Conversation message format for API
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  imagePaths?: string[]; // Image file paths for context
}

export type AgentPhase =
  | 'idle'
  | 'planning'
  | 'awaiting_approval'
  | 'executing';

export interface SessionInfo {
  sessionId: string;
  taskIndex: number;
}

export interface UseAgentReturn {
  messages: AgentMessage[];
  isRunning: boolean;
  taskId: string | null;
  sessionId: string | null;
  taskIndex: number;
  sessionFolder: string | null;
  taskFolder: string | null; // Full path to current task folder (sessionFolder/task-XX)
  filesVersion: number; // Incremented when files are added (e.g., attachments saved)
  pendingPermission: PermissionRequest | null;
  pendingQuestion: PendingQuestion | null;
  // Two-phase planning
  phase: AgentPhase;
  plan: TaskPlan | null;
  runAgent: (
    prompt: string,
    existingTaskId?: string,
    sessionInfo?: SessionInfo,
    attachments?: MessageAttachment[]
  ) => Promise<string>;
  approvePlan: () => Promise<void>;
  rejectPlan: () => void;
  continueConversation: (
    reply: string,
    attachments?: MessageAttachment[]
  ) => Promise<void>;
  stopAgent: () => Promise<void>;
  clearMessages: () => void;
  loadTask: (taskId: string) => Promise<Task | null>;
  loadMessages: (taskId: string) => Promise<void>;
  respondToPermission: (
    permissionId: string,
    approved: boolean
  ) => Promise<void>;
  respondToQuestion: (
    questionId: string,
    answers: Record<string, string>
  ) => Promise<void>;
  setSessionInfo: (sessionId: string, taskIndex: number) => void;
  // Background tasks
  backgroundTasks: BackgroundTask[];
  runningBackgroundTaskCount: number;
}

// Helper to determine file type from file extension
function getFileTypeFromPath(path: string): FileType {
  const ext = path.split('.').pop()?.toLowerCase() || '';

  // Code files
  if (
    [
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'go',
      'rs',
      'java',
      'c',
      'cpp',
      'h',
      'hpp',
      'cs',
      'rb',
      'php',
      'swift',
      'kt',
      'scala',
      'sh',
      'bash',
      'zsh',
      'ps1',
      'sql',
    ].includes(ext)
  ) {
    return 'code';
  }

  // Image files
  if (
    ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext)
  ) {
    return 'image';
  }

  // Presentation files
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) {
    return 'presentation';
  }

  // Spreadsheet files
  if (['xls', 'xlsx', 'numbers', 'ods'].includes(ext)) {
    return 'spreadsheet';
  }

  // Document files
  if (['md', 'pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) {
    return 'document';
  }

  // Text files (config, data)
  if (
    [
      'json',
      'yaml',
      'yml',
      'xml',
      'toml',
      'ini',
      'conf',
      'cfg',
      'env',
      'csv',
      'tsv',
    ].includes(ext)
  ) {
    return 'text';
  }

  // HTML files
  if (['html', 'htm'].includes(ext)) {
    return 'website';
  }

  // Default to text
  return 'text';
}

// Extract file paths from text content (for text messages that mention file paths)
async function extractFilesFromText(
  taskId: string,
  textContent: string
): Promise<void> {
  if (!textContent) return;

  try {
    // Patterns to match file paths in text
    const filePatterns = [
      // Match paths in backticks with common document extensions
      /`([^`]+\.(?:pptx|xlsx|docx|pdf))`/gi,
      // Match absolute paths with Chinese/unicode support
      /(\/[^\s"'`\n]*[\u4e00-\u9fff][^\s"'`\n]*\.(?:pptx|xlsx|docx|pdf))/gi,
      // Match standard absolute paths
      /(\/(?:Users|home|tmp|var)[^\s"'`\n]+\.(?:pptx|xlsx|docx|pdf))/gi,
    ];

    const detectedFiles = new Set<string>();

    for (const pattern of filePatterns) {
      const matches = textContent.matchAll(pattern);
      for (const match of matches) {
        const filePath = match[1] || match[0];
        if (filePath && !detectedFiles.has(filePath)) {
          detectedFiles.add(filePath);
          const fileName = filePath.split('/').pop() || filePath;
          const fileType = getFileTypeFromPath(filePath);

          await createFile({
            task_id: taskId,
            name: fileName,
            type: fileType,
            path: filePath,
            preview: `File mentioned in response`,
          });
          console.log(
            '[useAgent] Created file record from text message:',
            fileName
          );
        }
      }
    }
  } catch (error) {
    console.error('[useAgent] Failed to extract files from text:', error);
  }
}

// Extract file info from tool use messages and create file records
async function extractAndSaveFiles(
  taskId: string,
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  toolOutput: string | undefined
): Promise<void> {
  if (!toolInput) return;

  try {
    // Handle Write tool - creates new files
    if (toolName === 'Write' && toolInput.file_path) {
      const filePath = String(toolInput.file_path);
      const fileName = filePath.split('/').pop() || filePath;
      const content = toolInput.content ? String(toolInput.content) : '';
      const preview = content.slice(0, 500);
      const fileType = getFileTypeFromPath(filePath);

      await createFile({
        task_id: taskId,
        name: fileName,
        type: fileType,
        path: filePath,
        preview: preview || undefined,
      });
      console.log('[useAgent] Created file record for Write:', fileName);
    }

    // Handle Edit tool - modifies existing files
    if (toolName === 'Edit' && toolInput.file_path) {
      const filePath = String(toolInput.file_path);
      const fileName = filePath.split('/').pop() || filePath;
      const newContent = toolInput.new_string
        ? String(toolInput.new_string)
        : '';
      const fileType = getFileTypeFromPath(filePath);

      await createFile({
        task_id: taskId,
        name: `${fileName} (edited)`,
        type: fileType,
        path: filePath,
        preview: newContent.slice(0, 500) || undefined,
      });
      console.log('[useAgent] Created file record for Edit:', fileName);
    }

    // Handle WebFetch tool - captures web content
    if (toolName === 'WebFetch' && toolInput.url) {
      const url = String(toolInput.url);
      const title = url.replace(/^https?:\/\//, '').slice(0, 60);

      await createFile({
        task_id: taskId,
        name: title,
        type: 'website',
        path: url,
        preview: toolOutput?.slice(0, 500) || undefined,
      });
      console.log('[useAgent] Created file record for WebFetch:', title);
    }

    // Handle WebSearch tool - captures search results
    if (toolName === 'WebSearch' && toolInput.query) {
      const query = String(toolInput.query);

      await createFile({
        task_id: taskId,
        name: `Search: ${query.slice(0, 50)}`,
        type: 'text',
        path: `search://${encodeURIComponent(query)}`,
        preview: toolOutput?.slice(0, 500) || undefined,
      });
      console.log('[useAgent] Created file record for WebSearch:', query);
    }

    // Handle Bash tool - capture command outputs and detect generated files
    if (toolName === 'Bash' && toolInput.command) {
      const command = String(toolInput.command);
      const detectedBashFiles = new Set<string>();

      // Check if this is a file generation command (pptx, pdf, etc.)
      const filePatterns = [
        /saved?\s+(?:to\s+)?["']?([^\s"']+\.(?:pptx|xlsx|docx|pdf))["']?/i,
        /(?:created|generated|wrote|output)\s+["']?([^\s"']+\.(?:pptx|xlsx|docx|pdf))["']?/i,
        /writeFile\s*\(\s*["']([^"']+\.(?:pptx|xlsx|docx|pdf))["']/i,
        // Match any absolute path to pptx/xlsx/docx/pdf files
        /(\/[^\s"'`\n]+\.(?:pptx|xlsx|docx|pdf))/gi,
        // Match paths in backticks
        /`([^`]+\.(?:pptx|xlsx|docx|pdf))`/gi,
      ];

      if (toolOutput) {
        for (const pattern of filePatterns) {
          const matches = toolOutput.matchAll(pattern);
          for (const match of matches) {
            const filePath = match[1] || match[0];
            if (filePath && !detectedBashFiles.has(filePath)) {
              detectedBashFiles.add(filePath);
              const fileName = filePath.split('/').pop() || filePath;
              const fileType = getFileTypeFromPath(filePath);

              await createFile({
                task_id: taskId,
                name: fileName,
                type: fileType,
                path: filePath,
                preview: `Generated by command: ${command.slice(0, 100)}`,
              });
              console.log(
                '[useAgent] Created file record for generated file:',
                fileName
              );
            }
          }
        }
      }
    }

    // Handle Skill tool - capture skill outputs and detect generated files
    if (toolName === 'Skill' && toolOutput) {
      // Try to detect file paths in skill output
      const filePatterns = [
        /(?:saved?|created|generated|wrote|output)\s+(?:to\s+)?["']?([^\s"'\n]+\.(?:pptx|xlsx|docx|pdf|png|jpg|html))["']?/gi,
        /(?:file|output|presentation|document):\s*["']?([^\s"'\n]+\.(?:pptx|xlsx|docx|pdf|png|jpg|html))["']?/gi,
        // Match any absolute path to these file types
        /(\/[^\s"'`\n]+\.(?:pptx|xlsx|docx|pdf))/gi,
        // Match paths in backticks
        /`([^`]+\.(?:pptx|xlsx|docx|pdf))`/gi,
        // Match Chinese/unicode paths
        /(\/[^\s"'\n]*[\u4e00-\u9fff][^\s"'\n]*\.(?:pptx|xlsx|docx|pdf))/gi,
      ];

      const detectedFiles = new Set<string>();

      for (const pattern of filePatterns) {
        const matches = toolOutput.matchAll(pattern);
        for (const match of matches) {
          const filePath = match[1] || match[0];
          if (filePath && !detectedFiles.has(filePath)) {
            detectedFiles.add(filePath);
            const fileName = filePath.split('/').pop() || filePath;
            const fileType = getFileTypeFromPath(filePath);

            await createFile({
              task_id: taskId,
              name: fileName,
              type: fileType,
              path: filePath,
              preview: `Generated by skill: ${toolInput.skill || 'unknown'}`,
            });
            console.log(
              '[useAgent] Created file record from Skill output:',
              fileName
            );
          }
        }
      }
    }
  } catch (error) {
    console.error('[useAgent] Failed to extract and save file:', error);
  }
}

// Build conversation history from messages
function buildConversationHistory(
  initialPrompt: string,
  messages: AgentMessage[]
): ConversationMessage[] {
  const history: ConversationMessage[] = [];

  // Add initial user prompt
  if (initialPrompt) {
    history.push({ role: 'user', content: initialPrompt });
  }

  // Process messages to build conversation
  let currentAssistantContent = '';

  for (const msg of messages) {
    if (msg.type === 'user') {
      // Before adding user message, flush any accumulated assistant content
      if (currentAssistantContent) {
        history.push({
          role: 'assistant',
          content: currentAssistantContent.trim(),
        });
        currentAssistantContent = '';
      }

      // Extract image paths from attachments if present
      const imagePaths = msg.attachments
        ?.filter((a) => a.type === 'image' && a.path)
        .map((a) => a.path as string);

      history.push({
        role: 'user',
        content: msg.content || '',
        imagePaths:
          imagePaths && imagePaths.length > 0 ? imagePaths : undefined,
      });
    } else if (msg.type === 'text') {
      // Accumulate assistant text
      currentAssistantContent += (msg.content || '') + '\n';
    } else if (msg.type === 'tool_use') {
      // Include tool use as part of assistant's response
      currentAssistantContent += `[Used tool: ${msg.name}]\n`;
    }
  }

  // Flush remaining assistant content
  if (currentAssistantContent) {
    history.push({
      role: 'assistant',
      content: currentAssistantContent.trim(),
    });
  }

  // Apply history length limit - keep only the most recent messages
  // Get max conversation turns from settings, fallback to default
  const settings = getSettings();
  const maxTurns = settings.maxConversationTurns || 20;
  const maxMessages = maxTurns * 2; // 2 messages per turn (user + assistant)

  if (history.length > maxMessages) {
    console.log(
      `[buildConversationHistory] Truncating history from ${history.length} to ${maxMessages} messages (max turns: ${maxTurns})`
    );
    return history.slice(-maxMessages);
  }

  return history;
}

export function useAgent(): UseAgentReturn {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<string>('');
  const [pendingPermission, setPendingPermission] =
    useState<PermissionRequest | null>(null);
  const [pendingQuestion, setPendingQuestion] =
    useState<PendingQuestion | null>(null);
  const [phase, setPhase] = useState<AgentPhase>('idle');
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  // Session management
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentTaskIndex, setCurrentTaskIndex] = useState<number>(1);
  // Track file changes to trigger refresh in UI
  const [filesVersion, setFilesVersion] = useState<number>(0);
  const [sessionFolder, setSessionFolder] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null); // Backend session ID for API calls
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeTaskIdRef = useRef<string | null>(null); // Track which task is currently active (for message isolation)
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null); // For polling messages when restored from background
  // Use refs to track current values for callbacks (to avoid stale closures)
  const taskIdRef = useRef<string | null>(null);
  const isRunningRef = useRef<boolean>(false);
  const initialPromptRef = useRef<string>('');

  // Keep refs in sync with state (for use in callbacks to avoid stale closures)
  useEffect(() => {
    taskIdRef.current = taskId;
  }, [taskId]);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    initialPromptRef.current = initialPrompt;
  }, [initialPrompt]);

  // Helper to set session info
  const setSessionInfo = useCallback((sessionId: string, taskIndex: number) => {
    setCurrentSessionId(sessionId);
    setCurrentTaskIndex(taskIndex);
  }, []);

  // Load existing task from database
  // This function handles task switching (moving running task to background)
  // and loading task metadata. Message loading and background restoration is done by loadMessages.
  const loadTask = useCallback(async (id: string): Promise<Task | null> => {
    // If there's a running task, move it to background instead of aborting
    // Use refs to get current values (avoid stale closures)
    const currentTaskId = taskIdRef.current;
    const currentIsRunning = isRunningRef.current;
    const currentPrompt = initialPromptRef.current;

    if (
      abortControllerRef.current &&
      currentTaskId &&
      currentIsRunning &&
      currentTaskId !== id
    ) {
      console.log('[useAgent] Moving task to background:', currentTaskId);
      addBackgroundTask({
        taskId: currentTaskId,
        sessionId: sessionIdRef.current || '',
        abortController: abortControllerRef.current,
        isRunning: true,
        prompt: currentPrompt,
      });
      // Clear refs but don't abort - task continues in background
      abortControllerRef.current = null;
      sessionIdRef.current = null;

      // Clear UI state for the old task
      setMessages([]);
      setPendingPermission(null);
      setPendingQuestion(null);
      setPlan(null);
    }

    // Stop any existing polling from previous task
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    // Set this as the active task
    activeTaskIdRef.current = id;

    // Note: Background restoration and running state is handled by loadMessages
    // Don't set isRunning here - let loadMessages determine the correct state

    try {
      const task = await getTask(id);
      if (task) {
        setInitialPrompt(task.prompt);

        // Set session info if available from the task
        if (task.session_id) {
          setCurrentSessionId(task.session_id);
          setCurrentTaskIndex(task.task_index || 1);

          // Compute and set session folder
          try {
            const appDir = await getAppDataDir();
            const computedSessionFolder = `${appDir}/sessions/${task.session_id}`;
            setSessionFolder(computedSessionFolder);
            console.log(
              '[useAgent] Loaded sessionFolder from task:',
              computedSessionFolder
            );
          } catch (error) {
            console.error('Failed to compute session folder:', error);
          }
        }
      }
      return task;
    } catch (error) {
      console.error('Failed to load task:', error);
      return null;
    }
  }, []);

  // Load existing messages from database
  const loadMessages = useCallback(async (id: string): Promise<void> => {
    // Note: Task switching logic is handled by loadTask, not here
    // This function just loads messages for the specified task

    // Check if the task we're loading is running in background
    const backgroundTask = getBackgroundTask(id);
    const isRestoringFromBackground =
      backgroundTask && backgroundTask.isRunning;

    if (isRestoringFromBackground) {
      console.log(
        '[useAgent] Task is running in background (loadMessages), restoring:',
        id
      );
      abortControllerRef.current = backgroundTask.abortController;
      sessionIdRef.current = backgroundTask.sessionId;

      // Check if the abort controller is still valid (stream still running)
      if (abortControllerRef.current.signal.aborted) {
        console.log('[useAgent] Background task was already completed/aborted');
        setIsRunning(false);
        setPhase('idle');
        abortControllerRef.current = null;
        removeBackgroundTask(id);
      } else {
        setIsRunning(true);
        setPhase('executing'); // Note: might not be accurate if task was in planning phase
        removeBackgroundTask(id);

        // Start polling for new messages (messages will be loaded immediately below)
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
        }
        const pollingTaskId = id;
        let lastMessageCount = 0;
        let stuckCount = 0; // Count how many polls without new messages
        // Long timeout for stuck detection - tools like Bash can take minutes
        const MAX_STUCK_COUNT = 300; // Stop after 5 minutes of no progress

        refreshIntervalRef.current = setInterval(async () => {
          const isStillActive = activeTaskIdRef.current === pollingTaskId;

          // Check abort signal
          if (
            !abortControllerRef.current ||
            abortControllerRef.current.signal.aborted
          ) {
            if (refreshIntervalRef.current) {
              clearInterval(refreshIntervalRef.current);
              refreshIntervalRef.current = null;
            }
            if (isStillActive) {
              setIsRunning(false);
              setPhase('idle');
            }
            return;
          }

          // Also check task status in database - it might have completed
          try {
            const taskStatus = await getTask(pollingTaskId);
            if (
              taskStatus &&
              ['completed', 'error', 'stopped'].includes(taskStatus.status)
            ) {
              console.log(
                '[useAgent] Task completed in database, stopping poll:',
                taskStatus.status
              );
              if (refreshIntervalRef.current) {
                clearInterval(refreshIntervalRef.current);
                refreshIntervalRef.current = null;
              }
              if (isStillActive) {
                setIsRunning(false);
                setPhase('idle');
              }
              return;
            }
          } catch (error) {
            console.error('[useAgent] Failed to check task status:', error);
          }

          if (isStillActive) {
            // Refresh messages from database
            try {
              const dbMessages = await getMessagesByTaskId(pollingTaskId);
              const agentMessages: AgentMessage[] = dbMessages.map((msg) => ({
                type: msg.type as AgentMessage['type'],
                content: msg.content || undefined,
                name: msg.tool_name || undefined,
                input: msg.tool_input ? JSON.parse(msg.tool_input) : undefined,
                output: msg.tool_output || undefined,
                toolUseId: msg.tool_use_id || undefined,
                subtype: msg.subtype as AgentMessage['subtype'],
                message: msg.error_message || undefined,
              }));
              setMessages(agentMessages);

              // Check if there are pending tools (tool_use without matching tool_result)
              const toolUseIds = new Set<string>();
              const toolResultIds = new Set<string>();
              for (const msg of dbMessages) {
                if (msg.type === 'tool_use' && msg.tool_use_id) {
                  toolUseIds.add(msg.tool_use_id);
                } else if (msg.type === 'tool_result' && msg.tool_use_id) {
                  toolResultIds.add(msg.tool_use_id);
                }
              }
              const hasPendingTools = [...toolUseIds].some(
                (id) => !toolResultIds.has(id)
              );

              // Check if we're stuck (no new messages for too long AND no pending tools)
              if (dbMessages.length === lastMessageCount) {
                // Only count as stuck if there are no pending tools
                if (!hasPendingTools) {
                  stuckCount++;
                  if (stuckCount >= MAX_STUCK_COUNT) {
                    console.log(
                      '[useAgent] Task appears stuck, stopping poll after',
                      MAX_STUCK_COUNT,
                      'seconds'
                    );
                    if (refreshIntervalRef.current) {
                      clearInterval(refreshIntervalRef.current);
                      refreshIntervalRef.current = null;
                    }
                    setIsRunning(false);
                    setPhase('idle');
                    return;
                  }
                } else {
                  // Tools are pending, reset stuck counter
                  stuckCount = 0;
                }
              } else {
                // Got new messages, reset stuck counter
                stuckCount = 0;
                lastMessageCount = dbMessages.length;
              }
            } catch (error) {
              console.error('[useAgent] Failed to refresh messages:', error);
            }
          }
        }, 1000);
      }
    } else {
      // Task is NOT running in background - it's a completed/stopped task
      // Reset running state to ensure we don't show running indicators
      console.log('[useAgent] Loading messages for completed task:', id);
      setIsRunning(false);
      setPhase('idle');
      abortControllerRef.current = null;

      // Stop any existing polling
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    }

    // Set this as the active task
    activeTaskIdRef.current = id;

    try {
      const dbMessages = await getMessagesByTaskId(id);

      // First pass: identify user messages with attachments that need loading
      const attachmentLoadTasks: {
        index: number;
        refs: AttachmentReference[];
      }[] = [];

      for (let i = 0; i < dbMessages.length; i++) {
        const msg = dbMessages[i];
        if (msg.type === 'user' && msg.attachments) {
          try {
            const refs = JSON.parse(msg.attachments) as AttachmentReference[];
            // Check if it's the new format (has path)
            if (refs.length > 0 && 'path' in refs[0]) {
              attachmentLoadTasks.push({ index: i, refs });
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Build agent messages immediately with placeholder attachments
      const agentMessages: AgentMessage[] = [];
      for (let i = 0; i < dbMessages.length; i++) {
        const msg = dbMessages[i];
        if (msg.type === 'user') {
          // Check if this message has attachments to load
          const loadTask = attachmentLoadTasks.find((t) => t.index === i);
          let attachments: MessageAttachment[] | undefined;

          if (loadTask) {
            // Create placeholder attachments (loading state)
            attachments = loadTask.refs.map((ref) => ({
              id: ref.id,
              type: ref.type,
              name: ref.name,
              data: '', // Empty data, will be loaded later
              mimeType: ref.mimeType,
              path: ref.path,
              isLoading: true,
            }));
          } else if (msg.attachments) {
            // Try old format
            try {
              const refs = JSON.parse(msg.attachments) as AttachmentReference[];
              if (refs.length > 0 && !('path' in refs[0])) {
                attachments = refs as unknown as MessageAttachment[];
              }
            } catch {
              // Ignore parse errors
            }
          }

          agentMessages.push({
            type: 'user' as const,
            content: msg.content || undefined,
            attachments,
          });
        } else if (msg.type === 'text') {
          agentMessages.push({
            type: 'text' as const,
            content: msg.content || undefined,
          });
        } else if (msg.type === 'tool_use') {
          agentMessages.push({
            type: 'tool_use' as const,
            name: msg.tool_name || undefined,
            input: msg.tool_input ? JSON.parse(msg.tool_input) : undefined,
          });
        } else if (msg.type === 'tool_result') {
          agentMessages.push({
            type: 'tool_result' as const,
            toolUseId: msg.tool_use_id || undefined,
            output: msg.tool_output || undefined,
          });
        } else if (msg.type === 'result') {
          agentMessages.push({
            type: 'result' as const,
            subtype: msg.subtype || undefined,
          });
        } else if (msg.type === 'error') {
          agentMessages.push({
            type: 'error' as const,
            message: msg.error_message || undefined,
          });
        } else if (msg.type === 'plan') {
          // Restore plan message with parsed plan data
          try {
            const planData = msg.content
              ? (JSON.parse(msg.content) as TaskPlan)
              : undefined;
            if (planData) {
              // Only mark steps as completed if task is NOT running
              // For running tasks (restored from background), keep original status
              const restoredPlan: TaskPlan = isRestoringFromBackground
                ? planData
                : {
                    ...planData,
                    steps: planData.steps.map((s) => ({
                      ...s,
                      status: 'completed' as const,
                    })),
                  };
              agentMessages.push({
                type: 'plan' as const,
                plan: restoredPlan,
              });
            }
          } catch {
            // Ignore parse errors
          }
        } else {
          agentMessages.push({ type: msg.type as AgentMessage['type'] });
        }
      }

      // Set messages immediately (with loading placeholders for attachments)
      setMessages(agentMessages);
      setTaskId(id);

      // Load attachments asynchronously in background
      if (attachmentLoadTasks.length > 0) {
        // Use setTimeout to ensure this runs after the initial render
        setTimeout(async () => {
          // Check if we're still on the same task
          if (activeTaskIdRef.current !== id) return;

          const MESSAGE_CONCURRENCY = 2;

          for (
            let i = 0;
            i < attachmentLoadTasks.length;
            i += MESSAGE_CONCURRENCY
          ) {
            // Check again if task changed
            if (activeTaskIdRef.current !== id) return;

            const batch = attachmentLoadTasks.slice(i, i + MESSAGE_CONCURRENCY);
            const results = await Promise.all(
              batch.map(async ({ index, refs }) => {
                const attachments = await loadAttachments(refs);
                return { index, attachments };
              })
            );

            // Update messages with loaded attachments
            setMessages((prevMessages) => {
              // Check if still on same task
              if (activeTaskIdRef.current !== id) return prevMessages;

              const newMessages = [...prevMessages];
              for (const { index, attachments } of results) {
                // Find user message with loading attachments that matches this index
                const task = attachmentLoadTasks.find((t) => t.index === index);
                if (!task) continue;

                for (let j = 0; j < newMessages.length; j++) {
                  const msg = newMessages[j];
                  if (
                    msg.type === 'user' &&
                    msg.attachments?.some((a) => a.isLoading) &&
                    msg.attachments?.length === task.refs.length &&
                    // Match by first attachment id
                    msg.attachments[0]?.id === task.refs[0]?.id
                  ) {
                    // Match found, update attachments
                    newMessages[j] = {
                      ...msg,
                      attachments: attachments.map((a) => ({
                        ...a,
                        isLoading: false,
                      })),
                    };
                    break;
                  }
                }
              }
              return newMessages;
            });
          }
        }, 0);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }, []);

  // Process SSE stream
  const processStream = useCallback(
    async (
      response: Response,
      currentTaskId: string,
      _abortController: AbortController
    ) => {
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      // Track pending tool_use messages to match with tool_result
      const pendingToolUses: Map<
        string,
        { name: string; input: Record<string, unknown> }
      > = new Map();

      // Track tool execution progress for updating plan steps
      let completedToolCount = 0;
      let totalToolCount = 0;

      // Helper to check if this stream is still for the active task
      const isActiveTask = () => activeTaskIdRef.current === currentTaskId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Note: We no longer cancel the reader when task switches.
        // Background tasks continue to process the stream and save to database.
        // UI updates are skipped for inactive tasks via isActiveTask() checks below.

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as AgentMessage;

              // Check if this is the active task for UI updates
              const isActive = isActiveTask();

              if (data.type === 'session') {
                if (isActive) {
                  sessionIdRef.current = data.sessionId || null;
                }
              } else if (data.type === 'done') {
                // Update background task status (always, even if not active)
                updateBackgroundTaskStatus(currentTaskId, false);

                // UI updates only for active task
                if (isActive) {
                  // Stream ended - mark all plan steps as completed
                  setPendingPermission(null);
                  setPlan((currentPlan) => {
                    if (!currentPlan) return currentPlan;
                    return {
                      ...currentPlan,
                      steps: currentPlan.steps.map((step) => ({
                        ...step,
                        status: 'completed' as const,
                      })),
                    };
                  });
                }
              } else if (data.type === 'permission_request') {
                // Handle permission request - only for active task
                if (isActive && data.permission) {
                  setPendingPermission(data.permission);
                  setMessages((prev) => [...prev, data]);
                }
              } else {
                // UI update only for active task
                if (isActive) {
                  setMessages((prev) => [...prev, data]);
                }

                // Extract file paths from text messages
                if (data.type === 'text' && data.content) {
                  await extractFilesFromText(currentTaskId, data.content);
                }

                // Track tool_use messages for file extraction
                if (data.type === 'tool_use' && data.name) {
                  const toolUseId =
                    (data as { id?: string }).id || `tool_${Date.now()}`;
                  pendingToolUses.set(toolUseId, {
                    name: data.name,
                    input: (data.input as Record<string, unknown>) || {},
                  });
                  totalToolCount++;

                  // Handle AskUserQuestion tool - show question UI and pause execution
                  // Only handle for active task to avoid affecting wrong task's UI
                  if (
                    isActive &&
                    data.name === 'AskUserQuestion' &&
                    data.input
                  ) {
                    const input = data.input as { questions?: AgentQuestion[] };
                    if (input.questions && Array.isArray(input.questions)) {
                      setPendingQuestion({
                        id: `question_${Date.now()}`,
                        toolUseId,
                        questions: input.questions,
                      });
                      // Stop agent execution and wait for user response
                      // The user's answer will be sent via continueConversation
                      console.log(
                        '[useAgent] AskUserQuestion detected, pausing execution'
                      );
                      setIsRunning(false);
                      if (abortControllerRef.current) {
                        abortControllerRef.current.abort();
                        abortControllerRef.current = null;
                      }
                      // Also stop backend agent
                      if (sessionIdRef.current) {
                        fetch(
                          `${AGENT_SERVER_URL}/agent/stop/${sessionIdRef.current}`,
                          {
                            method: 'POST',
                          }
                        ).catch(() => {});
                      }
                      reader.cancel();
                      return; // Stop processing this stream
                    }
                  }
                }

                // When we get a tool_result, extract files from the matched tool_use
                if (data.type === 'tool_result' && data.toolUseId) {
                  const toolUse = pendingToolUses.get(data.toolUseId);
                  if (toolUse) {
                    await extractAndSaveFiles(
                      currentTaskId,
                      toolUse.name,
                      toolUse.input,
                      data.output
                    );
                    pendingToolUses.delete(data.toolUseId);

                    // Trigger working files refresh for file-writing tools
                    const fileWritingTools = [
                      'Write',
                      'Edit',
                      'Bash',
                      'NotebookEdit',
                    ];
                    if (
                      fileWritingTools.includes(toolUse.name) ||
                      toolUse.name.includes('sandbox')
                    ) {
                      setFilesVersion((v) => v + 1);
                    }
                  }

                  // Update plan step progress
                  completedToolCount++;
                  setPlan((currentPlan) => {
                    if (!currentPlan || !currentPlan.steps.length)
                      return currentPlan;

                    const stepCount = currentPlan.steps.length;
                    // Calculate how many steps should be completed based on tool progress
                    // Use a heuristic: distribute tool completions across steps
                    const progressRatio =
                      completedToolCount /
                      Math.max(totalToolCount, stepCount * 2);
                    const completedSteps = Math.min(
                      Math.floor(progressRatio * stepCount),
                      stepCount - 1 // Keep at least one step as in_progress until done
                    );

                    const updatedSteps = currentPlan.steps.map(
                      (step, index) => {
                        if (index < completedSteps) {
                          return { ...step, status: 'completed' as const };
                        } else if (index === completedSteps) {
                          return { ...step, status: 'in_progress' as const };
                        }
                        return { ...step, status: 'pending' as const };
                      }
                    );

                    return { ...currentPlan, steps: updatedSteps };
                  });
                }

                // Save message to database
                try {
                  await createMessage({
                    task_id: currentTaskId,
                    type: data.type as
                      | 'text'
                      | 'tool_use'
                      | 'tool_result'
                      | 'result'
                      | 'error'
                      | 'user',
                    content: data.content,
                    tool_name: data.name,
                    tool_input: data.input
                      ? JSON.stringify(data.input)
                      : undefined,
                    tool_output: data.output,
                    tool_use_id: data.toolUseId,
                    subtype: data.subtype,
                    error_message: data.message,
                  });

                  // Update task status based on message
                  await updateTaskFromMessage(
                    currentTaskId,
                    data.type,
                    data.subtype,
                    data.cost,
                    data.duration
                  );
                } catch (dbError) {
                  console.error('Failed to save message:', dbError);
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    },
    []
  );

  // Phase 1: Planning - get a plan from the agent
  const runAgent = useCallback(
    async (
      prompt: string,
      existingTaskId?: string,
      sessionInfo?: SessionInfo,
      attachments?: MessageAttachment[]
    ): Promise<string> => {
      // If there's already a running task, move it to background
      if (isRunning && abortControllerRef.current && taskId) {
        console.log(
          '[useAgent] Moving current task to background before starting new:',
          taskId
        );
        addBackgroundTask({
          taskId: taskId,
          sessionId: sessionIdRef.current || '',
          abortController: abortControllerRef.current,
          isRunning: true,
          prompt: initialPrompt,
        });
        abortControllerRef.current = null;
        sessionIdRef.current = null;
      }

      setIsRunning(true);
      setMessages([]);
      setInitialPrompt(prompt);
      setPhase('planning');
      setPlan(null);

      // Handle session info
      const sessId = sessionInfo?.sessionId || currentSessionId || '';
      const taskIdx = sessionInfo?.taskIndex || currentTaskIndex;

      if (sessionInfo) {
        setCurrentSessionId(sessionInfo.sessionId);
        setCurrentTaskIndex(sessionInfo.taskIndex);
      }

      // Compute session folder path
      let computedSessionFolder: string | null = null;
      if (sessId) {
        try {
          const appDir = await getAppDataDir();
          computedSessionFolder = `${appDir}/sessions/${sessId}`;
          setSessionFolder(computedSessionFolder);
        } catch (error) {
          console.error('Failed to compute session folder:', error);
        }
      }

      // Create or use existing task
      const currentTaskId = existingTaskId || Date.now().toString();
      setTaskId(currentTaskId);
      activeTaskIdRef.current = currentTaskId; // Set as active task for stream isolation

      // Save task to database - check if task exists first
      try {
        const existingTask = await getTask(currentTaskId);
        if (!existingTask) {
          await createTask({
            id: currentTaskId,
            session_id: sessId,
            task_index: taskIdx,
            prompt,
          });
          console.log(
            '[useAgent] Created new task:',
            currentTaskId,
            'in session:',
            sessId
          );
        } else {
          console.log('[useAgent] Task already exists:', currentTaskId);
        }
      } catch (error) {
        console.error('Failed to create task:', error);
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Prepare images for API (only send image attachments with actual data)
      const images = attachments
        ?.filter((a) => a.type === 'image' && a.data && a.data.length > 0)
        .map((a) => ({
          data: a.data,
          mimeType: a.mimeType || 'image/png',
        }));

      const hasImages = images && images.length > 0;

      // Debug logging for image attachments
      if (attachments && attachments.length > 0) {
        console.log('[useAgent] Attachments received:', attachments.length);
        attachments.forEach((a, i) => {
          console.log(
            `[useAgent] Attachment ${i}: type=${a.type}, hasData=${!!a.data}, dataLength=${a.data?.length || 0}`
          );
        });
        console.log('[useAgent] Valid images for API:', images?.length || 0);
      }

      try {
        const modelConfig = getModelConfig();

        // If images are attached, use direct execution (skip planning)
        // because images need to be processed during execution, not planning
        if (hasImages) {
          console.log('[useAgent] Images attached, using direct execution');
          setPhase('executing');

          // Add user message with attachments to UI
          const userMessage: AgentMessage = {
            type: 'user',
            content: prompt,
            attachments: attachments,
          };
          setMessages([userMessage]);

          // Save user message to database (save attachments to files first)
          try {
            let attachmentRefs: string | undefined;
            if (
              attachments &&
              attachments.length > 0 &&
              computedSessionFolder
            ) {
              // Save attachments to file system and get references
              const refs = await saveAttachments(
                computedSessionFolder,
                attachments
              );
              attachmentRefs = JSON.stringify(refs);
              console.log(
                '[useAgent] Saved attachments to files:',
                refs.length
              );
              // Trigger working files refresh
              setFilesVersion((v) => v + 1);
            }
            await createMessage({
              task_id: currentTaskId,
              type: 'user',
              content: prompt,
              attachments: attachmentRefs,
            });
          } catch (error) {
            console.error('Failed to save user message:', error);
          }

          // Use session folder as workDir
          const workDir = computedSessionFolder || (await getAppDataDir());
          const sandboxConfig = getSandboxConfig();
          const skillsConfig = getSkillsConfig();

          const mcpConfig = getMcpConfig();

          // Use direct execution endpoint with images
          const response = await fetchWithRetry(`${AGENT_SERVER_URL}/agent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              prompt,
              workDir,
              taskId: currentTaskId,
              modelConfig,
              sandboxConfig,
              images,
              skillsConfig,
              mcpConfig,
            }),
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
          }

          await processStream(response, currentTaskId, abortController);
          return currentTaskId;
        }

        // Phase 1: Request planning (no images)
        const response = await fetchWithRetry(
          `${AGENT_SERVER_URL}/agent/plan`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              prompt,
              modelConfig,
            }),
            signal: abortController.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }

        // Process planning stream
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        // Helper to check if this stream is still for the active task
        const isActiveTask = () => activeTaskIdRef.current === currentTaskId;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Note: We no longer cancel the reader when task switches.
          // Planning streams continue in background, UI updates are skipped for inactive tasks.

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as AgentMessage;

                // Check if this task is still active for UI updates
                const isActive = isActiveTask();

                if (data.type === 'session') {
                  if (isActive) {
                    sessionIdRef.current = data.sessionId || null;
                  }
                } else if (data.type === 'direct_answer' && data.content) {
                  // Simple question - direct answer, no plan needed
                  console.log(
                    '[useAgent] Received direct answer, no plan needed'
                  );
                  // UI updates only for active task
                  if (isActive) {
                    setMessages((prev) => [
                      ...prev,
                      { type: 'text', content: data.content },
                    ]);
                    setPlan(null); // Clear any plan when we get a direct answer
                    setPhase('idle');
                  }

                  // Save to database (always)
                  try {
                    await createMessage({
                      task_id: currentTaskId,
                      type: 'text',
                      content: data.content,
                    });
                    await updateTask(currentTaskId, { status: 'completed' });
                  } catch (dbError) {
                    console.error('Failed to save direct answer:', dbError);
                  }
                } else if (data.type === 'plan' && data.plan) {
                  // Complex task - received the plan, wait for approval
                  // UI updates only for active task
                  if (isActive) {
                    setPlan(data.plan);
                    setPhase('awaiting_approval');
                    setMessages((prev) => [...prev, data]);
                  }
                } else if (data.type === 'text') {
                  if (isActive) {
                    setMessages((prev) => [...prev, data]);
                  }
                } else if (data.type === 'done') {
                  // Planning done
                } else if (data.type === 'error') {
                  if (isActive) {
                    setMessages((prev) => [...prev, data]);
                    setPhase('idle');
                  }
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          const errorMessage = formatFetchError(error, '/agent/plan');
          console.error('[useAgent] Request failed:', error);

          // UI updates only for active task
          if (activeTaskIdRef.current === currentTaskId) {
            setMessages((prev) => [
              ...prev,
              { type: 'error', message: errorMessage },
            ]);
            setPhase('idle');
          }

          // Save to database (always)
          try {
            await createMessage({
              task_id: currentTaskId,
              type: 'error',
              error_message: errorMessage,
            });
            await updateTask(currentTaskId, { status: 'error' });
          } catch (dbError) {
            console.error('Failed to save error:', dbError);
          }
        }
      } finally {
        // Only update running state if this is still the active task
        if (activeTaskIdRef.current === currentTaskId) {
          setIsRunning(false);
          abortControllerRef.current = null;
        }
      }

      return currentTaskId;
    },
    [isRunning, processStream]
  );

  // Phase 2: Execute the approved plan
  const approvePlan = useCallback(async (): Promise<void> => {
    if (!plan || !taskId || phase !== 'awaiting_approval') return;

    // Ensure this task is the active one before execution
    activeTaskIdRef.current = taskId;

    setIsRunning(true);
    setPhase('executing');

    // Initialize plan steps as pending in UI
    const updatedPlan: TaskPlan = {
      ...plan,
      steps: plan.steps.map((s) => ({ ...s, status: 'pending' as const })),
    };
    setPlan(updatedPlan);

    // Save the plan as a message to the database for persistence
    try {
      await createMessage({
        task_id: taskId,
        type: 'plan',
        content: JSON.stringify(plan),
      });
      console.log('[useAgent] Saved plan to database:', plan.id);
    } catch (error) {
      console.error('Failed to save plan to database:', error);
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Use session folder directly as workDir (no task subfolder)
      let workDir: string;
      if (sessionFolder) {
        workDir = sessionFolder;
      } else {
        const settings = getSettings();
        workDir = settings.workDir || (await getAppDataDir());
      }
      const modelConfig = getModelConfig();
      const sandboxConfig = getSandboxConfig();
      const skillsConfig = getSkillsConfig();
      const mcpConfig = getMcpConfig();

      const response = await fetchWithRetry(
        `${AGENT_SERVER_URL}/agent/execute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            planId: plan.id,
            prompt: initialPrompt,
            workDir,
            taskId,
            modelConfig,
            sandboxConfig,
            skillsConfig,
            mcpConfig,
          }),
          signal: abortController.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      await processStream(response, taskId, abortController);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        const errorMessage = formatFetchError(error, '/agent/execute');
        console.error('[useAgent] Execute failed:', error);

        // UI updates only for active task
        if (activeTaskIdRef.current === taskId) {
          setMessages((prev) => [
            ...prev,
            { type: 'error', message: errorMessage },
          ]);
        }

        // Save to database (always)
        try {
          await createMessage({
            task_id: taskId,
            type: 'error',
            error_message: errorMessage,
          });
          await updateTask(taskId, { status: 'error' });
        } catch (dbError) {
          console.error('Failed to save error:', dbError);
        }
      }
    } finally {
      // Only update running state if this is still the active task
      if (activeTaskIdRef.current === taskId) {
        setIsRunning(false);
        setPhase('idle');
        abortControllerRef.current = null;

        // Reload messages from database to ensure all are displayed
        // (in case some were missed during streaming)
        try {
          const dbMessages = await getMessagesByTaskId(taskId);
          const agentMessages: AgentMessage[] = [];
          for (const msg of dbMessages) {
            if (msg.type === 'user') {
              agentMessages.push({
                type: 'user' as const,
                content: msg.content || undefined,
              });
            } else if (msg.type === 'text') {
              agentMessages.push({
                type: 'text' as const,
                content: msg.content || undefined,
              });
            } else if (msg.type === 'tool_use') {
              agentMessages.push({
                type: 'tool_use' as const,
                name: msg.tool_name || undefined,
                input: msg.tool_input ? JSON.parse(msg.tool_input) : undefined,
              });
            } else if (msg.type === 'tool_result') {
              agentMessages.push({
                type: 'tool_result' as const,
                toolUseId: msg.tool_use_id || undefined,
                output: msg.tool_output || undefined,
              });
            } else if (msg.type === 'result') {
              agentMessages.push({
                type: 'result' as const,
                subtype: msg.subtype || undefined,
              });
            } else if (msg.type === 'error') {
              agentMessages.push({
                type: 'error' as const,
                message: msg.error_message || undefined,
              });
            } else if (msg.type === 'plan') {
              try {
                const planData = msg.content
                  ? (JSON.parse(msg.content) as TaskPlan)
                  : undefined;
                if (planData) {
                  const completedPlan: TaskPlan = {
                    ...planData,
                    steps: planData.steps.map((s) => ({
                      ...s,
                      status: 'completed' as const,
                    })),
                  };
                  agentMessages.push({
                    type: 'plan' as const,
                    plan: completedPlan,
                  });
                }
              } catch {
                // Ignore parse errors
              }
            } else {
              agentMessages.push({ type: msg.type as AgentMessage['type'] });
            }
          }
          setMessages(agentMessages);
        } catch (reloadError) {
          console.error(
            '[useAgent] Failed to reload messages after execution:',
            reloadError
          );
        }
      }
    }
  }, [plan, taskId, phase, initialPrompt, processStream, sessionFolder]);

  // Reject the plan
  const rejectPlan = useCallback((): void => {
    setPlan(null);
    setPhase('idle');
    setMessages((prev) => [...prev, { type: 'text', content: '计划已取消。' }]);
  }, []);

  // Continue conversation with context
  const continueConversation = useCallback(
    async (reply: string, attachments?: MessageAttachment[]): Promise<void> => {
      if (isRunning || !taskId) return;

      // Add user message to UI immediately (with attachments if any)
      const userMessage: AgentMessage = {
        type: 'user',
        content: reply,
        attachments:
          attachments && attachments.length > 0 ? attachments : undefined,
      };
      setMessages((prev) => [...prev, userMessage]);

      // Save user message to database (save attachments to files first)
      try {
        let attachmentRefs: string | undefined;
        if (attachments && attachments.length > 0 && sessionFolder) {
          // Save attachments to file system and get references
          const refs = await saveAttachments(sessionFolder, attachments);
          attachmentRefs = JSON.stringify(refs);
          console.log('[useAgent] Saved attachments to files:', refs.length);
          // Trigger working files refresh
          setFilesVersion((v) => v + 1);
        }
        await createMessage({
          task_id: taskId,
          type: 'user',
          content: reply,
          attachments: attachmentRefs,
        });
      } catch (error) {
        console.error('Failed to save user message:', error);
      }

      setIsRunning(true);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        // Build conversation history including the new reply
        const currentMessages = [...messages, userMessage];
        const conversationHistory = buildConversationHistory(
          initialPrompt,
          currentMessages
        );

        // Use session folder directly as workDir (no task subfolder)
        let workDir: string;
        if (sessionFolder) {
          workDir = sessionFolder;
        } else {
          const settings = getSettings();
          workDir = settings.workDir || (await getAppDataDir());
        }
        const modelConfig = getModelConfig();
        const sandboxConfig = getSandboxConfig();
        const skillsConfig = getSkillsConfig();
        const mcpConfig = getMcpConfig();

        // Prepare images for API (only send image attachments with actual data)
        const images = attachments
          ?.filter((a) => a.type === 'image' && a.data && a.data.length > 0)
          .map((a) => ({
            data: a.data,
            mimeType: a.mimeType || 'image/png',
          }));

        // Debug logging for image attachments
        if (attachments && attachments.length > 0) {
          console.log(
            '[useAgent] continueConversation attachments:',
            attachments.length
          );
          attachments.forEach((att, i) => {
            console.log(
              `[useAgent] Attachment ${i}: type=${att.type}, hasData=${!!att.data}, dataLength=${att.data?.length || 0}`
            );
          });
          console.log('[useAgent] Valid images for API:', images?.length || 0);
        }

        // Send conversation with full history
        const response = await fetchWithRetry(`${AGENT_SERVER_URL}/agent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: reply,
            conversation: conversationHistory,
            workDir,
            taskId,
            modelConfig,
            sandboxConfig,
            images: images && images.length > 0 ? images : undefined,
            skillsConfig,
            mcpConfig,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }

        await processStream(response, taskId, abortController);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          const errorMessage = formatFetchError(error, '/agent');
          console.error('[useAgent] Continue conversation failed:', error);

          // UI updates only for active task
          if (activeTaskIdRef.current === taskId) {
            setMessages((prev) => [
              ...prev,
              {
                type: 'error',
                message: errorMessage,
              },
            ]);
          }

          // Save error to database (always)
          try {
            await createMessage({
              task_id: taskId,
              type: 'error',
              error_message: errorMessage,
            });
            await updateTask(taskId, { status: 'error' });
          } catch (dbError) {
            console.error('Failed to save error:', dbError);
          }
        }
      } finally {
        // Only update running state if this is still the active task
        if (activeTaskIdRef.current === taskId) {
          setIsRunning(false);
          abortControllerRef.current = null;
        }
      }
    },
    [isRunning, taskId, messages, initialPrompt, processStream, sessionFolder]
  );

  const stopAgent = useCallback(async () => {
    // Stop polling if active
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    // Abort the fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Also tell the server to stop
    if (sessionIdRef.current) {
      try {
        await fetch(`${AGENT_SERVER_URL}/agent/stop/${sessionIdRef.current}`, {
          method: 'POST',
        });
      } catch {
        // Ignore errors
      }
    }

    // Update task status
    if (taskId) {
      try {
        await updateTask(taskId, { status: 'stopped' });
      } catch (error) {
        console.error('Failed to update task status:', error);
      }
    }

    setIsRunning(false);
  }, [taskId]);

  const clearMessages = useCallback(() => {
    // Stop polling if active
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    // This function is for complete cleanup (e.g., starting fresh)
    // For task switching, use loadTask which handles moving to background
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setMessages([]);
    setTaskId(null);
    setInitialPrompt('');
    setPendingPermission(null);
    setPendingQuestion(null);
    setPhase('idle');
    setPlan(null);
    setIsRunning(false);
    sessionIdRef.current = null;
    activeTaskIdRef.current = null;
  }, []);

  // Respond to permission request
  const respondToPermission = useCallback(
    async (permissionId: string, approved: boolean): Promise<void> => {
      if (!sessionIdRef.current) {
        console.error('No active session to respond to permission');
        return;
      }

      try {
        const response = await fetch(`${AGENT_SERVER_URL}/agent/permission`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            permissionId,
            approved,
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Failed to respond to permission: ${response.status}`
          );
        }

        // Clear pending permission
        setPendingPermission(null);

        // Add response message to UI
        const responseMessage: AgentMessage = {
          type: 'text',
          content: approved
            ? 'Permission granted. Continuing...'
            : 'Permission denied. Operation cancelled.',
        };
        setMessages((prev) => [...prev, responseMessage]);
      } catch (error) {
        console.error('Failed to respond to permission:', error);
        setPendingPermission(null);
      }
    },
    []
  );

  // Respond to question from AskUserQuestion tool
  const respondToQuestion = useCallback(
    async (
      _questionId: string,
      answers: Record<string, string>
    ): Promise<void> => {
      if (!taskId || !pendingQuestion) {
        console.error('No active task or pending question');
        return;
      }

      // Format answers as a readable message
      const answerText = Object.entries(answers)
        .map(([question, answer]) => `${question}: ${answer}`)
        .join('\n');

      // Clear pending question first
      setPendingQuestion(null);

      // Add user response as a message
      const userMessage: AgentMessage = { type: 'user', content: answerText };
      setMessages((prev) => [...prev, userMessage]);

      // Continue the conversation with the answers
      await continueConversation(answerText);
    },
    [taskId, pendingQuestion, continueConversation]
  );

  // taskFolder is now the same as sessionFolder (no task subfolders)
  const taskFolder = sessionFolder;

  // Track background tasks
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);

  // Subscribe to background task changes
  useEffect(() => {
    const unsubscribe = subscribeToBackgroundTasks((tasks) => {
      setBackgroundTasks(tasks);
    });
    return unsubscribe;
  }, []);

  // Cleanup on unmount - move running task to background instead of abandoning it
  useEffect(() => {
    return () => {
      // Stop polling if active
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }

      // If there's a running task when unmounting, move it to background
      // so it continues running and shows in the sidebar
      const currentTaskId = taskIdRef.current;
      const currentIsRunning = isRunningRef.current;
      const currentPrompt = initialPromptRef.current;

      if (abortControllerRef.current && currentTaskId && currentIsRunning) {
        console.log(
          '[useAgent] Moving task to background on unmount:',
          currentTaskId
        );
        addBackgroundTask({
          taskId: currentTaskId,
          sessionId: sessionIdRef.current || '',
          abortController: abortControllerRef.current,
          isRunning: true,
          prompt: currentPrompt,
        });
        // Don't clear refs here since the effect is cleaning up
        // The stream will continue to run and save to database
      }
    };
  }, []);

  // Get count of running background tasks
  const runningBackgroundTaskCount = backgroundTasks.filter(
    (t) => t.isRunning
  ).length;

  return {
    messages,
    isRunning,
    taskId,
    sessionId: currentSessionId,
    taskIndex: currentTaskIndex,
    sessionFolder,
    taskFolder,
    filesVersion,
    pendingPermission,
    pendingQuestion,
    phase,
    plan,
    runAgent,
    approvePlan,
    rejectPlan,
    continueConversation,
    stopAgent,
    clearMessages,
    loadTask,
    loadMessages,
    respondToPermission,
    respondToQuestion,
    setSessionInfo,
    // Background tasks
    backgroundTasks,
    runningBackgroundTaskCount,
  };
}

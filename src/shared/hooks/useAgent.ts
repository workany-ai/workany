import { useCallback, useRef, useState } from 'react';
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
import { getAppDataDir } from '@/shared/lib/paths';
import {
  saveAttachments,
  loadAttachments,
  type AttachmentReference,
} from '@/shared/lib/attachments';
import { API_BASE_URL, API_PORT } from '@/config';

const AGENT_SERVER_URL = API_BASE_URL;

console.log(
  `[API] Environment: ${import.meta.env.PROD ? 'production' : 'development'}, Port: ${API_PORT}`
);

// Helper to format fetch errors with more details
function formatFetchError(error: unknown, endpoint: string): string {
  const err = error as Error;
  const message = err.message || String(error);

  // Common error patterns
  if (message === 'Load failed' || message === 'Failed to fetch' || message.includes('NetworkError')) {
    return `无法连接到 API 服务 (${AGENT_SERVER_URL}${endpoint})。请检查：\n` +
      `1. API 服务是否已启动\n` +
      `2. 端口 ${API_PORT} 是否被占用\n` +
      `3. 防火墙是否阻止连接`;
  }

  if (message.includes('CORS') || message.includes('cross-origin')) {
    return `跨域请求被阻止 (CORS)。API 服务可能配置错误。`;
  }

  if (message.includes('timeout') || message.includes('Timeout')) {
    return `请求超时。API 服务响应过慢或网络问题。`;
  }

  if (message.includes('ECONNREFUSED')) {
    return `连接被拒绝。API 服务未在端口 ${API_PORT} 上运行。`;
  }

  // Return original message with context
  return `API 请求失败: ${message}`;
}

// Helper to get model configuration from settings
function getModelConfig():
  | { apiKey?: string; baseUrl?: string; model?: string }
  | undefined {
  try {
    const settings = getSettings();

    // If using "default" provider, return undefined to use environment variables
    if (settings.defaultProvider === 'default') {
      return undefined;
    }

    const provider = settings.providers.find(
      (p) => p.id === settings.defaultProvider
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
      return undefined;
    }

    return config;
  } catch {
    return undefined;
  }
}

// Helper to get sandbox configuration from settings
function getSandboxConfig():
  | { enabled: boolean; apiEndpoint?: string }
  | undefined {
  try {
    const settings = getSettings();

    // Only return if sandbox is enabled
    if (!settings.sandboxEnabled) {
      return undefined;
    }

    return {
      enabled: true,
      apiEndpoint: AGENT_SERVER_URL, // Use the same server
    };
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
  continueConversation: (reply: string, attachments?: MessageAttachment[]) => Promise<void>;
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
      history.push({ role: 'user', content: msg.content || '' });
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

  // Helper to set session info
  const setSessionInfo = useCallback((sessionId: string, taskIndex: number) => {
    setCurrentSessionId(sessionId);
    setCurrentTaskIndex(taskIndex);
  }, []);

  // Load existing task from database
  const loadTask = useCallback(async (id: string): Promise<Task | null> => {
    // Abort any existing stream before switching to a new task
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Set this as the active task (stops any lingering stream processing)
    activeTaskIdRef.current = id;

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
            console.log('[useAgent] Loaded sessionFolder from task:', computedSessionFolder);
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
    // Abort any existing stream before switching to a new task
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Set this as the active task (stops any lingering stream processing)
    activeTaskIdRef.current = id;

    try {
      const dbMessages = await getMessagesByTaskId(id);
      const agentMessages: AgentMessage[] = [];

      for (const msg of dbMessages) {
        if (msg.type === 'user') {
          // Parse and load attachments if present
          let attachments: MessageAttachment[] | undefined;
          if (msg.attachments) {
            try {
              const refs = JSON.parse(msg.attachments) as AttachmentReference[];
              // Check if it's the new format (has path) or old format (has data)
              if (refs.length > 0 && 'path' in refs[0]) {
                // New format: load from file system
                attachments = await loadAttachments(refs);
              } else {
                // Old format: use directly (backwards compatibility)
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
          agentMessages.push({ type: 'text' as const, content: msg.content || undefined });
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
          agentMessages.push({ type: 'result' as const, subtype: msg.subtype || undefined });
        } else if (msg.type === 'error') {
          agentMessages.push({
            type: 'error' as const,
            message: msg.error_message || undefined,
          });
        } else if (msg.type === 'plan') {
          // Restore plan message with parsed plan data
          try {
            const planData = msg.content ? JSON.parse(msg.content) as TaskPlan : undefined;
            if (planData) {
              // Mark all steps as completed since this is a loaded plan
              const completedPlan: TaskPlan = {
                ...planData,
                steps: planData.steps.map((s) => ({ ...s, status: 'completed' as const })),
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
      setTaskId(id);
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

        // Check if task switched - stop processing this stream
        if (!isActiveTask()) {
          console.log(`[useAgent] Task switched, stopping stream for task ${currentTaskId}`);
          reader.cancel();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as AgentMessage;

              // Double-check task is still active before any state update
              if (!isActiveTask()) {
                console.log(`[useAgent] Ignoring message for inactive task ${currentTaskId}`);
                continue;
              }

              if (data.type === 'session') {
                sessionIdRef.current = data.sessionId || null;
              } else if (data.type === 'done') {
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
              } else if (data.type === 'permission_request') {
                // Handle permission request - pause and wait for user response
                if (data.permission) {
                  setPendingPermission(data.permission);
                  setMessages((prev) => [...prev, data]);
                }
              } else {
                setMessages((prev) => [...prev, data]);

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
                  if (data.name === 'AskUserQuestion' && data.input) {
                    const input = data.input as { questions?: AgentQuestion[] };
                    if (input.questions && Array.isArray(input.questions)) {
                      setPendingQuestion({
                        id: `question_${Date.now()}`,
                        toolUseId,
                        questions: input.questions,
                      });
                      // Stop agent execution and wait for user response
                      // The user's answer will be sent via continueConversation
                      console.log('[useAgent] AskUserQuestion detected, pausing execution');
                      setIsRunning(false);
                      if (abortControllerRef.current) {
                        abortControllerRef.current.abort();
                        abortControllerRef.current = null;
                      }
                      // Also stop backend agent
                      if (sessionIdRef.current) {
                        fetch(`${AGENT_SERVER_URL}/agent/stop/${sessionIdRef.current}`, {
                          method: 'POST',
                        }).catch(() => {});
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
                    const fileWritingTools = ['Write', 'Edit', 'Bash', 'NotebookEdit'];
                    if (fileWritingTools.includes(toolUse.name) || toolUse.name.includes('sandbox')) {
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
      if (isRunning) return existingTaskId || '';

      // Abort any existing stream before starting a new task
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
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
          console.log(`[useAgent] Attachment ${i}: type=${a.type}, hasData=${!!a.data}, dataLength=${a.data?.length || 0}`);
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
            if (attachments && attachments.length > 0 && computedSessionFolder) {
              // Save attachments to file system and get references
              const refs = await saveAttachments(computedSessionFolder, attachments);
              attachmentRefs = JSON.stringify(refs);
              console.log('[useAgent] Saved attachments to files:', refs.length);
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

          // Use direct execution endpoint with images
          const response = await fetch(`${AGENT_SERVER_URL}/agent`, {
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
        const response = await fetch(`${AGENT_SERVER_URL}/agent/plan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt,
            modelConfig,
          }),
          signal: abortController.signal,
        });

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

          // Check if task switched - stop processing this stream
          if (!isActiveTask()) {
            console.log(`[useAgent] Task switched during planning, stopping stream for task ${currentTaskId}`);
            reader.cancel();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as AgentMessage;

                // Double-check task is still active before any state update
                if (!isActiveTask()) {
                  console.log(`[useAgent] Ignoring planning message for inactive task ${currentTaskId}`);
                  continue;
                }

                if (data.type === 'session') {
                  sessionIdRef.current = data.sessionId || null;
                } else if (data.type === 'direct_answer' && data.content) {
                  // Simple question - direct answer, no plan needed
                  console.log(
                    '[useAgent] Received direct answer, no plan needed'
                  );
                  setMessages((prev) => [
                    ...prev,
                    { type: 'text', content: data.content },
                  ]);
                  setPlan(null); // Clear any plan when we get a direct answer
                  setPhase('idle');

                  // Save to database
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
                  setPlan(data.plan);
                  setPhase('awaiting_approval');
                  setMessages((prev) => [...prev, data]);
                } else if (data.type === 'text') {
                  setMessages((prev) => [...prev, data]);
                } else if (data.type === 'done') {
                  // Planning done
                } else if (data.type === 'error') {
                  setMessages((prev) => [...prev, data]);
                  setPhase('idle');
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
          setMessages((prev) => [
            ...prev,
            { type: 'error', message: errorMessage },
          ]);
          setPhase('idle');

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
        setIsRunning(false);
        abortControllerRef.current = null;
      }

      return currentTaskId;
    },
    [isRunning, processStream]
  );

  // Phase 2: Execute the approved plan
  const approvePlan = useCallback(async (): Promise<void> => {
    if (!plan || !taskId || phase !== 'awaiting_approval') return;

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

      const response = await fetch(`${AGENT_SERVER_URL}/agent/execute`, {
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
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      await processStream(response, taskId, abortController);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        const errorMessage = formatFetchError(error, '/agent/execute');
        console.error('[useAgent] Execute failed:', error);
        setMessages((prev) => [
          ...prev,
          { type: 'error', message: errorMessage },
        ]);

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
      setIsRunning(false);
      setPhase('idle');
      abortControllerRef.current = null;
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
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
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

        // Prepare images for API (only send image attachments)
        const images = attachments
          ?.filter((a) => a.type === 'image')
          .map((a) => ({
            data: a.data,
            mimeType: a.mimeType || 'image/png',
          }));

        // Send conversation with full history
        const response = await fetch(`${AGENT_SERVER_URL}/agent`, {
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
          setMessages((prev) => [
            ...prev,
            {
              type: 'error',
              message: errorMessage,
            },
          ]);

          // Save error to database
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
        setIsRunning(false);
        abortControllerRef.current = null;
      }
    },
    [isRunning, taskId, messages, initialPrompt, processStream, sessionFolder]
  );

  const stopAgent = useCallback(async () => {
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
    // Abort any existing stream
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
  };
}

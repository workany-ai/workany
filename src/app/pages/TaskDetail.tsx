import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  getFilesByTaskId,
  updateTask,
  type LibraryFile,
  type Task,
} from '@/shared/db';
import {
  useAgent,
  type AgentMessage,
  type MessageAttachment,
} from '@/shared/hooks/useAgent';
import { useVitePreview } from '@/shared/hooks/useVitePreview';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  FileText,
  PanelLeft,
  Pencil,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  ArtifactPreview,
  hasValidSearchResults,
  type Artifact,
} from '@/components/artifacts';
import { Logo } from '@/components/common/logo';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSidebar } from '@/components/layout';
import { SettingsModal } from '@/components/settings';
import { ChatInput, type ChatMode } from '@/components/shared/ChatInput';
import { LazyImage } from '@/components/shared/LazyImage';
import { PlanApproval } from '@/components/task/PlanApproval';
import { QuestionInput } from '@/components/task/QuestionInput';
import { RightSidebar } from '@/components/task/RightSidebar';
import { ToolExecutionItem } from '@/components/task/ToolExecutionItem';

interface LocationState {
  prompt?: string;
  sessionId?: string;
  taskIndex?: number;
  attachments?: MessageAttachment[];
  mode?: ChatMode;
}

// Context for tool selection - allows child components to select tools
interface ToolSelectionContextType {
  selectedToolIndex: number | null;
  setSelectedToolIndex: (index: number | null) => void;
  showComputer: () => void;
}

const ToolSelectionContext = createContext<ToolSelectionContextType | null>(
  null
);

export function useToolSelection() {
  const context = useContext(ToolSelectionContext);
  if (!context) {
    throw new Error(
      'useToolSelection must be used within ToolSelectionContext'
    );
  }
  return context;
}

export function TaskDetailPage() {
  return <TaskDetailContent />;
}

function TaskDetailContent() {
  const { t } = useLanguage();
  const { taskId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LocationState | null;
  const initialPrompt = state?.prompt || '';
  const initialSessionId = state?.sessionId;
  const initialTaskIndex = state?.taskIndex || 1;
  const initialAttachments = state?.attachments;
  const initialMode = state?.mode;

  const {
    messages,
    isRunning,
    runAgent,
    continueConversation,
    stopAgent,
    loadTask,
    loadMessages,
    phase,
    plan: _plan,
    approvePlan,
    rejectPlan,
    pendingQuestion,
    respondToQuestion,
    sessionFolder,
    filesVersion,
    generatedTitle,
  } = useAgent();
  const { toggleLeft, setLeftOpen, secondaryOpen, setSecondaryOpen } = useSidebar();
  const [hasStarted, setHasStarted] = useState(false);
  const isInitializingRef = useRef(false); // Prevent double initialization in Strict Mode
  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevTaskIdRef = useRef<string | undefined>(undefined);

  // Panel visibility state - default to collapsed, auto-expand when content is available
  const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);

  // Scroll to bottom button state
  const [showScrollButton, setShowScrollButton] = useState(false);
  // Track if user has manually scrolled up (to disable auto-scroll)
  const userScrolledUpRef = useRef(false);
  // Track last scroll position to detect scroll direction
  const lastScrollTopRef = useRef(0);

  // Preview is now a dialog overlay, no need to collapse secondary panel
  const containerRef = useRef<HTMLDivElement>(null);

  // Artifact state
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(
    null
  );

  // Working directory state - use sessionFolder (show full session directory tree)
  // Only depend on sessionFolder and artifacts, not messages (to avoid frequent recalculations)
  const workingDir = useMemo(() => {
    // Use sessionFolder from useAgent if available
    if (sessionFolder) {
      return sessionFolder;
    }

    // Try to extract session directory from artifact paths
    for (const artifact of artifacts) {
      if (artifact.path && artifact.path.includes('/sessions/')) {
        const sessionMatch = artifact.path.match(/^(.+\/sessions\/[^/]+)/);
        if (sessionMatch) {
          return sessionMatch[1];
        }
      }
    }

    return '';
  }, [sessionFolder, artifacts]);

  // Track if sidebar has been auto-expanded (to avoid re-opening after manual close)
  const hasAutoExpandedRef = useRef(false);

  // Reset right sidebar state when switching tasks
  useEffect(() => {
    if (taskId !== prevTaskIdRef.current) {
      // Reset auto-expand flag for new task
      hasAutoExpandedRef.current = false;
      // Close right sidebar when switching to a new task
      setIsRightSidebarVisible(false);
      // Set loading to true immediately to prevent auto-expand effect
      // from using stale data from the previous task
      setIsLoading(true);
    }
  }, [taskId]);

  // Auto-expand right sidebar when there is actual content (only once)
  // Content includes: artifacts, working files, MCP tools, or skills
  useEffect(() => {
    // Skip if still loading - wait for task data to be ready
    if (isLoading) return;

    // Skip if task data not loaded yet or task doesn't match current taskId
    // This prevents using stale data from the previous task during task switching
    if (!task || task.id !== taskId) return;

    // Skip if already auto-expanded
    if (hasAutoExpandedRef.current) return;

    // Check if there's actual content to display
    const hasArtifacts = artifacts.length > 0;
    const hasWorkspace = !!workingDir;
    const hasFileOps = messages.some(
      (m) =>
        m.type === 'tool_use' &&
        ['Read', 'Write', 'Edit', 'Bash', 'Glob'].includes(m.name || '')
    );
    const hasMcpTools = messages.some(
      (m) => m.type === 'tool_use' && m.name?.startsWith('mcp__')
    );
    const hasSkills = messages.some(
      (m) => m.type === 'tool_use' && m.name === 'Skill'
    );

    const hasContent =
      hasArtifacts || (hasWorkspace && hasFileOps) || hasMcpTools || hasSkills;

    // Auto-expand when content becomes available (only once)
    if (hasContent) {
      setIsRightSidebarVisible(true);
      hasAutoExpandedRef.current = true;
    }
    // If no content, ensure sidebar stays collapsed (don't auto-expand)
    // The sidebar starts collapsed by default and should stay that way for empty sessions
  }, [artifacts.length, messages, workingDir, isLoading, task, taskId]);

  // Live preview state
  const {
    previewUrl: livePreviewUrl,
    status: livePreviewStatus,
    error: livePreviewError,
    startPreview,
    stopPreview,
  } = useVitePreview(taskId || null);

  // Handle starting live preview
  const handleStartLivePreview = useCallback(() => {
    if (workingDir) {
      console.log(
        '[TaskDetail] Starting live preview with workingDir:',
        workingDir
      );
      startPreview(workingDir);
    } else {
      console.warn('[TaskDetail] Cannot start live preview: no workingDir');
    }
  }, [workingDir, startPreview]);

  // Handle stopping live preview
  const handleStopLivePreview = useCallback(() => {
    console.log('[TaskDetail] Stopping live preview');
    stopPreview();
  }, [stopPreview]);

  // Tool search
  const [toolSearchQuery] = useState('');

  // Title rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const openRenameDialog = useCallback(() => {
    setRenameValue(task?.prompt || generatedTitle || initialPrompt);
    setRenameDialogOpen(true);
  }, [task?.prompt, generatedTitle, initialPrompt]);

  const handleRenameConfirm = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!taskId || !trimmed) {
      setRenameDialogOpen(false);
      return;
    }
    try {
      const updatedTask = await updateTask(taskId, { prompt: trimmed });
      if (updatedTask) {
        setTask(updatedTask);
      }
    } catch (error) {
      console.error('Failed to rename task:', error);
    }
    setRenameDialogOpen(false);
  }, [taskId, renameValue]);

  // Handle artifact selection - opens preview
  const handleSelectArtifact = useCallback((artifact: Artifact) => {
    setSelectedArtifact(artifact);
    setIsPreviewVisible(true);
  }, []);

  // Handle closing preview
  const handleClosePreview = useCallback(() => {
    setIsPreviewVisible(false);
    setSelectedArtifact(null);
  }, []);

  // Selected tool operation index for syncing with virtual computer
  const [selectedToolIndex, setSelectedToolIndex] = useState<number | null>(
    null
  );

  // Calculate total tool count for auto-selection
  const toolCount = useMemo(() => {
    return messages.filter((m) => m.type === 'tool_use').length;
  }, [messages]);

  // Auto-select the latest tool when running
  useEffect(() => {
    if (isRunning && toolCount > 0) {
      setSelectedToolIndex(toolCount - 1);
    }
  }, [toolCount, isRunning]);

  // Tool selection context value
  const toolSelectionValue = useMemo(
    () => ({
      selectedToolIndex,
      setSelectedToolIndex,
      showComputer: () => {}, // No-op since we removed the separate computer panel
    }),
    [selectedToolIndex]
  );

  // Helper to convert file type from LibraryFile to Artifact type
  const convertFileType = (fileType: string): Artifact['type'] => {
    switch (fileType) {
      case 'presentation':
        return 'presentation';
      case 'spreadsheet':
        return 'spreadsheet';
      case 'document':
        return 'document';
      case 'image':
        return 'image';
      case 'code':
        return 'code';
      case 'website':
        return 'html';
      case 'websearch':
        return 'websearch';
      default:
        return 'text';
    }
  };

  // Helper to get artifact type from file extension
  const getArtifactTypeFromExt = (
    ext: string | undefined
  ): Artifact['type'] => {
    if (!ext) return 'text';
    if (ext === 'html' || ext === 'htm') return 'html';
    if (ext === 'jsx' || ext === 'tsx') return 'jsx';
    if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css';
    if (ext === 'json') return 'json';
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    if (ext === 'csv') return 'csv';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'doc' || ext === 'docx') return 'document';
    if (ext === 'xls' || ext === 'xlsx') return 'spreadsheet';
    if (ext === 'ppt' || ext === 'pptx') return 'presentation';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext))
      return 'image';
    if (
      [
        'js',
        'ts',
        'py',
        'rs',
        'go',
        'java',
        'c',
        'cpp',
        'h',
        'hpp',
        'rb',
        'php',
        'swift',
        'kt',
        'sh',
        'bash',
        'sql',
        'yaml',
        'yml',
        'xml',
        'toml',
      ].includes(ext)
    )
      return 'code';
    return 'text';
  };

  // Extract artifacts from messages AND load from database
  useEffect(() => {
    const loadArtifacts = async () => {
      const extractedArtifacts: Artifact[] = [];
      const seenPaths = new Set<string>();

      // 1. Extract from Write tool messages (in-memory content)
      messages.forEach((msg) => {
        if (msg.type === 'tool_use' && msg.name === 'Write') {
          const input = msg.input as Record<string, unknown> | undefined;
          const filePath = input?.file_path as string | undefined;
          const content = input?.content as string | undefined;

          if (filePath && !seenPaths.has(filePath)) {
            seenPaths.add(filePath);
            const filename = filePath.split('/').pop() || filePath;
            const ext = filename.split('.').pop()?.toLowerCase();

            extractedArtifacts.push({
              id: filePath,
              name: filename,
              type: getArtifactTypeFromExt(ext),
              content,
              path: filePath,
            });
          }
        }

        // Extract WebSearch results as artifacts
        if (msg.type === 'tool_use' && msg.name === 'WebSearch') {
          const input = msg.input as Record<string, unknown> | undefined;
          const query = input?.query as string | undefined;
          const toolUseId = msg.id;
          if (query) {
            // Find the corresponding tool_result by toolUseId or by position
            let output = '';
            if (toolUseId) {
              const resultMsg = messages.find(
                (m) => m.type === 'tool_result' && m.toolUseId === toolUseId
              );
              output = resultMsg?.output || '';
            }
            // Fallback: find the next tool_result after this tool_use
            if (!output) {
              const msgIndex = messages.indexOf(msg);
              for (let i = msgIndex + 1; i < messages.length; i++) {
                if (messages[i].type === 'tool_result') {
                  output = messages[i].output || '';
                  break;
                }
                if (messages[i].type === 'tool_use') break; // Stop at next tool_use
              }
            }

            const artifactId = `websearch-${query}`;
            // Only add websearch artifact if it has valid search results
            if (
              !seenPaths.has(artifactId) &&
              output &&
              hasValidSearchResults(output)
            ) {
              seenPaths.add(artifactId);
              extractedArtifacts.push({
                id: artifactId,
                name: `Search: ${query.slice(0, 50)}${query.length > 50 ? '...' : ''}`,
                type: 'websearch',
                content: output,
              });
            }
          }
        }
      });

      // 1.5. Extract files mentioned in tool_result messages and text messages
      const filePatterns = [
        // Match paths in backticks
        /`([^`]+\.(?:pptx|xlsx|docx|pdf))`/gi,
        // Match absolute paths
        /(\/[^\s"'`\n]+\.(?:pptx|xlsx|docx|pdf))/gi,
        // Match Chinese/unicode paths
        /(\/[^\s"'\n]*[\u4e00-\u9fff][^\s"'\n]*\.(?:pptx|xlsx|docx|pdf))/gi,
      ];

      messages.forEach((msg) => {
        // Check tool_result outputs and text message content
        const textToSearch =
          msg.type === 'tool_result'
            ? msg.output
            : msg.type === 'text'
              ? msg.content
              : null;

        if (textToSearch) {
          for (const pattern of filePatterns) {
            const matches = textToSearch.matchAll(pattern);
            for (const match of matches) {
              const filePath = match[1] || match[0];
              if (filePath && !seenPaths.has(filePath)) {
                seenPaths.add(filePath);
                const filename = filePath.split('/').pop() || filePath;
                const ext = filename.split('.').pop()?.toLowerCase();

                extractedArtifacts.push({
                  id: filePath,
                  name: filename,
                  type: getArtifactTypeFromExt(ext),
                  path: filePath,
                });
              }
            }
          }
        }
      });

      // 2. Load files from database (includes files from Skill tool, etc.)
      if (taskId) {
        try {
          const dbFiles = await getFilesByTaskId(taskId);
          dbFiles.forEach((file: LibraryFile) => {
            // Skip websearch - we extract these from messages with full output content
            // Check both type and path pattern (search:// is used for WebSearch results)
            if (file.type === 'websearch' || file.path?.startsWith('search://'))
              return;
            // Skip if we already have this file from Write tool
            if (file.path && !seenPaths.has(file.path)) {
              seenPaths.add(file.path);
              extractedArtifacts.push({
                id: file.path || `file-${file.id}`,
                name: file.name,
                type: convertFileType(file.type),
                content: file.preview || undefined,
                path: file.path,
              });
            }
          });
        } catch (error) {
          console.error('Failed to load files from database:', error);
        }
      }

      setArtifacts(extractedArtifacts);
      // Auto-select first artifact if none selected
      if (extractedArtifacts.length > 0 && !selectedArtifact) {
        setSelectedArtifact(extractedArtifacts[0]);
      }
    };

    loadArtifacts();
  }, [messages, taskId]);

  // Auto scroll to bottom only when task is running AND user hasn't scrolled up
  useEffect(() => {
    if (isRunning && !userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isRunning]);

  // Reset userScrolledUp when task stops running
  useEffect(() => {
    if (!isRunning) {
      userScrolledUpRef.current = false;
    }
  }, [isRunning]);

  // Check scroll position to show/hide scroll button and detect manual scroll
  const checkScrollPosition = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    // Detect if user scrolled up (scroll position decreased)
    if (
      isRunning &&
      scrollTop < lastScrollTopRef.current &&
      distanceFromBottom > 100
    ) {
      userScrolledUpRef.current = true;
    }

    // If user scrolled to near bottom, re-enable auto-scroll
    if (distanceFromBottom < 50) {
      userScrolledUpRef.current = false;
    }

    lastScrollTopRef.current = scrollTop;

    // Show button if more than 200px from bottom
    setShowScrollButton(distanceFromBottom > 200);
  }, [isRunning]);

  // Add scroll listener to messages container
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', checkScrollPosition);
    // Initial check
    checkScrollPosition();

    return () => {
      container.removeEventListener('scroll', checkScrollPosition);
    };
  }, [checkScrollPosition]);

  // Re-check scroll position when messages load or loading state changes
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        checkScrollPosition();
      });
    }
  }, [isLoading, messages.length, checkScrollPosition]);

  // Scroll to bottom handler - also re-enables auto-scroll
  const scrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Update UI immediately when a generated title arrives
  useEffect(() => {
    if (generatedTitle && taskId) {
      setTask((prev) => prev && prev.id === taskId ? { ...prev, prompt: generatedTitle } : prev);
    }
  }, [generatedTitle, taskId]);

  // Reset UI state when taskId changes (but don't touch agent/task state - let loadTask handle that)
  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      if (prevTaskIdRef.current !== undefined) {
        // Only reset UI state here - loadTask will handle task switching
        setTask(null);
        setHasStarted(false);
        isInitializingRef.current = false; // Reset for new task

        // Reset preview and artifact state
        setIsPreviewVisible(false);
        setSelectedArtifact(null);
        setArtifacts([]);
        setSelectedToolIndex(null);

        // Reset right sidebar state
        setIsRightSidebarVisible(false);
        hasAutoExpandedRef.current = false;

        // Stop live preview if running
        stopPreview();
      }
      prevTaskIdRef.current = taskId;
    }
  }, [taskId, stopPreview]);

  // Load existing task or start new one
  useEffect(() => {
    async function initialize() {
      if (!taskId) {
        setIsLoading(false);
        return;
      }

      // Prevent double initialization in React Strict Mode
      if (isInitializingRef.current) {
        return;
      }
      isInitializingRef.current = true;

      setIsLoading(true);

      const existingTask = await loadTask(taskId);

      if (existingTask) {
        setTask(existingTask);
        await loadMessages(taskId);
        setHasStarted(true);
        setIsLoading(false);
      } else if (initialPrompt && !hasStarted) {
        setHasStarted(true);
        setIsLoading(false);

        // Pass session info if available
        const sessionInfo = initialSessionId
          ? { sessionId: initialSessionId, taskIndex: initialTaskIndex }
          : undefined;
        await runAgent(initialPrompt, taskId, sessionInfo, initialAttachments, initialMode);
        const newTask = await loadTask(taskId);
        setTask(newTask);
      } else {
        setIsLoading(false);
      }

      isInitializingRef.current = false;
    }

    initialize();
  }, [taskId]);

  // Handle reply submission from ChatInput
  const handleReply = useCallback(
    async (text: string, messageAttachments?: MessageAttachment[], mode?: ChatMode) => {
      if (
        (text.trim() ||
          (messageAttachments && messageAttachments.length > 0)) &&
        !isRunning &&
        taskId
      ) {
        await continueConversation(text.trim(), messageAttachments, mode);
      }
    },
    [isRunning, taskId, continueConversation]
  );

  const displayTitle = task?.prompt || generatedTitle || initialPrompt;
  const displayPrompt = initialPrompt || task?.prompt || '';

  // Get attachments for the initial user message:
  // 1. From navigation state (first navigation from home page)
  // 2. Or from the first user message in messages (when reloading/re-entering)
  const displayAttachments = useMemo(() => {
    console.log('[TaskDetail] Computing displayAttachments:');
    console.log('  - initialAttachments:', initialAttachments?.length || 0);
    if (initialAttachments && initialAttachments.length > 0) {
      initialAttachments.forEach((a, i) => {
        console.log(
          `  - initialAttachment ${i}: type=${a.type}, hasData=${!!a.data}, dataLength=${a.data?.length || 0}`
        );
      });
      return initialAttachments;
    }
    // Find the first user message in messages array
    const firstUserMessage = messages.find((m) => m.type === 'user');
    console.log('  - firstUserMessage found:', !!firstUserMessage);
    if (firstUserMessage?.attachments) {
      console.log(
        '  - firstUserMessage.attachments:',
        firstUserMessage.attachments.length
      );
    }
    return firstUserMessage?.attachments;
  }, [initialAttachments, messages]);

  // Check if we should skip showing the first user message separately
  // (to avoid duplication when messages array already includes it)
  const firstMessageIsUserWithSameContent = useMemo(() => {
    const firstMessage = messages[0];
    return (
      firstMessage?.type === 'user' && firstMessage?.content === displayPrompt
    );
  }, [messages, displayPrompt]);

  return (
    <ToolSelectionContext.Provider value={toolSelectionValue}>
      <div
          ref={containerRef}
          className="flex min-w-0 flex-1 overflow-hidden"
        >
          {/* Left Panel - Agent Chat (flex-1 to fill available space) */}
          <div
            className={cn(
              'bg-background flex min-w-0 flex-1 flex-col overflow-hidden transition-all duration-200',
              !isRightSidebarVisible && 'rounded-2xl',
              isRightSidebarVisible && 'rounded-l-2xl'
            )}
          >
            {/* Header - Full width */}
            <header className="border-border/50 bg-background z-10 flex shrink-0 items-center gap-2 border-none px-4 py-3">
              {!secondaryOpen && (
                <button
                  onClick={() => setSecondaryOpen(true)}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground flex cursor-pointer items-center justify-center rounded-lg p-1.5 transition-colors duration-200"
                >
                  <PanelLeft className="size-4" />
                </button>
              )}

              <div className="group/title flex min-w-0 flex-1 items-center gap-1">
                <h1 className="text-foreground inline-block max-w-full truncate px-2 py-1 text-sm font-normal">
                  {displayTitle.slice(0, 40) || `Task ${taskId}`}
                  {displayTitle.length > 40 && '...'}
                </h1>
                <button
                  onClick={openRenameDialog}
                  className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-hover/title:opacity-100"
                  title={t.common.rename}
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>

              {isRunning && (
                <span className="text-primary flex items-center gap-2 text-sm">
                  <span className="bg-primary size-2 animate-pulse rounded-full" />
                </span>
              )}

              {/* Toggle right sidebar button */}
              <button
                onClick={() => setIsRightSidebarVisible(!isRightSidebarVisible)}
                className={cn(
                  'text-muted-foreground hover:bg-accent hover:text-foreground flex cursor-pointer items-center justify-center rounded-lg p-2 transition-colors',
                  isRightSidebarVisible && 'bg-accent/50'
                )}
                title={isRightSidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
              >
                <PanelLeft className="size-4 rotate-180" />
              </button>
            </header>

            {/* Messages Area - Centered content when sidebar hidden */}
            <div
              ref={messagesContainerRef}
              className={cn(
                'scrollbar-soft relative flex-1 overflow-x-hidden overflow-y-auto',
                !isRightSidebarVisible &&
                  'flex justify-center'
              )}
            >
              <div
                className={cn(
                  'w-full px-6 pt-4 pb-24',
                  !isRightSidebarVisible && 'max-w-[800px]'
                )}
              >
                {isLoading ? (
                  <div className="flex min-h-[200px] items-center justify-center py-12">
                    <div className="text-muted-foreground flex items-center gap-3">
                      <div className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      <span>{t.common.loading}</span>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-full min-w-0 space-y-4">
                    {displayPrompt && !firstMessageIsUserWithSameContent && (
                      <UserMessage
                        content={displayPrompt}
                        attachments={displayAttachments}
                      />
                    )}

                    <MessageList
                      messages={messages}
                      isRunning={isRunning}
                      searchQuery={toolSearchQuery}
                      phase={phase}
                      onApprovePlan={approvePlan}
                      onRejectPlan={rejectPlan}
                    />

                    {isRunning && <RunningIndicator messages={messages} />}

                    {/* Question Input UI - shown when agent asks questions */}
                    {pendingQuestion && (
                      <QuestionInput
                        pendingQuestion={pendingQuestion}
                        onSubmit={respondToQuestion}
                      />
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* Reply Input - Centered when sidebar hidden */}
            <div
              className={cn(
                'border-border/50 bg-background relative shrink-0 border-none',
                !isRightSidebarVisible &&
                  'flex justify-center'
              )}
            >
              {/* Scroll to bottom button - fixed above input */}
              {showScrollButton && (
                <button
                  onClick={scrollToBottom}
                  className="bg-background hover:bg-accent border-border absolute -top-12 left-1/2 z-10 flex -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border p-2 shadow-lg transition-all"
                  title={t.common.scrollToBottom || 'Scroll to bottom'}
                >
                  <ArrowDown className="size-4" />
                </button>
              )}
              <div
                className={cn(
                  'w-full px-4 py-3',
                  !isRightSidebarVisible && 'max-w-[800px]'
                )}
              >
                <ChatInput
                  variant="reply"
                  placeholder={t.home.reply}
                  isRunning={isRunning}
                  onSubmit={handleReply}
                  onStop={stopAgent}
                  defaultMode={initialMode}
                />
              </div>
            </div>
          </div>

          {/* Divider between chat and sidebar */}
          <div
            className={cn(
              'bg-border/50 shrink-0 transition-all duration-300',
              isRightSidebarVisible ? 'w-px' : 'w-0'
            )}
          />

          {/* Right Panel - Progress, Artifacts, Context (fixed width) */}
          <div
            className={cn(
              'bg-background flex shrink-0 flex-col overflow-hidden rounded-r-2xl transition-all duration-300',
              isRightSidebarVisible ? 'w-[280px]' : 'w-0'
            )}
          >
            <RightSidebar
              messages={messages}
              isRunning={isRunning}
              artifacts={artifacts}
              selectedArtifact={selectedArtifact}
              onSelectArtifact={handleSelectArtifact}
              workingDir={workingDir}
              sessionFolder={sessionFolder || undefined}
              filesVersion={filesVersion}
            />
          </div>
      </div>
      {/* Artifact Preview Dialog */}
      {isPreviewVisible && selectedArtifact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={handleClosePreview}
          />
          <div className="bg-background relative flex h-[85vh] w-[70vw] max-w-5xl flex-col overflow-hidden rounded-2xl shadow-2xl">
            <ArtifactPreview
              artifact={selectedArtifact}
              onClose={handleClosePreview}
              allArtifacts={artifacts}
              livePreviewUrl={livePreviewUrl}
              livePreviewStatus={livePreviewStatus}
              livePreviewError={livePreviewError}
              onStartLivePreview={
                workingDir ? handleStartLivePreview : undefined
              }
              onStopLivePreview={handleStopLivePreview}
            />
          </div>
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t.common.rename}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <label className="text-sm font-medium">{t.common.taskTitle}</label>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameConfirm();
              }}
              autoFocus
              className="border-border focus:border-primary focus:ring-primary/30 mt-1.5 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1"
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => setRenameDialogOpen(false)}
              className="border-border hover:bg-accent rounded-lg border px-4 py-2 text-sm transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={handleRenameConfirm}
              disabled={!renameValue.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
            >
              {t.common.confirm}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ToolSelectionContext.Provider>
  );
}

// User Message Component
function UserMessage({
  content,
  attachments,
}: {
  content: string;
  attachments?: MessageAttachment[];
}) {
  // Debug logging for attachments
  if (attachments && attachments.length > 0) {
    console.log('[UserMessage] Rendering attachments:', attachments.length);
    attachments.forEach((a, i) => {
      console.log(
        `[UserMessage] Attachment ${i}: type=${a.type}, name=${a.name}, hasData=${!!a.data}, dataLength=${a.data?.length || 0}`
      );
    });
  }

  return (
    <div className="flex min-w-0 gap-3">
      <div className="min-w-0 flex-1"></div>
      <div className="bg-accent/50 max-w-[85%] min-w-0 rounded-xl px-4 py-3">
        {/* Display attachments (images) */}
        {attachments && attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((attachment) =>
              attachment.type === 'image' ? (
                <LazyImage
                  key={attachment.id}
                  src={attachment.data}
                  alt={attachment.name}
                  className="max-h-48 max-w-full"
                  isDataLoading={attachment.isLoading}
                />
              ) : (
                <div
                  key={attachment.id}
                  className="bg-muted flex items-center gap-2 rounded-lg px-3 py-2"
                >
                  <FileText className="text-muted-foreground size-4" />
                  <span className="text-foreground text-sm">
                    {attachment.name}
                  </span>
                </div>
              )
            )}
          </div>
        )}
        {content && (
          <p className="text-foreground text-sm break-words whitespace-pre-wrap">
            {content}
          </p>
        )}
      </div>
    </div>
  );
}

// Message List Component with task grouping
function MessageList({
  messages,
  isRunning,
  searchQuery,
  phase,
  onApprovePlan,
  onRejectPlan,
}: {
  messages: AgentMessage[];
  isRunning: boolean;
  searchQuery?: string;
  phase?: string;
  onApprovePlan?: () => void;
  onRejectPlan?: () => void;
}) {
  if (messages.length === 0) {
    return null;
  }

  // Define types
  type ToolWithResult = {
    message: AgentMessage;
    globalIndex: number;
    result?: AgentMessage;
  };

  type TaskMessageGroup = {
    type: 'task';
    title: string;
    description: string;
    tools: ToolWithResult[];
    isCompleted: boolean;
  };

  type OtherMessageGroup = {
    type: 'other';
    message: AgentMessage;
  };

  type MessageGroup = TaskMessageGroup | OtherMessageGroup;

  // Pre-process: find the last text message index in each segment between user messages
  // This ensures we keep the agent's response to each user question
  const lastTextIndicesInSegments = new Set<number>();

  // Find segment boundaries (user messages and result)
  const segmentBoundaries: number[] = [];
  messages.forEach((msg, idx) => {
    if (msg.type === 'user' || msg.type === 'result') {
      segmentBoundaries.push(idx);
    }
  });
  segmentBoundaries.push(messages.length); // End boundary

  // For each segment, find the last text message
  let segmentStart = 0;
  for (const boundary of segmentBoundaries) {
    // Find last text message in this segment (from segmentStart to boundary)
    for (let i = boundary - 1; i >= segmentStart; i--) {
      if (messages[i].type === 'text' && messages[i].content) {
        lastTextIndicesInSegments.add(i);
        break;
      }
    }
    segmentStart = boundary + 1;
  }

  // Filter messages: only keep the last text message in each segment
  const mergedMessages: AgentMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type === 'text' && msg.content) {
      // Only keep text messages that are the last in their segment
      if (lastTextIndicesInSegments.has(i)) {
        mergedMessages.push(msg);
      }
      // Skip other text messages (intermediate thinking)
    } else {
      mergedMessages.push(msg);
    }
  }

  // Collect all tool_result messages in order for matching with tool_use
  const toolResultMessages: AgentMessage[] = [];
  mergedMessages.forEach((msg) => {
    if (msg.type === 'tool_result') {
      toolResultMessages.push(msg);
    }
  });

  // Match tool_use with tool_result by index (they come in pairs)
  const getToolResult = (toolUseIndex: number): AgentMessage | undefined => {
    return toolResultMessages[toolUseIndex];
  };

  // Filter out duplicate plan messages - only keep the last one
  const lastPlanIdx = mergedMessages.reduce(
    (lastIdx, msg, idx) => (msg.type === 'plan' ? idx : lastIdx),
    -1
  );
  const filteredMessages =
    lastPlanIdx >= 0
      ? mergedMessages.filter(
          (msg, idx) => msg.type !== 'plan' || idx === lastPlanIdx
        )
      : mergedMessages;

  // Find the last result message index in filteredMessages
  let lastResultIndex = -1;
  filteredMessages.forEach((msg, index) => {
    if (msg.type === 'result') {
      lastResultIndex = index;
    }
  });

  // Process messages into groups
  const groups: MessageGroup[] = [];
  let toolGlobalIndex = 0;
  let toolUseIndex = 0;

  // Use a ref object to track current group (avoids TypeScript narrowing issues)
  const state = { currentGroup: null as TaskMessageGroup | null };

  const pushCurrentGroup = (completed: boolean) => {
    if (
      state.currentGroup &&
      (state.currentGroup.tools.length > 0 || state.currentGroup.description)
    ) {
      state.currentGroup.isCompleted = completed;
      groups.push(state.currentGroup);
      state.currentGroup = null;
    }
  };

  const ensureCurrentGroup = () => {
    if (!state.currentGroup) {
      state.currentGroup = {
        type: 'task',
        title: '执行任务',
        description: '',
        tools: [],
        isCompleted: false,
      };
    }
    return state.currentGroup;
  };

  let lastTextContent = '';
  // Track pending text message that might be standalone (no following tools)
  let pendingTextMessage: AgentMessage | null = null;

  filteredMessages.forEach((message, msgIndex) => {
    if (message.type === 'text' && message.content) {
      // Skip duplicate consecutive text messages
      if (message.content === lastTextContent) {
        return;
      }

      // Skip text messages that contain raw plan JSON
      // These are displayed by the PlanApproval component instead
      const trimmedContent = message.content.trim();
      if (
        trimmedContent.startsWith('{') &&
        trimmedContent.includes('"type"') &&
        trimmedContent.includes('"plan"')
      ) {
        return;
      }

      lastTextContent = message.content;

      // If there's a pending text message that had no tools, render it as standalone
      if (pendingTextMessage) {
        groups.push({ type: 'other', message: pendingTextMessage });
      }

      // Push any current tool group
      pushCurrentGroup(true);

      // Store this text as pending - we'll decide how to render it based on what follows
      pendingTextMessage = message;
      state.currentGroup = null;
    } else if (message.type === 'tool_use' && message.name) {
      // Text followed by tool_use - create a task group with the text as description
      if (pendingTextMessage) {
        const title =
          (pendingTextMessage.content || '').slice(0, 80) +
          ((pendingTextMessage.content || '').length > 80 ? '...' : '');
        state.currentGroup = {
          type: 'task',
          title,
          description: pendingTextMessage.content || '',
          tools: [],
          isCompleted: false,
        };
        pendingTextMessage = null;
      }
      const group = ensureCurrentGroup();
      // Find associated tool_result by index
      const result = getToolResult(toolUseIndex);
      group.tools.push({ message, globalIndex: toolGlobalIndex++, result });
      toolUseIndex++;
    } else if (message.type === 'tool_result') {
      // Skip tool_result messages as they're associated with tool_use
    } else if (message.type === 'user') {
      // Flush any pending text as standalone
      if (pendingTextMessage) {
        groups.push({ type: 'other', message: pendingTextMessage });
        pendingTextMessage = null;
      }
      pushCurrentGroup(true);
      groups.push({ type: 'other', message });
    } else if (message.type === 'result') {
      // Only show the last result message
      if (msgIndex === lastResultIndex) {
        // Flush any pending text as standalone
        if (pendingTextMessage) {
          groups.push({ type: 'other', message: pendingTextMessage });
          pendingTextMessage = null;
        }
        pushCurrentGroup(true);
        groups.push({ type: 'other', message });
      }
    } else if (message.type === 'error') {
      // Flush any pending text as standalone
      if (pendingTextMessage) {
        groups.push({ type: 'other', message: pendingTextMessage });
        pendingTextMessage = null;
      }
      pushCurrentGroup(true);
      groups.push({ type: 'other', message });
    } else if (message.type === 'plan') {
      // Plan message - render inline (duplicates already filtered out)
      if (pendingTextMessage) {
        groups.push({ type: 'other', message: pendingTextMessage });
        pendingTextMessage = null;
      }
      pushCurrentGroup(true);
      groups.push({ type: 'other', message });
    }
  });

  // Push any remaining pending text as standalone message
  if (pendingTextMessage) {
    groups.push({ type: 'other', message: pendingTextMessage });
  }

  // Push any remaining tool group
  pushCurrentGroup(!isRunning);

  return (
    <div className="space-y-4">
      {groups.map((group, index) => {
        if (group.type === 'task') {
          return (
            <TaskGroupComponent
              key={index}
              title={group.title}
              description={group.description}
              tools={group.tools}
              isCompleted={group.isCompleted}
              isRunning={isRunning}
              searchQuery={searchQuery}
            />
          );
        }
        return (
          <MessageItem
            key={index}
            message={group.message}
            phase={phase}
            onApprovePlan={onApprovePlan}
            onRejectPlan={onRejectPlan}
          />
        );
      })}
    </div>
  );
}

// Task Group Component - shows text description and collapsible tool list
function TaskGroupComponent({
  title,
  description,
  tools,
  isCompleted,
  isRunning,
  searchQuery,
}: {
  title: string;
  description: string;
  tools: {
    message: AgentMessage;
    globalIndex: number;
    result?: AgentMessage;
  }[];
  isCompleted: boolean;
  isRunning: boolean;
  searchQuery?: string;
}) {
  const { t } = useLanguage();
  // Default: collapsed when completed, expanded when running or in progress
  const [isExpanded, setIsExpanded] = useState(!isCompleted || isRunning);

  // Auto-collapse when task completes
  useEffect(() => {
    if (isCompleted && !isRunning) {
      setIsExpanded(false);
    }
  }, [isCompleted, isRunning]);

  return (
    <div className="min-w-0 space-y-3">
      {/* Task description with Logo */}
      {description && (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-start gap-2">
            {isCompleted ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            ) : (
              <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                <div className="bg-primary size-2 animate-pulse rounded-full" />
              </div>
            )}
            <span className="text-foreground line-clamp-2 min-w-0 text-sm font-medium break-words">
              {title}
            </span>
          </div>
        </div>
      )}

      {/* Collapsible tool list */}
      {tools.length > 0 && (
        <div className="border-border/40 bg-accent/20 min-w-0 overflow-hidden rounded-xl border">
          {/* Header */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent/30 flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-sm transition-colors"
          >
            <ChevronDown
              className={cn(
                'size-4 shrink-0 transition-transform',
                !isExpanded && '-rotate-90'
              )}
            />
            <span className="flex-1 text-left">
              {isExpanded
                ? t.task.hideSteps
                : t.task.showSteps.replace('{count}', String(tools.length))}
            </span>
          </button>

          {/* Tool list */}
          {isExpanded && (
            <div className="px-2 pb-2">
              {tools.map(({ message, globalIndex, result }, index) => (
                <ToolExecutionItem
                  key={globalIndex}
                  message={message}
                  result={result}
                  isFirst={index === 0}
                  isLast={
                    globalIndex === tools[tools.length - 1].globalIndex &&
                    isRunning
                  }
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Individual Message Component for non-task messages
function MessageItem({
  message,
  phase,
  onApprovePlan,
  onRejectPlan,
}: {
  message: AgentMessage;
  phase?: string;
  onApprovePlan?: () => void;
  onRejectPlan?: () => void;
}) {
  if (message.type === 'user') {
    return (
      <UserMessage
        content={message.content || ''}
        attachments={message.attachments}
      />
    );
  }

  if (message.type === 'plan' && message.plan) {
    return (
      <PlanApproval
        plan={message.plan}
        isWaitingApproval={phase === 'awaiting_approval'}
        onApprove={onApprovePlan}
        onReject={onRejectPlan}
      />
    );
  }

  if (message.type === 'text') {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <Logo />
        <div className="prose prose-sm text-foreground max-w-none min-w-0 flex-1 overflow-hidden">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pre: ({ children }: any) => (
                <pre className="bg-muted max-w-full overflow-x-auto rounded-lg p-4">
                  {children}
                </pre>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              code: ({ className, children, ...props }: any) => {
                const isInline = !className;
                if (isInline) {
                  return (
                    <code
                      className="bg-muted rounded px-1.5 py-0.5 text-sm"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              a: ({ children, href }: any) => (
                <a
                  href={href}
                  onClick={async (e) => {
                    e.preventDefault();
                    if (href) {
                      try {
                        const { openUrl } =
                          await import('@tauri-apps/plugin-opener');
                        await openUrl(href);
                      } catch {
                        window.open(href, '_blank');
                      }
                    }
                  }}
                  className="text-primary cursor-pointer hover:underline"
                >
                  {children}
                </a>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              table: ({ children }: any) => (
                <div className="overflow-x-auto">
                  <table className="border-border border-collapse border">
                    {children}
                  </table>
                </div>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              th: ({ children }: any) => (
                <th className="border-border bg-muted border px-3 py-2 text-left">
                  {children}
                </th>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              td: ({ children }: any) => (
                <td className="border-border border px-3 py-2">{children}</td>
              ),
            }}
          >
            {message.content || ''}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  if (message.type === 'result') {
    return null;
  }

  if (message.type === 'error') {
    return <ErrorMessage message={message.message || ''} />;
  }

  return null;
}

// Error Message Component with API key detection
function ErrorMessage({ message }: { message: string }) {
  const { t } = useLanguage();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Check if model is not configured (highest priority)
  if (message === '__MODEL_NOT_CONFIGURED__') {
    return (
      <>
        <div className="flex items-start gap-3 py-2">
          <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            <svg
              viewBox="0 0 16 16"
              className="size-4 text-amber-500"
              fill="currentColor"
            >
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-sm">
              {t.common.errors.modelNotConfigured}
            </p>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-primary hover:text-primary/80 cursor-pointer text-left text-sm underline underline-offset-2"
            >
              {t.common.errors.configureModel}
            </button>
          </div>
        </div>
        <SettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialCategory="model"
        />
      </>
    );
  }

  // Check if this is a Claude Code not found error
  if (message === '__CLAUDE_CODE_NOT_FOUND__') {
    return (
      <>
        <div className="flex items-start gap-3 py-2">
          <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            <svg
              viewBox="0 0 16 16"
              className="size-4 text-amber-500"
              fill="currentColor"
            >
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-sm">
              {t.common.errors.claudeCodeNotFound}
            </p>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-primary hover:text-primary/80 cursor-pointer text-left text-sm underline underline-offset-2"
            >
              {t.common.errors.configureModel}
            </button>
          </div>
        </div>
        <SettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialCategory="model"
        />
      </>
    );
  }

  // Check if this is an API key error (marker from backend)
  if (message === '__API_KEY_ERROR__') {
    return (
      <>
        <div className="flex items-start gap-3 py-2">
          <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            <svg
              viewBox="0 0 16 16"
              className="size-4 text-amber-500"
              fill="currentColor"
            >
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-sm">
              {t.common.errors.apiKeyError}
            </p>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-primary hover:text-primary/80 cursor-pointer text-left text-sm underline underline-offset-2"
            >
              {t.common.errors.configureApiKey}
            </button>
          </div>
        </div>
        <SettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialCategory="model"
        />
      </>
    );
  }

  // Check if this is a custom API error (format: __CUSTOM_API_ERROR__|baseUrl|logPath)
  const isCustomApiError = message.startsWith('__CUSTOM_API_ERROR__|');
  if (isCustomApiError) {
    const parts = message.split('|');
    const baseUrl = parts[1] || '';
    const logPath = parts[2] || '~/.workany/logs/workany.log';
    const errorMessage = (
      t.common.errors.customApiError ||
      'Custom API ({baseUrl}) may not be compatible with Claude Code SDK. Please check the API configuration or try a different provider. Log file: {logPath}'
    ).replace('{baseUrl}', baseUrl).replace('{logPath}', logPath);

    return (
      <div className="flex items-start gap-3 py-2">
        <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
          <svg
            viewBox="0 0 16 16"
            className="size-4 text-amber-500"
            fill="currentColor"
          >
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
          </svg>
        </div>
        <p className="text-muted-foreground text-sm">{errorMessage}</p>
      </div>
    );
  }

  // Check if this is an internal error (format: __INTERNAL_ERROR__|logPath)
  const isInternalError = message.startsWith('__INTERNAL_ERROR__|');
  if (isInternalError) {
    const logPath = message.split('|')[1] || '~/.workany/logs/workany.log';
    const errorMessage = (
      t.common.errors.internalError ||
      'Internal server error. Please check log file: {logPath}'
    ).replace('{logPath}', logPath);

    return (
      <div className="flex items-start gap-3 py-2">
        <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
          <svg
            viewBox="0 0 16 16"
            className="text-destructive size-4"
            fill="currentColor"
          >
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
          </svg>
        </div>
        <p className="text-muted-foreground text-sm">{errorMessage}</p>
      </div>
    );
  }

  // Fallback: Check if error text contains API key related keywords
  const isApiKeyError =
    /invalid api key|api key|authentication|unauthorized|please run \/login/i.test(
      message
    );

  if (isApiKeyError) {
    return (
      <>
        <div className="flex items-start gap-3 py-2">
          <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            <svg
              viewBox="0 0 16 16"
              className="size-4 text-amber-500"
              fill="currentColor"
            >
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-sm">
              {t.common.errors.apiKeyError}
            </p>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-primary hover:text-primary/80 cursor-pointer text-left text-sm underline underline-offset-2"
            >
              {t.common.errors.configureApiKey}
            </button>
          </div>
        </div>
        <SettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialCategory="model"
        />
      </>
    );
  }

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        <svg
          viewBox="0 0 16 16"
          className="text-destructive size-4"
          fill="currentColor"
        >
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
        </svg>
      </div>
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  );
}

// Running indicator component - shows current activity
function RunningIndicator({ messages }: { messages: AgentMessage[] }) {
  // Find the last tool_use message to show current activity
  const lastToolUse = [...messages]
    .reverse()
    .find((m) => m.type === 'tool_use');

  // Get description of current activity
  const getActivityText = () => {
    if (!lastToolUse?.name) {
      return 'Thinking...';
    }

    const input = lastToolUse.input as Record<string, unknown> | undefined;

    switch (lastToolUse.name) {
      case 'Bash':
        return `Running command...`;
      case 'Read':
        const readFile = input?.file_path
          ? String(input.file_path).split('/').pop()
          : '';
        return `Reading ${readFile || 'file'}...`;
      case 'Write':
        const writeFile = input?.file_path
          ? String(input.file_path).split('/').pop()
          : '';
        return `Writing ${writeFile || 'file'}...`;
      case 'Edit':
        const editFile = input?.file_path
          ? String(input.file_path).split('/').pop()
          : '';
        return `Editing ${editFile || 'file'}...`;
      case 'Grep':
        return 'Searching...';
      case 'Glob':
        return 'Finding files...';
      case 'WebSearch':
        return 'Searching web...';
      case 'WebFetch':
        return 'Fetching page...';
      case 'Task':
        return 'Running subtask...';
      default:
        return `Running ${lastToolUse.name}...`;
    }
  };

  return (
    <div className="flex items-center gap-2 py-2">
      {/* Spinning loader - Claude style */}
      <div className="relative size-4 shrink-0">
        <svg className="size-4 animate-spin" viewBox="0 0 24 24">
          <circle
            className="opacity-20"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            style={{ color: '#d97706' }}
          />
          <path
            className="opacity-80"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            d="M12 2a10 10 0 0 1 10 10"
            style={{ color: '#d97706' }}
          />
        </svg>
      </div>
      <span className="text-muted-foreground text-sm">{getActivityText()}</span>
    </div>
  );
}

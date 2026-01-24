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
  deleteTask,
  getAllTasks,
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
import { CheckCircle2, ChevronDown, FileText, PanelLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ArtifactPreview, type Artifact } from '@/components/artifacts';
import { Logo } from '@/components/common/logo';
import { LeftSidebar, SidebarProvider, useSidebar } from '@/components/layout';
import { SettingsModal } from '@/components/settings';
import { ChatInput } from '@/components/shared/ChatInput';
import { PlanApproval } from '@/components/task/PlanApproval';
import { QuestionInput } from '@/components/task/QuestionInput';
import { RightSidebar } from '@/components/task/RightSidebar';
import { ToolExecutionItem } from '@/components/task/ToolExecutionItem';

interface LocationState {
  prompt?: string;
  sessionId?: string;
  taskIndex?: number;
  attachments?: MessageAttachment[];
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
  return (
    <SidebarProvider>
      <TaskDetailContent />
    </SidebarProvider>
  );
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
    backgroundTasks,
  } = useAgent();
  const { toggleLeft, setLeftOpen } = useSidebar();
  const [hasStarted, setHasStarted] = useState(false);
  const isInitializingRef = useRef(false); // Prevent double initialization in Strict Mode
  const [task, setTask] = useState<Task | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevTaskIdRef = useRef<string | undefined>(undefined);

  // Panel visibility state - default to collapsed, auto-expand when content is available
  const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);

  // Auto-collapse left sidebar only when preview panel opens
  useEffect(() => {
    if (isPreviewVisible) {
      setLeftOpen(false);
    }
  }, [isPreviewVisible, setLeftOpen]);
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

  // Auto-expand right sidebar when there is actual content (only once)
  // Content includes: artifacts, working files, MCP tools, or skills
  useEffect(() => {
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
  }, [artifacts.length, messages, workingDir]);

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

  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Handle title click to start editing
  const handleTitleClick = useCallback(() => {
    const currentTitle = task?.prompt || initialPrompt;
    setEditedTitle(currentTitle);
    setIsEditingTitle(true);
  }, [task?.prompt, initialPrompt]);

  // Handle title save
  const handleTitleSave = useCallback(async () => {
    if (!taskId || !editedTitle.trim()) {
      setIsEditingTitle(false);
      return;
    }

    const trimmedTitle = editedTitle.trim();
    if (trimmedTitle !== (task?.prompt || initialPrompt)) {
      try {
        const updatedTask = await updateTask(taskId, { prompt: trimmedTitle });
        if (updatedTask) {
          setTask(updatedTask);
          // Refresh all tasks to update sidebar
          const tasks = await getAllTasks();
          setAllTasks(tasks);
        }
      } catch (error) {
        console.error('Failed to update task title:', error);
      }
    }
    setIsEditingTitle(false);
  }, [taskId, editedTitle, task?.prompt, initialPrompt]);

  // Handle title input key down
  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleTitleSave();
      } else if (e.key === 'Escape') {
        setIsEditingTitle(false);
      }
    },
    [handleTitleSave]
  );

  // Focus title input when editing starts
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

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

        // WebSearch artifacts temporarily disabled
        // TODO: Re-enable when WebSearchPreview parsing is fixed
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

  // Auto scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load all tasks for sidebar
  useEffect(() => {
    async function loadAllTasks() {
      try {
        const dbTasks = await getAllTasks();
        setAllTasks((prev) => {
          // Preserve current task if it exists in prev but not in database yet
          // This handles the race condition where optimistic update added the task
          // but database hasn't persisted it yet
          const currentTaskInPrev = prev.find((t) => t.id === taskId);
          const taskExistsInDb = dbTasks.some((t) => t.id === taskId);

          if (currentTaskInPrev && !taskExistsInDb) {
            // Keep the optimistic task at the beginning
            return [currentTaskInPrev, ...dbTasks];
          }
          return dbTasks;
        });
      } catch (error) {
        console.error('Failed to load tasks:', error);
      }
    }
    loadAllTasks();
  }, [task, taskId]);

  // Handle task deletion from sidebar
  const handleDeleteTask = async (id: string) => {
    try {
      await deleteTask(id);
      setAllTasks((prev) => prev.filter((t) => t.id !== id));
      // If deleting current task, navigate to home
      if (id === taskId) {
        navigate('/');
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  // Handle favorite toggle from sidebar
  const handleToggleFavorite = async (id: string, favorite: boolean) => {
    try {
      await updateTask(id, { favorite });
      setAllTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, favorite } : t))
      );
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

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
        // Ensure this task is in the sidebar immediately
        setAllTasks((prev) => {
          const exists = prev.some((t) => t.id === existingTask.id);
          return exists ? prev : [existingTask, ...prev];
        });
        await loadMessages(taskId);
        setHasStarted(true);
        setIsLoading(false);
      } else if (initialPrompt && !hasStarted) {
        setHasStarted(true);
        setIsLoading(false);

        // Immediately add the new task to sidebar (optimistic update)
        const newTaskPreview: Task = {
          id: taskId,
          session_id: initialSessionId || '',
          task_index: initialTaskIndex,
          prompt: initialPrompt,
          status: 'running',
          favorite: false,
          cost: 0,
          duration: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setAllTasks((prev) => [newTaskPreview, ...prev]);

        // Pass session info if available
        const sessionInfo = initialSessionId
          ? { sessionId: initialSessionId, taskIndex: initialTaskIndex }
          : undefined;
        await runAgent(initialPrompt, taskId, sessionInfo, initialAttachments);
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
    async (text: string, messageAttachments?: MessageAttachment[]) => {
      if (
        (text.trim() ||
          (messageAttachments && messageAttachments.length > 0)) &&
        !isRunning &&
        taskId
      ) {
        await continueConversation(text.trim(), messageAttachments);
      }
    },
    [isRunning, taskId, continueConversation]
  );

  const displayPrompt = task?.prompt || initialPrompt;

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
      <div className="bg-sidebar flex h-screen overflow-hidden">
        {/* Left Sidebar */}
        <LeftSidebar
          tasks={allTasks}
          currentTaskId={taskId}
          onDeleteTask={handleDeleteTask}
          onToggleFavorite={handleToggleFavorite}
          runningTaskIds={[
            ...backgroundTasks.filter((t) => t.isRunning).map((t) => t.taskId),
            // Include current task if it's running
            ...(isRunning && taskId ? [taskId] : []),
          ]}
        />

        {/* Main Content Area with Responsive Layout */}
        <div
          ref={containerRef}
          className="bg-background my-2 mr-2 flex min-w-0 flex-1 overflow-hidden rounded-2xl shadow-sm"
        >
          {/* Left Panel - Agent Chat (flex-1 to fill available space) */}
          <div
            className={cn(
              'bg-background flex min-w-0 flex-col overflow-hidden transition-all duration-200',
              !isPreviewVisible && !isRightSidebarVisible && 'rounded-2xl',
              !isPreviewVisible && isRightSidebarVisible && 'rounded-l-2xl',
              isPreviewVisible && 'rounded-l-2xl'
            )}
            style={{
              flex: isPreviewVisible ? '0 0 auto' : '1 1 0%',
              width: isPreviewVisible ? 'clamp(320px, 40%, 500px)' : undefined,
              minWidth: '320px',
              maxWidth: isPreviewVisible ? '500px' : undefined,
            }}
          >
            {/* Header - Full width */}
            <header className="border-border/50 bg-background z-10 flex shrink-0 items-center gap-2 border-none px-4 py-3">
              <button
                onClick={toggleLeft}
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex cursor-pointer items-center justify-center rounded-lg p-2 transition-colors duration-200 md:hidden"
              >
                <PanelLeft className="size-5" />
              </button>

              <div className="min-w-0 flex-1">
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    onBlur={handleTitleSave}
                    onKeyDown={handleTitleKeyDown}
                    className="text-foreground border-primary/50 focus:border-primary focus:ring-primary/30 max-w-full rounded-md border bg-transparent px-2 py-1 text-sm font-normal outline-none focus:ring-1"
                    style={{
                      width: `${Math.min(
                        Math.max(editedTitle.length + 2, 20),
                        50
                      )}ch`,
                    }}
                  />
                ) : (
                  <h1
                    onClick={handleTitleClick}
                    className="text-foreground hover:bg-accent/50 inline-block max-w-full cursor-pointer truncate rounded-md px-2 py-1 text-sm font-normal transition-colors"
                    title="Click to edit title"
                  >
                    {displayPrompt.slice(0, 40) || `Task ${taskId}`}
                    {displayPrompt.length > 40 && '...'}
                  </h1>
                )}
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
              className={cn(
                'flex-1 overflow-x-hidden overflow-y-auto',
                !isPreviewVisible &&
                  !isRightSidebarVisible &&
                  'flex justify-center'
              )}
            >
              <div
                className={cn(
                  'w-full px-6 pt-4 pb-24',
                  !isPreviewVisible && !isRightSidebarVisible && 'max-w-[800px]'
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
                'border-border/50 bg-background shrink-0 border-none',
                !isPreviewVisible &&
                  !isRightSidebarVisible &&
                  'flex justify-center'
              )}
            >
              <div
                className={cn(
                  'w-full px-4 py-3',
                  !isPreviewVisible && !isRightSidebarVisible && 'max-w-[800px]'
                )}
              >
                <ChatInput
                  variant="reply"
                  placeholder={t.home.reply}
                  isRunning={isRunning}
                  onSubmit={handleReply}
                  onStop={stopAgent}
                />
              </div>
            </div>
          </div>

          {/* Divider between chat and preview */}
          {isPreviewVisible && <div className="bg-border/50 w-px shrink-0" />}

          {/* Middle Panel - Artifact Preview (only shown when artifact selected) */}
          {isPreviewVisible && (
            <div className="bg-muted/10 flex min-w-0 flex-1 flex-col overflow-hidden">
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
          )}

          {/* Divider between preview/chat and sidebar */}
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
      </div>
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
              attachment.type === 'image' && attachment.data ? (
                <img
                  key={attachment.id}
                  src={attachment.data}
                  alt={attachment.name}
                  className="max-h-48 max-w-full rounded-lg object-contain"
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

  // Pre-process: find the last text message index before result (the final answer)
  let lastTextBeforeResultIndex = -1;
  let resultIndex = messages.findIndex((m) => m.type === 'result');
  if (resultIndex === -1) resultIndex = messages.length;

  for (let i = resultIndex - 1; i >= 0; i--) {
    if (messages[i].type === 'text' && messages[i].content) {
      lastTextBeforeResultIndex = i;
      break;
    }
  }

  // Filter messages: only keep the last text message before result, skip others
  const mergedMessages: AgentMessage[] = [];
  let textCountBeforeResult = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type === 'text' && msg.content && i < resultIndex) {
      textCountBeforeResult++;
      // Only keep the last text message before result
      if (i === lastTextBeforeResultIndex) {
        mergedMessages.push(msg);
      }
      // Skip other text messages
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

  // Find the last result message index to only show that one
  let lastResultIndex = -1;
  mergedMessages.forEach((msg, index) => {
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

  mergedMessages.forEach((message, msgIndex) => {
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
      // Plan message - render inline
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
            components={
              {
                pre: ({ children }: { children?: React.ReactNode }) => (
                  <pre className="bg-muted max-w-full overflow-x-auto rounded-lg p-4">
                    {children}
                  </pre>
                ),
                code: ({
                  className,
                  children,
                  ...props
                }: {
                  className?: string;
                  children?: React.ReactNode;
                }) => {
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
                a: ({
                  children,
                  href,
                }: {
                  children?: React.ReactNode;
                  href?: string;
                }) => (
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
                table: ({ children }: { children?: React.ReactNode }) => (
                  <div className="overflow-x-auto">
                    <table className="border-border border-collapse border">
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children }: { children?: React.ReactNode }) => (
                  <th className="border-border bg-muted border px-3 py-2 text-left">
                    {children}
                  </th>
                ),
                td: ({ children }: { children?: React.ReactNode }) => (
                  <td className="border-border border px-3 py-2">{children}</td>
                ),
              }
            }
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

  // Check if error is related to API key configuration
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
              className="text-destructive size-4"
              fill="currentColor"
            >
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-sm">
              {t.task.apiKeyError}
            </p>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-primary hover:text-primary/80 cursor-pointer text-left text-sm underline underline-offset-2"
            >
              {t.task.configureModel}
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

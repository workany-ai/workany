import { useEffect, useState } from 'react';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { Artifact, ArtifactType } from '@/components/artifacts';
import { API_BASE_URL } from '@/config';

const API_URL = API_BASE_URL;
import {
  ChevronDown,
  ChevronRight,
  Code2,
  File,
  FileCode2,
  FileEdit,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FolderOpen,
  FolderSearch,
  Globe,
  Layers,
  ListTodo,
  Loader2,
  Music,
  Presentation,
  Search,
  Table,
  Terminal,
  Type,
  Video,
  X,
} from 'lucide-react';

// Re-export types for backwards compatibility
export type { Artifact, ArtifactType };

interface ToolUsage {
  id: string;
  name: string;
  displayName: string;
  input: unknown;
  output?: string;
  isError?: boolean;
  timestamp: number;
}

interface WorkingFile {
  name: string;
  path: string;
  isDir: boolean;
  children?: WorkingFile[];
  isExpanded?: boolean;
}

interface RightSidebarProps {
  messages: AgentMessage[];
  isRunning: boolean;
  artifacts: Artifact[];
  selectedArtifact: Artifact | null;
  onSelectArtifact: (artifact: Artifact) => void;
  // Working directory for the current session
  workingDir?: string;
  // Callback when a working file is clicked
  onSelectWorkingFile?: (file: WorkingFile) => void;
  // Version number to trigger file refresh when attachments are saved
  filesVersion?: number;
}

// Get file icon based on type
function getFileIcon(type: Artifact['type']) {
  switch (type) {
    case 'html':
      return FileCode2;
    case 'jsx':
      return FileCode2;
    case 'css':
      return FileCode2;
    case 'json':
      return FileText;
    case 'image':
      return FileImage;
    case 'code':
      return FileCode2;
    case 'markdown':
      return FileType;
    case 'csv':
      return Table;
    case 'document':
      return FileText;
    case 'spreadsheet':
      return FileSpreadsheet;
    case 'presentation':
      return Presentation;
    case 'pdf':
      return FileText;
    case 'websearch':
      return Globe;
    default:
      return File;
  }
}

// Get file icon based on file extension
function getFileIconByExt(ext?: string) {
  if (!ext) return File;
  switch (ext) {
    case 'html':
    case 'htm':
      return FileCode2;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return FileCode2;
    case 'css':
    case 'scss':
    case 'less':
      return FileCode2;
    case 'json':
      return FileText;
    case 'md':
    case 'markdown':
      return FileType;
    case 'csv':
      return Table;
    case 'xlsx':
    case 'xls':
      return FileSpreadsheet;
    case 'pptx':
    case 'ppt':
      return Presentation;
    case 'docx':
    case 'doc':
      return FileText;
    case 'pdf':
      return FileText;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'bmp':
    case 'ico':
      return FileImage;
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'm4a':
    case 'aac':
    case 'flac':
    case 'wma':
    case 'aud':
    case 'aiff':
    case 'mid':
    case 'midi':
      return Music;
    case 'mp4':
    case 'webm':
    case 'mov':
    case 'avi':
    case 'mkv':
    case 'm4v':
    case 'wmv':
    case 'flv':
    case '3gp':
      return Video;
    case 'ttf':
    case 'otf':
    case 'woff':
    case 'woff2':
    case 'eot':
      return Type;
    case 'py':
    case 'rb':
    case 'go':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
      return FileCode2;
    default:
      return File;
  }
}

// Get artifact type based on file extension
function getArtifactTypeByExt(ext?: string): ArtifactType {
  if (!ext) return 'text';
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'jsx':
    case 'tsx':
      return 'jsx';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'csv':
      return 'csv';
    case 'xlsx':
    case 'xls':
      return 'spreadsheet';
    case 'pptx':
    case 'ppt':
      return 'presentation';
    case 'docx':
    case 'doc':
      return 'document';
    case 'pdf':
      return 'pdf';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'bmp':
    case 'ico':
      return 'image';
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'm4a':
    case 'aac':
    case 'flac':
    case 'wma':
    case 'aud':
    case 'aiff':
    case 'mid':
    case 'midi':
      return 'audio';
    case 'mp4':
    case 'webm':
    case 'mov':
    case 'avi':
    case 'mkv':
    case 'm4v':
    case 'wmv':
    case 'flv':
    case '3gp':
      return 'video';
    case 'ttf':
    case 'otf':
    case 'woff':
    case 'woff2':
    case 'eot':
      return 'font';
    default:
      return 'code';
  }
}

// File types that should NOT read content (binary/streaming files)
const SKIP_CONTENT_TYPES: ArtifactType[] = [
  'audio',
  'video',
  'font',
  'image',
  'pdf',
  'spreadsheet',
  'presentation',
  'document',
];

// Get tool icon based on tool name
function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'Bash':
      return Terminal;
    case 'Read':
      return FileText;
    case 'Write':
      return FileEdit;
    case 'Edit':
      return FileEdit;
    case 'Grep':
      return Search;
    case 'Glob':
      return FolderSearch;
    case 'WebFetch':
    case 'WebSearch':
      return Globe;
    case 'TodoWrite':
      return ListTodo;
    case 'Task':
      return Layers;
    case 'LSP':
      return Code2;
    default:
      return Terminal;
  }
}

// Check if a tool is an MCP tool
function isMcpTool(toolName: string): boolean {
  // MCP tools start with mcp__
  return toolName.startsWith('mcp__');
}

// Check if a tool is a Skill invocation
function isSkillTool(toolName: string): boolean {
  return toolName === 'Skill';
}

// Get display info for skill/MCP
function getSkillMCPInfo(toolName: string): { name: string; category: string } {
  if (toolName.startsWith('mcp__')) {
    // Parse MCP tool name: mcp__server__tool
    const parts = toolName.split('__');
    const serverName = parts[1] || 'unknown';
    const tool = parts[2] || '';
    return {
      name: tool || serverName,
      category: serverName,
    };
  }
  switch (toolName) {
    case 'WebSearch':
      return { name: 'Web Search', category: 'Search' };
    case 'WebFetch':
      return { name: 'Web Fetch', category: 'Web' };
    case 'Skill':
      return { name: 'Skill', category: 'Skills' };
    case 'Task':
      return { name: 'Sub Agent', category: 'Agent' };
    default:
      return { name: toolName, category: 'Tool' };
  }
}

// Extract MCP tools from messages
function extractMcpTools(messages: AgentMessage[]): ToolUsage[] {
  const tools: ToolUsage[] = [];
  const toolUseMessages = messages.filter(
    (m) => m.type === 'tool_use' && isMcpTool(m.name || '')
  );
  const toolResultMessages = messages.filter((m) => m.type === 'tool_result');

  // Create a map of tool results by toolUseId
  const resultMap = new Map<string, { output: string; isError: boolean }>();
  toolResultMessages.forEach((msg) => {
    if (msg.toolUseId) {
      resultMap.set(msg.toolUseId, {
        output: msg.output || '',
        isError: msg.isError || false,
      });
    }
  });

  toolUseMessages.forEach((msg, index) => {
    const toolName = msg.name || 'Unknown';
    const toolId = msg.id || `tool-${index}`;
    const result = resultMap.get(toolId);
    const info = getSkillMCPInfo(toolName);

    tools.push({
      id: toolId,
      name: toolName,
      displayName: info.name,
      input: msg.input,
      output: result?.output,
      isError: result?.isError,
      timestamp: Date.now() - (toolUseMessages.length - index) * 1000,
    });
  });

  return tools;
}

// Get artifact type from file extension
function getArtifactType(ext: string | undefined): ArtifactType {
  if (!ext) return 'text';
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'jsx':
    case 'tsx':
      return 'jsx';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'csv':
      return 'csv';
    case 'pdf':
      return 'pdf';
    case 'doc':
    case 'docx':
      return 'document';
    case 'xls':
    case 'xlsx':
      return 'spreadsheet';
    case 'ppt':
    case 'pptx':
      return 'presentation';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'bmp':
      return 'image';
    case 'js':
    case 'ts':
    case 'py':
    case 'rs':
    case 'go':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'rb':
    case 'php':
    case 'swift':
    case 'kt':
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'sql':
    case 'yaml':
    case 'yml':
    case 'xml':
    case 'toml':
      return 'code';
    default:
      return 'text';
  }
}

// Extract artifacts from messages
function extractArtifacts(messages: AgentMessage[]): Artifact[] {
  const artifacts: Artifact[] = [];
  const seenPaths = new Set<string>();

  messages.forEach((msg) => {
    if (msg.type === 'tool_use' && msg.name === 'Write') {
      const input = msg.input as Record<string, unknown> | undefined;
      const filePath = input?.file_path as string | undefined;
      const content = input?.content as string | undefined;

      if (filePath && !seenPaths.has(filePath)) {
        seenPaths.add(filePath);
        const filename = filePath.split('/').pop() || filePath;
        const ext = filename.split('.').pop()?.toLowerCase();
        const type = getArtifactType(ext);

        artifacts.push({
          id: filePath,
          name: filename,
          type,
          content,
          path: filePath,
        });
      }
    }
  });

  return artifacts;
}

// Collapsible Section Component
function CollapsibleSection({
  title,
  children,
  defaultExpanded = true,
  action,
}: {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  action?: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="border-border/50 border-b">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="hover:bg-accent/30 flex w-full cursor-pointer items-center justify-between px-4 py-3 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-foreground text-sm font-medium">{title}</span>
          {action && (
            <span onClick={(e) => e.stopPropagation()}>
              {action}
            </span>
          )}
        </div>
        <span className="text-muted-foreground p-0.5">
          {isExpanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
      </button>
      {isExpanded && <div className="pb-3">{children}</div>}
    </div>
  );
}

// Tool Preview Modal Component
function ToolPreviewModal({
  tool,
  onClose,
}: {
  tool: ToolUsage;
  onClose: () => void;
}) {
  const formatInput = (input: unknown): string => {
    if (!input) return 'No input';
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  };

  const formatOutput = (output: string | undefined): string => {
    if (!output) return 'No output';
    // Truncate very long output
    if (output.length > 5000) {
      return output.slice(0, 5000) + '\n\n... (truncated)';
    }
    return output;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="bg-background border-border relative flex max-h-[80vh] w-[600px] max-w-[90vw] flex-col rounded-lg border shadow-xl">
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {(() => {
              const IconComponent = getToolIcon(tool.name);
              return <IconComponent className="text-muted-foreground size-4" />;
            })()}
            <span className="font-medium">{tool.name}</span>
            {tool.isError && (
              <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-500">
                Error
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="hover:bg-accent rounded-md p-1 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-auto p-4">
          {/* Input Section */}
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">
              Input
            </h3>
            <pre className="bg-muted/50 max-h-[200px] overflow-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap">
              {formatInput(tool.input)}
            </pre>
          </div>

          {/* Output Section */}
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">
              Output
            </h3>
            <pre
              className={cn(
                'max-h-[300px] overflow-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap',
                tool.isError ? 'bg-red-500/10 text-red-400' : 'bg-muted/50'
              )}
            >
              {formatOutput(tool.output)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

// Default number of items to show before "show more"
const DEFAULT_VISIBLE_COUNT = 5;

// Max file size for text content preview (10MB)
const MAX_TEXT_FILE_SIZE = 10 * 1024 * 1024;

// Check file size via API
async function checkFileSize(filePath: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch(`${API_URL}/files/stat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: filePath }),
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.exists && data.size !== undefined) {
      return data.size;
    }
    return null;
  } catch {
    return null;
  }
}

// Read file content via API with optional abort signal
async function readFileContent(filePath: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(`${API_URL}/files/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: filePath }),
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.success && data.content !== undefined) {
      return data.content;
    }
    return null;
  } catch (err) {
    // Don't log abort errors
    if (err instanceof Error && err.name === 'AbortError') {
      return null;
    }
    return null;
  }
}

// Store active AbortController for file loading - allows cancellation when clicking another file
let activeFileLoadController: AbortController | null = null;

// File Tree Item Component for recursive directory display
function FileTreeItem({
  file,
  depth = 0,
  onSelectFile,
  onSelectArtifact,
}: {
  file: WorkingFile;
  depth?: number;
  onSelectFile?: (file: WorkingFile) => void;
  onSelectArtifact: (artifact: Artifact) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(file.isExpanded ?? false);
  const [isLoading, setIsLoading] = useState(false);
  const ext = file.name.split('.').pop()?.toLowerCase();
  const IconComponent = file.isDir ? FolderOpen : getFileIconByExt(ext);

  const handleClick = async () => {
    if (file.isDir) {
      setIsExpanded(!isExpanded);
    } else if (onSelectFile) {
      onSelectFile(file);
    } else {
      const artifactType = getArtifactTypeByExt(ext);

      // For binary/streaming files, don't read content - just pass the path
      if (SKIP_CONTENT_TYPES.includes(artifactType)) {
        const artifact: Artifact = {
          id: file.path,
          name: file.name,
          type: artifactType,
          path: file.path,
        };
        onSelectArtifact(artifact);
        return;
      }

      // Cancel any previous file loading operation
      if (activeFileLoadController) {
        activeFileLoadController.abort();
      }

      // Create new AbortController for this operation
      const controller = new AbortController();
      activeFileLoadController = controller;

      // For text-based files, check size first then load content
      setIsLoading(true);
      try {
        // Check file size first
        const fileSize = await checkFileSize(file.path, controller.signal);

        // If aborted during size check, exit
        if (controller.signal.aborted) {
          setIsLoading(false);
          return;
        }

        // If file is too large, don't read content
        if (fileSize !== null && fileSize > MAX_TEXT_FILE_SIZE) {
          const artifact: Artifact = {
            id: file.path,
            name: file.name,
            type: artifactType,
            path: file.path,
            fileSize: fileSize,
            fileTooLarge: true,
          };
          onSelectArtifact(artifact);
          setIsLoading(false);
          return;
        }

        // Read content with abort signal
        const content = await readFileContent(file.path, controller.signal);

        // If aborted during content read, exit
        if (controller.signal.aborted) {
          setIsLoading(false);
          return;
        }

        const artifact: Artifact = {
          id: file.path,
          name: file.name,
          type: artifactType,
          path: file.path,
          content: content || undefined,
          fileSize: fileSize || undefined,
        };
        onSelectArtifact(artifact);
      } finally {
        // Only clear loading if this is still the active controller
        if (activeFileLoadController === controller) {
          setIsLoading(false);
          activeFileLoadController = null;
        }
      }
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={isLoading}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 text-left transition-colors',
          'hover:bg-accent/50',
          isLoading && 'opacity-70'
        )}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
          {file.isDir ? (
            isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />
          ) : null}
        </span>
        {isLoading ? (
          <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
        ) : (
          <IconComponent className="text-muted-foreground size-4 shrink-0" />
        )}
        <span className="truncate text-sm">{file.name}</span>
      </button>
      {file.isDir && isExpanded && file.children && (
        <div>
          {file.children.map((child) => (
            <FileTreeItem
              key={child.path}
              file={child}
              depth={depth + 1}
              onSelectFile={onSelectFile}
              onSelectArtifact={onSelectArtifact}
            />
          ))}
        </div>
      )}
    </div>
  );
}


// Skills directory info
interface SkillsDirInfo {
  name: string;
  path: string;
  exists: boolean;
}

// Get skills directories from API
async function fetchSkillsDirs(): Promise<SkillsDirInfo[]> {
  try {
    const response = await fetch(`${API_URL}/files/skills-dir`);
    if (response.ok) {
      const data = await response.json();
      return (data.directories || []).filter((d: SkillsDirInfo) => d.exists);
    }
  } catch {
    // ignore
  }
  return [];
}

// Extract used skill names from messages
function extractUsedSkillNames(messages: AgentMessage[]): Set<string> {
  const skillNames = new Set<string>();
  const toolUseMessages = messages.filter(
    (m) => m.type === 'tool_use' && isSkillTool(m.name || '')
  );

  toolUseMessages.forEach((msg) => {
    const input = msg.input as Record<string, unknown> | undefined;
    const skillName = input?.skill as string;
    if (skillName) {
      skillNames.add(skillName);
    }
  });

  return skillNames;
}

export function RightSidebar({
  messages,
  isRunning: _isRunning,
  artifacts: externalArtifacts,
  selectedArtifact,
  onSelectArtifact,
  workingDir,
  onSelectWorkingFile,
  filesVersion = 0,
}: RightSidebarProps) {
  const { t } = useLanguage();
  const [selectedTool, setSelectedTool] = useState<ToolUsage | null>(null);
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);
  const [showAllTools, setShowAllTools] = useState(false);
  const [workingFiles, setWorkingFiles] = useState<WorkingFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [skillsDirs, setSkillsDirs] = useState<{ name: string; files: WorkingFile[] }[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);

  // Read directory via API (uses Node.js fs on backend)
  async function readDirViaApi(dirPath: string): Promise<WorkingFile[]> {
    try {
      const response = await fetch(`${API_URL}/files/readdir`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: dirPath, maxDepth: 3 }),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();

      if (!data.success || !data.files) {
        return [];
      }

      // Convert API response to WorkingFile format with isExpanded
      function addExpandedFlag(files: WorkingFile[], depth = 0): WorkingFile[] {
        return files.map((file) => ({
          ...file,
          isExpanded: depth === 0, // Auto-expand first level
          children: file.children ? addExpandedFlag(file.children, depth + 1) : undefined,
        }));
      }

      return addExpandedFlag(data.files);
    } catch (err) {
      console.error(`[RightSidebar] Failed to fetch directory:`, err);
      return [];
    }
  }

  // Load files from working directory via API
  // Refresh when workingDir changes, artifacts change, or files are added (e.g., attachments)
  useEffect(() => {
    async function loadWorkingFiles() {
      if (!workingDir || !workingDir.startsWith('/')) {
        setWorkingFiles([]);
        setLoadingFiles(false);
        return;
      }

      setLoadingFiles(true);
      try {
        const files = await readDirViaApi(workingDir);
        setWorkingFiles(files);
      } catch {
        setWorkingFiles([]);
      } finally {
        setLoadingFiles(false);
      }
    }

    loadWorkingFiles();
  }, [workingDir, externalArtifacts.length, filesVersion]);

  // Get used skill names from messages
  const usedSkillNames = extractUsedSkillNames(messages);

  // Load skills folders (only for used skills)
  useEffect(() => {
    async function loadSkillsFiles() {
      // Only load if there are used skills
      if (usedSkillNames.size === 0) {
        setSkillsDirs([]);
        setLoadingSkills(false);
        return;
      }

      setLoadingSkills(true);
      try {
        const dirs = await fetchSkillsDirs();
        const results: { name: string; files: WorkingFile[] }[] = [];

        for (const dir of dirs) {
          const allFiles = await readDirViaApi(dir.path);
          // Filter to only show used skills (match by folder name)
          const filteredFiles = allFiles.filter((file) => {
            // Check if folder name matches any used skill
            return file.isDir && usedSkillNames.has(file.name);
          });

          if (filteredFiles.length > 0) {
            results.push({ name: dir.name, files: filteredFiles });
          }
        }

        setSkillsDirs(results);
      } catch {
        setSkillsDirs([]);
      } finally {
        setLoadingSkills(false);
      }
    }

    loadSkillsFiles();
  }, [usedSkillNames.size]); // Re-run when used skills change

  const internalArtifacts = extractArtifacts(messages);
  const artifacts =
    externalArtifacts.length > 0 ? externalArtifacts : internalArtifacts;

  // Artifacts with show more/less (max 10)
  const visibleArtifacts = showAllArtifacts
    ? artifacts
    : artifacts.slice(0, 10);
  const hasMoreArtifacts = artifacts.length > 10;

  // MCP tools only
  const mcpTools = extractMcpTools(messages);
  const visibleTools = showAllTools
    ? mcpTools
    : mcpTools.slice(0, DEFAULT_VISIBLE_COUNT);
  const hasMoreTools = mcpTools.length > DEFAULT_VISIBLE_COUNT;

  // Open working directory in system file explorer
  const handleOpenWorkingDir = async () => {
    if (!workingDir) return;
    try {
      const response = await fetch(`${API_URL}/files/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workingDir }),
      });
      const data = await response.json();
      if (!data.success) {
        console.error('[RightSidebar] Failed to open folder:', data.error);
      }
    } catch (err) {
      console.error('[RightSidebar] Error opening folder:', err);
    }
  };

  return (
    <div className="bg-background flex h-full flex-col overflow-y-auto">
      {/* 1. Working Files Section */}
      <CollapsibleSection
        title={t.task.workingFiles}
        defaultExpanded={true}
        action={
          workingDir ? (
            <button
              onClick={handleOpenWorkingDir}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title={t.task.openInFinder}
            >
              <FolderOpen className="size-3.5" />
            </button>
          ) : null
        }
      >
        <div className="px-4">
          {!workingDir ? (
            <p className="text-muted-foreground py-2 text-sm">
              {t.task.waitingForTask}
            </p>
          ) : loadingFiles ? (
            <div className="text-muted-foreground flex items-center gap-2 py-2">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">{t.common.loading}</span>
            </div>
          ) : workingFiles.length === 0 ? (
            <p className="text-muted-foreground py-2 text-sm">{t.task.noFiles}</p>
          ) : (
            <div className="max-h-[250px] space-y-0.5 overflow-y-auto">
              {workingFiles.map((file) => (
                <FileTreeItem
                  key={file.path}
                  file={file}
                  onSelectFile={onSelectWorkingFile}
                  onSelectArtifact={onSelectArtifact}
                />
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* 2. Artifacts Section */}
      <CollapsibleSection title={t.task.artifacts}>
        <div className="px-4">
          {artifacts.length === 0 ? (
            <p className="text-muted-foreground py-2 text-sm">{t.task.noArtifacts}</p>
          ) : (
            <>
              <div className={cn(
                'space-y-1',
                showAllArtifacts && 'max-h-[300px] overflow-y-auto'
              )}>
                {visibleArtifacts.map((artifact) => {
                  const IconComponent = getFileIcon(artifact.type);
                  const isSelected = selectedArtifact?.id === artifact.id;

                  return (
                    <button
                      key={artifact.id}
                      onClick={() => onSelectArtifact(artifact)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        isSelected
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent/50'
                      )}
                    >
                      <IconComponent className="text-muted-foreground size-4 shrink-0" />
                      <span className="truncate text-sm">{artifact.name}</span>
                    </button>
                  );
                })}
              </div>
              {hasMoreArtifacts && (
                <button
                  onClick={() => setShowAllArtifacts(!showAllArtifacts)}
                  className="text-muted-foreground hover:text-foreground w-full py-2 text-center text-xs transition-colors"
                >
                  {showAllArtifacts
                    ? 'Show less'
                    : `Show ${artifacts.length - 10} more`}
                </button>
              )}
            </>
          )}
        </div>
      </CollapsibleSection>

      {/* 3. Tools Section - MCP tools only */}
      <CollapsibleSection title={t.task.tools} defaultExpanded={false}>
        <div className="px-4">
          {mcpTools.length === 0 ? (
            <p className="text-muted-foreground py-2 text-sm">{t.task.noTools}</p>
          ) : (
            <>
              <div className={cn(
                'space-y-1',
                showAllTools && 'max-h-[300px] overflow-y-auto'
              )}>
                {visibleTools.map((tool) => {
                  const IconComponent = getToolIcon(tool.name);
                  const info = getSkillMCPInfo(tool.name);
                  return (
                    <button
                      key={tool.id}
                      onClick={() => setSelectedTool(tool)}
                      className={cn(
                        'group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        'hover:bg-accent/50',
                        tool.isError && 'text-red-400'
                      )}
                    >
                      <IconComponent
                        className={cn(
                          'size-4 shrink-0',
                          tool.isError ? 'text-red-400' : 'text-muted-foreground'
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {tool.displayName}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {info.category}
                        </span>
                      </div>
                      {tool.isError && (
                        <span className="shrink-0 rounded bg-red-500/10 px-1 py-0.5 text-[10px] text-red-500">
                          Error
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {hasMoreTools && (
                <button
                  onClick={() => setShowAllTools(!showAllTools)}
                  className="text-muted-foreground hover:text-foreground w-full py-2 text-center text-xs transition-colors"
                >
                  {showAllTools
                    ? 'Show less'
                    : `Show ${mcpTools.length - DEFAULT_VISIBLE_COUNT} more`}
                </button>
              )}
            </>
          )}
        </div>
      </CollapsibleSection>

      {/* 4. Skills Section - Skills used during conversation (show folder contents) */}
      <CollapsibleSection title={t.task.skills} defaultExpanded={false}>
        <div className="px-4">
          {loadingSkills ? (
            <div className="text-muted-foreground flex items-center gap-2 py-2">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">{t.common.loading}</span>
            </div>
          ) : skillsDirs.length === 0 ? (
            <p className="text-muted-foreground py-2 text-sm">
              {t.task.noSkills}
            </p>
          ) : (
            <div className="max-h-[300px] space-y-3 overflow-y-auto">
              {skillsDirs.map((dir) => (
                <div key={dir.name}>
                  <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                    {dir.name === 'claude' ? '~/.claude/skills' : '~/.workany/skills'}
                  </div>
                  {dir.files.map((file) => (
                    <FileTreeItem
                      key={file.path}
                      file={file}
                      onSelectArtifact={onSelectArtifact}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Tool Preview Modal */}
      {selectedTool && (
        <ToolPreviewModal
          tool={selectedTool}
          onClose={() => setSelectedTool(null)}
        />
      )}
    </div>
  );
}

// Export types for external use
export type { WorkingFile };

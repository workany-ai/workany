import { startTransition, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/config';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  File,
  FileCode2,
  FileEdit,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  FolderSearch,
  Globe,
  Layers,
  ListTodo,
  Loader2,
  Music,
  Package,
  Presentation,
  Search,
  Sparkles,
  Table,
  Terminal,
  Type,
  Video,
  Wrench,
  X,
} from 'lucide-react';

import type { Artifact, ArtifactType } from '@/components/artifacts';

const API_URL = API_BASE_URL;

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
  // Session folder path (for attachments and session files)
  sessionFolder?: string;
  // Callback when a working file is clicked
  onSelectWorkingFile?: (file: WorkingFile) => void;
  // Version number to trigger file refresh when attachments are saved
  filesVersion?: number;
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
      return Wrench;
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
async function checkFileSize(
  filePath: string,
  signal?: AbortSignal
): Promise<number | null> {
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
async function readFileContent(
  filePath: string,
  signal?: AbortSignal
): Promise<string | null> {
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
        <span className="text-muted-foreground/50 flex size-4 shrink-0 items-center justify-center">
          {file.isDir ? (
            isExpanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )
          ) : null}
        </span>
        {isLoading ? (
          <Loader2 className="text-muted-foreground/60 size-3.5 shrink-0 animate-spin" />
        ) : (
          <IconComponent className="text-muted-foreground/60 size-3.5 shrink-0" />
        )}
        <span className="text-foreground/80 truncate text-sm">{file.name}</span>
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

// Empty State Component
function EmptyState({
  icon: Icon,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="bg-muted/30 rounded p-1.5">
        <Icon className="text-muted-foreground/40 size-3.5" />
      </div>
      <p className="text-muted-foreground/60 text-xs">{description}</p>
    </div>
  );
}

// Collapsible Section Component
function CollapsibleSection({
  title,
  children,
  defaultExpanded = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="border-border/50 border-b">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="hover:bg-accent/30 flex w-full cursor-pointer items-center justify-between px-4 py-3 transition-colors"
      >
        <span className="text-foreground text-sm font-medium">{title}</span>
        <span className="text-muted-foreground p-0.5">
          {isExpanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300',
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3">{children}</div>
        </div>
      </div>
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

// Extract external folders from messages (folders outside workingDir that were accessed)
function extractExternalFolders(
  messages: AgentMessage[],
  workingDir?: string
): string[] {
  const foldersSet = new Set<string>();

  // Helper to add folder if it's external
  const addIfExternal = (filePath: string) => {
    if (!filePath || !filePath.startsWith('/')) return;

    // Get folder path
    const folderPath = filePath.includes('/')
      ? filePath.substring(0, filePath.lastIndexOf('/')) || '/'
      : filePath;

    // Only add if it's not within workingDir
    if (folderPath && (!workingDir || !filePath.startsWith(workingDir))) {
      foldersSet.add(folderPath);
    }
  };

  // Helper to extract paths from Bash command
  const extractPathsFromCommand = (command: string) => {
    // Only extract from file operation commands
    const fileOpCommands = [
      'rm',
      'mv',
      'cp',
      'mkdir',
      'touch',
      'cat',
      'ls',
      'find',
      'open',
    ];
    const commandLower = command.toLowerCase().trim();

    // Check if command starts with a file operation
    const isFileOp = fileOpCommands.some(
      (op) =>
        commandLower.startsWith(op + ' ') ||
        commandLower.includes(' ' + op + ' ')
    );
    if (!isFileOp) return;

    // Folders to ignore (system/hidden folders)
    const ignoredFolders = [
      'Library',
      '.cache',
      '.npm',
      '.config',
      'node_modules',
      '.git',
      '.Trash',
    ];

    // Match absolute paths (starting with /) or home paths (starting with ~)
    const pathRegex = /(?:^|[\s"'=])((?:~|\/)[^\s"'<>|&;]+)/g;
    let match;
    while ((match = pathRegex.exec(command)) !== null) {
      let path = match[1].trim();
      // Clean up trailing punctuation
      path = path.replace(/[,;:]+$/, '');

      // Skip ignored folders
      const pathParts = path.split('/');
      if (pathParts.some((part) => ignoredFolders.includes(part))) {
        continue;
      }

      if (path.startsWith('~')) {
        // For ~ paths, add as-is (will be displayed with ~)
        const folderPath = path.includes('/')
          ? path.substring(0, path.lastIndexOf('/')) || '~'
          : path;
        if (folderPath && folderPath !== '~') {
          foldersSet.add(folderPath);
        }
      } else if (path.startsWith('/')) {
        addIfExternal(path);
      }
    }
  };

  messages.forEach((msg) => {
    if (msg.type !== 'tool_use') return;

    const input = msg.input as Record<string, unknown> | undefined;
    if (!input) return;

    switch (msg.name) {
      case 'Read':
      case 'Write':
      case 'Edit': {
        const filePath = input.file_path as string | undefined;
        if (filePath) addIfExternal(filePath);
        break;
      }
      case 'Glob': {
        // Glob has 'path' parameter for directory
        const path = input.path as string | undefined;
        if (path) addIfExternal(path);
        break;
      }
      case 'Grep': {
        // Grep has 'path' parameter
        const path = input.path as string | undefined;
        if (path) addIfExternal(path);
        break;
      }
      case 'Bash': {
        // Try to extract paths from bash command
        const command = input.command as string | undefined;
        if (command) extractPathsFromCommand(command);
        break;
      }
    }
  });

  return Array.from(foldersSet);
}

// Get file icon based on artifact type
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
    default:
      return 'code';
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

export function RightSidebar({
  messages,
  isRunning: _isRunning,
  artifacts: externalArtifacts,
  selectedArtifact,
  onSelectArtifact,
  workingDir,
  sessionFolder: _sessionFolder,
  onSelectWorkingFile,
  filesVersion = 0,
}: RightSidebarProps) {
  const { t } = useLanguage();
  const [selectedTool, setSelectedTool] = useState<ToolUsage | null>(null);
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);
  const [showAllTools, setShowAllTools] = useState(false);
  const [workingFiles, setWorkingFiles] = useState<WorkingFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [skillsDirs, setSkillsDirs] = useState<
    { name: string; files: WorkingFile[] }[]
  >([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(true);
  const [editedExpanded, setEditedExpanded] = useState(true);

  // Read directory via API (uses Node.js fs on backend)
  async function readDirViaApi(dirPath: string): Promise<WorkingFile[]> {
    try {
      console.log('[RightSidebar] readDirViaApi called with:', dirPath);
      const response = await fetch(`${API_URL}/files/readdir`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: dirPath, maxDepth: 3 }),
      });

      console.log('[RightSidebar] readDirViaApi response status:', response.status);

      if (!response.ok) {
        console.error('[RightSidebar] readDirViaApi response not ok');
        return [];
      }

      const data = await response.json();
      console.log('[RightSidebar] readDirViaApi data:', data);

      if (!data.files || !Array.isArray(data.files)) {
        console.error('[RightSidebar] readDirViaApi: no files array in response');
        return [];
      }

      if (data.error) {
        console.warn('[RightSidebar] readDirViaApi: API returned error:', data.error);
      }

      // Convert API response to WorkingFile format with isExpanded
      function addExpandedFlag(files: WorkingFile[], depth = 0): WorkingFile[] {
        return files.map((file) => ({
          ...file,
          isExpanded: false, // Default all folders to collapsed
          children: file.children
            ? addExpandedFlag(file.children, depth + 1)
            : undefined,
        }));
      }

      return addExpandedFlag(data.files);
    } catch (err) {
      console.error(`[RightSidebar] Failed to fetch directory:`, err);
      return [];
    }
  }

  // Cache for loaded working directory to avoid redundant loads
  const workingDirCacheRef = useRef<{
    dir: string;
    files: WorkingFile[];
    version: number;
  } | null>(null);

  // Load files from working directory via API
  // Refresh when workingDir changes, artifacts change, or files are added (e.g., attachments)
  useEffect(() => {
    let cancelled = false;

    async function loadWorkingFiles() {
      console.log('[RightSidebar] loadWorkingFiles called with workingDir:', workingDir);
      if (!workingDir || !workingDir.startsWith('/')) {
        console.log('[RightSidebar] workingDir is empty or invalid');
        setWorkingFiles([]);
        setLoadingFiles(false);
        return;
      }

      // Check cache: skip loading if same dir and version
      const cache = workingDirCacheRef.current;
      if (
        cache &&
        cache.dir === workingDir &&
        cache.version === filesVersion &&
        cache.files.length > 0
      ) {
        // Use cached data, no need to reload
        setWorkingFiles(cache.files);
        setLoadingFiles(false);
        return;
      }

      setLoadingFiles(true);
      try {
        const files = await readDirViaApi(workingDir);
        if (cancelled) return;

        // Update cache
        workingDirCacheRef.current = {
          dir: workingDir,
          files,
          version: filesVersion,
        };

        // Use startTransition to mark this as a low-priority update
        startTransition(() => {
          setWorkingFiles(files);
        });
      } catch {
        if (cancelled) return;
        setWorkingFiles([]);
      } finally {
        if (!cancelled) {
          setLoadingFiles(false);
        }
      }
    }

    loadWorkingFiles();

    return () => {
      cancelled = true;
    };
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

  // Extract artifacts from messages
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

  // Extract external folders (folders outside workingDir that were accessed)
  // Extract and deduplicate external folders (keep only parent paths)
  const externalFoldersRaw = extractExternalFolders(messages, workingDir);
  const externalFolders = externalFoldersRaw.filter((folder) => {
    // Remove if another folder is a parent of this one
    return !externalFoldersRaw.some(
      (other) => other !== folder && folder.startsWith(other + '/')
    );
  });

  // Get display path (shorten to folder name only)
  const getFolderName = (path: string) => path.split('/').pop() || path;

  // Open folder in system
  const handleOpenFolder = async (folderPath: string) => {
    console.log('[RightSidebar] handleOpenFolder called with:', folderPath);
    try {
      // Handle ~ paths - let backend resolve it
      const response = await fetch(`${API_URL}/files/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath, expandHome: true }),
      });
      const data = await response.json();
      console.log('[RightSidebar] handleOpenFolder response:', data);
      if (!data.success) {
        console.error('[RightSidebar] Failed to open folder:', data.error);
      }
    } catch (err) {
      console.error('[RightSidebar] Error opening folder:', err);
    }
  };

  return (
    <div className="bg-background flex h-full flex-col overflow-x-hidden overflow-y-auto">
      {/* 1. Workspace Section */}
      <CollapsibleSection
        title={t.task.workspace || 'Workspace'}
        defaultExpanded={true}
      >
        {/* Output folder subsection */}
        <div className="mt-1 mb-3">
          <div className="mb-1 flex items-center gap-1">
            <button
              onClick={() => setOutputExpanded(!outputExpanded)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              {outputExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              <span className="text-xs font-medium">
                {t.task.outputFolder || 'Output'}
              </span>
            </button>
            {workingDir && (
              <button
                onClick={() => handleOpenFolder(workingDir)}
                className="text-muted-foreground hover:text-foreground ml-auto p-0.5 transition-colors"
                title={t.task.openInFinder}
              >
                <ExternalLink className="size-3" />
              </button>
            )}
          </div>
          {outputExpanded && (
            <>
              {!workingDir ? (
                <p className="text-muted-foreground py-1 text-sm">
                  {t.task.waitingForTask}
                </p>
              ) : loadingFiles ? (
                <div className="text-muted-foreground flex items-center gap-2 py-1">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">{t.common.loading}</span>
                </div>
              ) : workingFiles.length === 0 ? (
                <EmptyState icon={Folder} description={t.task.outputsDesc} />
              ) : (
                <div className="max-h-[200px] space-y-0.5 overflow-y-auto">
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
            </>
          )}
        </div>

        {/* Edited folders subsection */}
        {externalFolders.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1">
              <button
                onClick={() => setEditedExpanded(!editedExpanded)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                {editedExpanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                <span className="text-xs font-medium">
                  {t.task.editedFolders || 'Edited'}
                </span>
              </button>
            </div>
            {editedExpanded && (
              <div className="space-y-0.5">
                {externalFolders.map((folder) => (
                  <button
                    key={folder}
                    onClick={() => handleOpenFolder(folder)}
                    className="hover:bg-accent/50 flex w-full items-center gap-1.5 rounded-md py-1 text-left transition-colors"
                  >
                    <span className="size-4 shrink-0" />
                    <FolderOpen className="text-muted-foreground/60 size-3.5 shrink-0" />
                    <span className="text-foreground/80 truncate text-sm">
                      {getFolderName(folder)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </CollapsibleSection>

      {/* 2. Artifacts Section */}
      <CollapsibleSection title={t.task.artifacts} defaultExpanded={true}>
        {artifacts.length === 0 ? (
          <EmptyState icon={Package} description={t.task.noArtifacts} />
        ) : (
          <>
            <div
              className={cn(
                'space-y-1',
                showAllArtifacts && 'max-h-[300px] overflow-y-auto'
              )}
            >
              {visibleArtifacts.map((artifact) => {
                const IconComponent = getFileIcon(artifact.type);
                const isSelected = selectedArtifact?.id === artifact.id;

                return (
                  <button
                    key={artifact.id}
                    onClick={() => onSelectArtifact(artifact)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors',
                      isSelected ? 'bg-accent/60' : 'hover:bg-accent/30'
                    )}
                  >
                    <IconComponent
                      className={cn(
                        'size-3.5 shrink-0',
                        isSelected
                          ? 'text-foreground/70'
                          : 'text-muted-foreground/60'
                      )}
                    />
                    <span
                      className={cn(
                        'truncate text-sm',
                        isSelected ? 'text-foreground' : 'text-foreground/80'
                      )}
                    >
                      {artifact.name}
                    </span>
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
      </CollapsibleSection>

      {/* 3. Tools Section - MCP tools */}
      <CollapsibleSection title={t.task.tools} defaultExpanded={false}>
        {mcpTools.length === 0 ? (
          <EmptyState icon={Wrench} description={t.task.noTools} />
        ) : (
          <>
            <div
              className={cn(
                'space-y-1',
                showAllTools && 'max-h-[300px] overflow-y-auto'
              )}
            >
              {visibleTools.map((tool) => {
                const IconComponent = getToolIcon(tool.name);
                return (
                  <button
                    key={tool.id}
                    onClick={() => setSelectedTool(tool)}
                    className={cn(
                      'group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 text-left transition-colors',
                      'hover:bg-accent/50',
                      tool.isError && 'text-red-400'
                    )}
                  >
                    <IconComponent
                      className={cn(
                        'size-3.5 shrink-0',
                        tool.isError
                          ? 'text-red-400'
                          : 'text-muted-foreground/60'
                      )}
                    />
                    <span className="text-foreground/80 truncate text-sm">
                      {tool.displayName}
                    </span>
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
      </CollapsibleSection>

      {/* 4. Skills Section */}
      <CollapsibleSection title={t.task.skills} defaultExpanded={false}>
        {loadingSkills ? (
          <div className="text-muted-foreground flex items-center gap-2 py-2">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">{t.common.loading}</span>
          </div>
        ) : usedSkillNames.size === 0 ? (
          <EmptyState icon={Sparkles} description={t.task.noSkills} />
        ) : skillsDirs.length === 0 ? (
          // Show skill names only if skill files couldn't be loaded
          <div className="max-h-[300px] space-y-1 overflow-y-auto">
            {Array.from(usedSkillNames).map((skillName) => (
              <div
                key={skillName}
                className="flex items-center gap-2 rounded-md px-2 py-1.5"
              >
                <Sparkles className="text-muted-foreground/60 size-3.5 shrink-0" />
                <span className="text-foreground/80 truncate text-sm">
                  {skillName}
                </span>
              </div>
            ))}
          </div>
        ) : (
          // Show skill files/content
          <div className="max-h-[300px] space-y-0.5 overflow-y-auto">
            {skillsDirs.map((dir) => (
              <div key={dir.name}>
                {dir.files.map((file) => (
                  <FileTreeItem
                    key={file.path}
                    file={{ ...file, isExpanded: false }}
                    onSelectFile={onSelectWorkingFile}
                    onSelectArtifact={onSelectArtifact}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
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

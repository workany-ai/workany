// Database types for sessions, tasks and messages

export type TaskStatus = 'running' | 'completed' | 'error' | 'stopped';

// Session represents a conversation context that can contain multiple tasks
export interface Session {
  id: string; // Format: YYYYMMDDHHmmss_slug
  prompt: string; // Original prompt that started the session
  task_count: number; // Number of tasks in this session
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  session_id: string; // Reference to session
  task_index: number; // Index within session (1, 2, 3...)
  prompt: string;
  status: TaskStatus;
  cost: number | null;
  duration: number | null;
  favorite?: boolean; // Whether task is favorited
  agent_id?: string | null; // Reference to agent that ran this task
  created_at: string;
  updated_at: string;
}

export type MessageType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'error'
  | 'user'
  | 'plan';

export interface Message {
  id: number;
  task_id: string;
  type: MessageType;
  content: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  tool_use_id: string | null;
  subtype: string | null;
  error_message: string | null;
  attachments: string | null; // JSON string of MessageAttachment[]
  created_at: string;
}

// Input types for creating records
export interface CreateSessionInput {
  id: string;
  prompt: string;
}

export interface CreateTaskInput {
  id: string;
  session_id: string;
  task_index: number;
  prompt: string;
  agent_id?: string;
}

export interface CreateMessageInput {
  task_id: string;
  type: MessageType;
  content?: string;
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
  tool_use_id?: string;
  subtype?: string;
  error_message?: string;
  attachments?: string; // JSON string of MessageAttachment[]
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  cost?: number;
  duration?: number;
  prompt?: string;
  favorite?: boolean;
  agent_id?: string;
}

// Library file types
export type FileType =
  | 'image'
  | 'text'
  | 'code'
  | 'document'
  | 'website'
  | 'presentation'
  | 'spreadsheet';

export interface LibraryFile {
  id: number;
  task_id: string;
  name: string;
  type: FileType;
  path: string;
  preview: string | null;
  thumbnail: string | null;
  is_favorite: boolean;
  created_at: string;
}

export interface CreateFileInput {
  task_id: string;
  name: string;
  type: FileType;
  path: string;
  preview?: string;
  thumbnail?: string;
}

// ============ Agent Types ============
export interface Agent {
  id: string;
  name: string;
  avatar: string | null;
  soul_md: string;
  model_provider: string | null;
  model_name: string | null;
  model_config: string | null; // JSON string
  mcp_config: string | null; // JSON string
  tools: string | null; // JSON string
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentInput {
  id: string;
  name: string;
  avatar?: string;
  soul_md?: string;
  model_provider?: string;
  model_name?: string;
  model_config?: string;
  mcp_config?: string;
  tools?: string;
  is_default?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  avatar?: string | null;
  soul_md?: string;
  model_provider?: string | null;
  model_name?: string | null;
  model_config?: string | null;
  mcp_config?: string | null;
  tools?: string | null;
  is_default?: boolean;
}

// ============ Team Types ============
export interface Team {
  id: string;
  name: string;
  description: string;
  avatar: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTeamInput {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
  avatar?: string | null;
}

export type TeamMemberRole = 'lead' | 'member' | 'reviewer';

export interface TeamMember {
  id: number;
  team_id: string;
  agent_id: string;
  role: TeamMemberRole;
  created_at: string;
}

// ============ Project Types ============
export type ProjectStatus = 'active' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string;
  team_id: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  id: string;
  name: string;
  description?: string;
  team_id?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  team_id?: string | null;
  status?: ProjectStatus;
}

// ============ Issue Types ============
export type IssueStatus = 'open' | 'in_progress' | 'done' | 'closed';
export type IssuePriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Issue {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigned_agent_id: string | null;
  task_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIssueInput {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  priority?: IssuePriority;
  assigned_agent_id?: string;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigned_agent_id?: string | null;
  task_id?: string | null;
}

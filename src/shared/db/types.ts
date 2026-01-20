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

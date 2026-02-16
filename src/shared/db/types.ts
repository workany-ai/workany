// Database types for sessions, tasks and messages

export type TaskStatus = 'running' | 'completed' | 'error' | 'stopped';
export type TaskType = 'local' | 'bot'; // 新增: 区分本地任务和Bot对话

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
  type: TaskType; // 新增: 区分本地任务(local)和Bot对话(bot)
  label?: string; // 新增: Bot对话标题
  last_message?: string; // 新增: 最后消息预览
  message_count?: number; // 新增: 消息数量
  remote_updated_at?: number; // 新增: 云端更新时间戳
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
  message_key?: string; // 新增: 消息唯一标识 (用于去重)
  type: MessageType;
  content: string | null;
  role?: string; // 新增: 'user' | 'assistant' | 'toolResult' (Bot消息用)
  timestamp?: number; // 新增: 原始时间戳 (用于排序和去重)
  raw_content?: string; // 新增: Bot消息的原始JSON (BotContentPart[])
  details?: string; // 新增: Bot消息的details JSON
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  tool_use_id: string | null;
  subtype: string | null;
  error_message: string | null;
  is_error?: boolean; // 新增: 是否为错误消息
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
  type?: TaskType; // 新增
  label?: string; // 新增
  last_message?: string; // 新增
  message_count?: number; // 新增
  remote_updated_at?: number; // 新增
}

export interface CreateMessageInput {
  task_id: string;
  message_key?: string; // 新增
  type: MessageType;
  content?: string;
  role?: string; // 新增
  timestamp?: number; // 新增
  raw_content?: string; // 新增
  details?: string; // 新增
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
  tool_use_id?: string;
  subtype?: string;
  error_message?: string;
  is_error?: boolean; // 新增
  attachments?: string; // JSON string of MessageAttachment[]
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  cost?: number;
  duration?: number;
  prompt?: string;
  favorite?: boolean;
  label?: string; // 新增
  last_message?: string; // 新增
  message_count?: number; // 新增
  remote_updated_at?: number; // 新增
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

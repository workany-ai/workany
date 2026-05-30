import type {
  Agent,
  CreateAgentInput,
  CreateFileInput,
  CreateIssueInput,
  CreateMessageInput,
  CreateProjectInput,
  CreateSessionInput,
  CreateTaskInput,
  CreateTeamInput,
  Issue,
  LibraryFile,
  Message,
  Project,
  Session,
  Task,
  Team,
  TeamMember,
  TeamMemberRole,
  UpdateAgentInput,
  UpdateIssueInput,
  UpdateProjectInput,
  UpdateTaskInput,
  UpdateTeamInput,
} from './types';

const SQLITE_DB_NAME = 'sqlite:workany.db';
const IDB_NAME = 'workany';
const IDB_VERSION = 3; // Bump version for agents/teams/projects/issues

// Check if running in Tauri environment synchronously
function isTauriSync(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // Check for Tauri v2 internals
  const hasTauriInternals = '__TAURI_INTERNALS__' in window;
  // Check for legacy Tauri v1
  const hasTauri = '__TAURI__' in window;

  return hasTauriInternals || hasTauri;
}

// ============ IndexedDB for Browser Mode ============
let idb: IDBDatabase | null = null;

async function getIndexedDB(): Promise<IDBDatabase> {
  if (idb) return idb;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onerror = () => {
      console.error('[IDB] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      idb = request.result;
      console.log('[IDB] Database opened successfully');
      resolve(idb);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      console.log('[IDB] Upgrading database...');

      // Create sessions store (v2)
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionsStore = db.createObjectStore('sessions', {
          keyPath: 'id',
        });
        sessionsStore.createIndex('created_at', 'created_at', {
          unique: false,
        });
      }

      // Create tasks store
      if (!db.objectStoreNames.contains('tasks')) {
        const tasksStore = db.createObjectStore('tasks', { keyPath: 'id' });
        tasksStore.createIndex('created_at', 'created_at', { unique: false });
        tasksStore.createIndex('session_id', 'session_id', { unique: false });
      }

      // Create messages store
      if (!db.objectStoreNames.contains('messages')) {
        const messagesStore = db.createObjectStore('messages', {
          keyPath: 'id',
          autoIncrement: true,
        });
        messagesStore.createIndex('task_id', 'task_id', { unique: false });
      }

      // Create files store
      if (!db.objectStoreNames.contains('files')) {
        const filesStore = db.createObjectStore('files', {
          keyPath: 'id',
          autoIncrement: true,
        });
        filesStore.createIndex('task_id', 'task_id', { unique: false });
      }

      // Create agents store (v3)
      if (!db.objectStoreNames.contains('agents')) {
        const agentsStore = db.createObjectStore('agents', { keyPath: 'id' });
        agentsStore.createIndex('created_at', 'created_at', { unique: false });
      }

      // Create teams store (v3)
      if (!db.objectStoreNames.contains('teams')) {
        const teamsStore = db.createObjectStore('teams', { keyPath: 'id' });
        teamsStore.createIndex('created_at', 'created_at', { unique: false });
      }

      // Create team_members store (v3)
      if (!db.objectStoreNames.contains('team_members')) {
        const tmStore = db.createObjectStore('team_members', {
          keyPath: 'id',
          autoIncrement: true,
        });
        tmStore.createIndex('team_id', 'team_id', { unique: false });
        tmStore.createIndex('agent_id', 'agent_id', { unique: false });
      }

      // Create projects store (v3)
      if (!db.objectStoreNames.contains('projects')) {
        const projectsStore = db.createObjectStore('projects', { keyPath: 'id' });
        projectsStore.createIndex('created_at', 'created_at', { unique: false });
      }

      // Create issues store (v3)
      if (!db.objectStoreNames.contains('issues')) {
        const issuesStore = db.createObjectStore('issues', { keyPath: 'id' });
        issuesStore.createIndex('project_id', 'project_id', { unique: false });
        issuesStore.createIndex('assigned_agent_id', 'assigned_agent_id', { unique: false });
      }

      console.log('[IDB] Database upgraded successfully');
    };
  });
}

// Helper to promisify IDB requests
function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ============ Tauri SQLite ============
let sqliteDb: Awaited<
  ReturnType<typeof import('@tauri-apps/plugin-sql').default.load>
> | null = null;

async function getSQLiteDatabase() {
  if (!isTauriSync()) {
    return null;
  }

  if (!sqliteDb) {
    try {
      const Database = (await import('@tauri-apps/plugin-sql')).default;
      sqliteDb = await Database.load(SQLITE_DB_NAME);
      console.log('[SQLite] Database connected successfully');
    } catch (error) {
      console.error('[SQLite] Failed to connect:', error);
      return null;
    }
  }
  return sqliteDb;
}

// ============ Session Operations ============
export async function createSession(
  input: CreateSessionInput
): Promise<Session> {
  const now = new Date().toISOString();
  const session: Session = {
    id: input.id,
    prompt: input.prompt,
    task_count: 0,
    created_at: now,
    updated_at: now,
  };

  const database = await getSQLiteDatabase();

  if (database) {
    // SQLite (Tauri) - sessions table may not exist in older DBs
    try {
      await database.execute(
        'INSERT INTO sessions (id, prompt, task_count) VALUES ($1, $2, $3)',
        [input.id, input.prompt, 0]
      );
    } catch {
      // If sessions table doesn't exist, create it first
      await database.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY NOT NULL,
          prompt TEXT NOT NULL,
          task_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await database.execute(
        'INSERT INTO sessions (id, prompt, task_count) VALUES ($1, $2, $3)',
        [input.id, input.prompt, 0]
      );
    }
    return session;
  } else {
    // IndexedDB (Browser)
    const db = await getIndexedDB();
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    await idbRequest(store.put(session));
    console.log('[IDB] Created session:', input.id);
    return session;
  }
}

export async function getSession(id: string): Promise<Session | null> {
  const database = await getSQLiteDatabase();

  if (database) {
    try {
      const result = await database.select<Session[]>(
        'SELECT * FROM sessions WHERE id = $1',
        [id]
      );
      return result[0] || null;
    } catch {
      return null;
    }
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const result = await idbRequest(store.get(id));
    return result || null;
  }
}

export async function getAllSessions(): Promise<Session[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    try {
      const sessions = await database.select<Session[]>(
        'SELECT * FROM sessions ORDER BY created_at DESC'
      );
      return sessions;
    } catch {
      return [];
    }
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const sessions = await idbRequest(store.getAll());
    return sessions.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
}

export async function updateSessionTaskCount(
  sessionId: string,
  taskCount: number
): Promise<void> {
  const database = await getSQLiteDatabase();

  if (database) {
    try {
      await database.execute(
        "UPDATE sessions SET task_count = $1, updated_at = datetime('now') WHERE id = $2",
        [taskCount, sessionId]
      );
    } catch {
      // Session table may not exist
    }
  } else {
    const db = await getIndexedDB();
    const session = await getSession(sessionId);
    if (session) {
      const updatedSession = {
        ...session,
        task_count: taskCount,
        updated_at: new Date().toISOString(),
      };
      const tx = db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      await idbRequest(store.put(updatedSession));
    }
  }
}

export async function getTasksBySessionId(sessionId: string): Promise<Task[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    try {
      const tasks = await database.select<Task[]>(
        'SELECT * FROM tasks WHERE session_id = $1 ORDER BY task_index ASC',
        [sessionId]
      );
      // Convert favorite from 0/1 to boolean for all tasks
      return tasks.map((task) => ({
        ...task,
        favorite: task.favorite !== undefined ? Boolean(task.favorite) : false,
      }));
    } catch {
      // session_id column may not exist in older DBs
      return [];
    }
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    try {
      const index = store.index('session_id');
      const tasks = await idbRequest(index.getAll(sessionId));
      return tasks.sort((a, b) => (a.task_index || 0) - (b.task_index || 0));
    } catch {
      // Index may not exist
      return [];
    }
  }
}

// ============ Task Operations ============
export async function createTask(input: CreateTaskInput): Promise<Task> {
  const now = new Date().toISOString();
  const task: Task = {
    id: input.id,
    session_id: input.session_id,
    task_index: input.task_index,
    prompt: input.prompt,
    status: 'running',
    cost: null,
    duration: null,
    created_at: now,
    updated_at: now,
  };

  const database = await getSQLiteDatabase();

  if (database) {
    // SQLite (Tauri) - Try with new schema, fallback to old
    try {
      await database.execute(
        'INSERT INTO tasks (id, session_id, task_index, prompt) VALUES ($1, $2, $3, $4)',
        [input.id, input.session_id, input.task_index, input.prompt]
      );
    } catch {
      // Fallback for older schema without session_id
      await database.execute('INSERT INTO tasks (id, prompt) VALUES ($1, $2)', [
        input.id,
        input.prompt,
      ]);
    }
    const result = await getTask(input.id);
    if (!result) throw new Error('Failed to create task');

    // Update session task count
    await updateSessionTaskCount(input.session_id, input.task_index);

    return result;
  } else {
    // IndexedDB (Browser)
    const db = await getIndexedDB();
    const tx = db.transaction('tasks', 'readwrite');
    const store = tx.objectStore('tasks');
    await idbRequest(store.put(task));
    console.log('[IDB] Created task:', input.id);

    // Update session task count
    await updateSessionTaskCount(input.session_id, input.task_index);

    return task;
  }
}

export async function getTask(id: string): Promise<Task | null> {
  const database = await getSQLiteDatabase();

  if (database) {
    const result = await database.select<Task[]>(
      'SELECT * FROM tasks WHERE id = $1',
      [id]
    );
    const task = result[0] || null;
    // Convert favorite from 0/1 to boolean
    if (task && task.favorite !== undefined) {
      task.favorite = Boolean(task.favorite);
    }
    return task;
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    const result = await idbRequest(store.get(id));
    return result || null;
  }
}

export async function getAllTasks(): Promise<Task[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    const tasks = await database.select<Task[]>(
      'SELECT * FROM tasks ORDER BY created_at DESC'
    );
    // Convert favorite from 0/1 to boolean for all tasks
    return tasks.map((task) => ({
      ...task,
      favorite: task.favorite !== undefined ? Boolean(task.favorite) : false,
    }));
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    const tasks = await idbRequest(store.getAll());
    // Sort by created_at descending
    return tasks.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput
): Promise<Task | null> {
  const database = await getSQLiteDatabase();

  if (database) {
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    let paramIndex = 1;

    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }
    if (input.cost !== undefined) {
      updates.push(`cost = $${paramIndex++}`);
      values.push(input.cost);
    }
    if (input.duration !== undefined) {
      updates.push(`duration = $${paramIndex++}`);
      values.push(input.duration);
    }
    if (input.prompt !== undefined) {
      updates.push(`prompt = $${paramIndex++}`);
      values.push(input.prompt);
    }
    if (input.favorite !== undefined) {
      updates.push(`favorite = $${paramIndex++}`);
      values.push(input.favorite ? 1 : 0);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = datetime('now')`);
      values.push(id);
      try {
        await database.execute(
          `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
          values
        );
      } catch (error) {
        // If favorite column doesn't exist, add it and retry
        if (
          input.favorite !== undefined &&
          String(error).includes('favorite')
        ) {
          await database.execute(
            'ALTER TABLE tasks ADD COLUMN favorite INTEGER DEFAULT 0'
          );
          await database.execute(
            `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
            values
          );
        } else {
          throw error;
        }
      }
    }

    return getTask(id);
  } else {
    const db = await getIndexedDB();
    const task = await getTask(id);
    if (task) {
      const updatedTask = {
        ...task,
        ...input,
        updated_at: new Date().toISOString(),
      };
      const tx = db.transaction('tasks', 'readwrite');
      const store = tx.objectStore('tasks');
      await idbRequest(store.put(updatedTask));
      return updatedTask;
    }
    return null;
  }
}

export async function deleteTask(id: string): Promise<boolean> {
  const database = await getSQLiteDatabase();

  if (database) {
    const result = await database.execute('DELETE FROM tasks WHERE id = $1', [
      id,
    ]);
    return result.rowsAffected > 0;
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('tasks', 'readwrite');
    const store = tx.objectStore('tasks');
    await idbRequest(store.delete(id));
    // Also delete related messages
    await deleteMessagesByTaskId(id);
    return true;
  }
}

// ============ Message Operations ============
export async function createMessage(
  input: CreateMessageInput
): Promise<Message> {
  const now = new Date().toISOString();
  const database = await getSQLiteDatabase();

  if (database) {
    // Try with attachments column first, fallback to without
    try {
      const result = await database.execute(
        `INSERT INTO messages (task_id, type, content, tool_name, tool_input, tool_output, tool_use_id, subtype, error_message, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.task_id,
          input.type,
          input.content || null,
          input.tool_name || null,
          input.tool_input || null,
          input.tool_output || null,
          input.tool_use_id || null,
          input.subtype || null,
          input.error_message || null,
          input.attachments || null,
        ]
      );

      const messages = await database.select<Message[]>(
        'SELECT * FROM messages WHERE id = $1',
        [result.lastInsertId]
      );
      return messages[0];
    } catch {
      // Fallback: add attachments column if it doesn't exist
      try {
        await database.execute(
          'ALTER TABLE messages ADD COLUMN attachments TEXT'
        );
      } catch {
        // Column may already exist
      }

      const result = await database.execute(
        `INSERT INTO messages (task_id, type, content, tool_name, tool_input, tool_output, tool_use_id, subtype, error_message, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.task_id,
          input.type,
          input.content || null,
          input.tool_name || null,
          input.tool_input || null,
          input.tool_output || null,
          input.tool_use_id || null,
          input.subtype || null,
          input.error_message || null,
          input.attachments || null,
        ]
      );

      const messages = await database.select<Message[]>(
        'SELECT * FROM messages WHERE id = $1',
        [result.lastInsertId]
      );
      return messages[0];
    }
  } else {
    const db = await getIndexedDB();
    const message: Omit<Message, 'id'> & { id?: number } = {
      task_id: input.task_id,
      type: input.type,
      content: input.content || null,
      tool_name: input.tool_name || null,
      tool_input: input.tool_input || null,
      tool_output: input.tool_output || null,
      tool_use_id: input.tool_use_id || null,
      subtype: input.subtype || null,
      error_message: input.error_message || null,
      attachments: input.attachments || null,
      created_at: now,
    };

    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const id = await idbRequest(store.add(message));
    return { ...message, id: id as number } as Message;
  }
}

export async function getMessagesByTaskId(taskId: string): Promise<Message[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    return database.select<Message[]>(
      'SELECT * FROM messages WHERE task_id = $1 ORDER BY created_at ASC',
      [taskId]
    );
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const index = store.index('task_id');
    const messages = await idbRequest(index.getAll(taskId));
    return messages.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }
}

export async function deleteMessagesByTaskId(taskId: string): Promise<number> {
  const database = await getSQLiteDatabase();

  if (database) {
    const result = await database.execute(
      'DELETE FROM messages WHERE task_id = $1',
      [taskId]
    );
    return result.rowsAffected;
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const index = store.index('task_id');
    const messages = await idbRequest(index.getAll(taskId));

    for (const message of messages) {
      await idbRequest(store.delete(message.id));
    }
    return messages.length;
  }
}

// Helper function to update task status based on message type
export async function updateTaskFromMessage(
  taskId: string,
  messageType: string,
  subtype?: string,
  cost?: number,
  duration?: number
): Promise<void> {
  if (messageType === 'result') {
    // Only mark as completed for actual success
    // error_max_turns means the task was interrupted, not completed
    // Keep it in 'running' state so user knows to continue
    if (subtype === 'success') {
      await updateTask(taskId, { status: 'completed', cost, duration });
    } else if (subtype === 'error_max_turns') {
      // Task hit max turns limit - keep as running, just update cost/duration
      await updateTask(taskId, { cost, duration });
      console.log(
        `[Database] Task ${taskId} hit max turns limit, keeping as running`
      );
    } else {
      // Other errors
      await updateTask(taskId, { status: 'error', cost, duration });
    }
  } else if (messageType === 'error') {
    await updateTask(taskId, { status: 'error' });
  }
}

// Export utility to check environment
export function isDatabaseAvailable(): boolean {
  return isTauriSync();
}

// ============ Library File Operations ============
export async function createFile(input: CreateFileInput): Promise<LibraryFile> {
  const now = new Date().toISOString();
  const database = await getSQLiteDatabase();

  if (database) {
    const result = await database.execute(
      `INSERT INTO files (task_id, name, type, path, preview, thumbnail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.task_id,
        input.name,
        input.type,
        input.path,
        input.preview || null,
        input.thumbnail || null,
      ]
    );

    const files = await database.select<LibraryFile[]>(
      'SELECT * FROM files WHERE id = $1',
      [result.lastInsertId]
    );
    return files[0];
  } else {
    const db = await getIndexedDB();
    const file: Omit<LibraryFile, 'id'> & { id?: number } = {
      task_id: input.task_id,
      name: input.name,
      type: input.type,
      path: input.path,
      preview: input.preview || null,
      thumbnail: input.thumbnail || null,
      is_favorite: false,
      created_at: now,
    };

    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    const id = await idbRequest(store.add(file));
    return { ...file, id: id as number } as LibraryFile;
  }
}

export async function getFilesByTaskId(taskId: string): Promise<LibraryFile[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    return database.select<LibraryFile[]>(
      'SELECT * FROM files WHERE task_id = $1 ORDER BY created_at ASC',
      [taskId]
    );
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('files', 'readonly');
    const store = tx.objectStore('files');
    const index = store.index('task_id');
    const files = await idbRequest(index.getAll(taskId));
    return files.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }
}

export async function getAllFiles(): Promise<LibraryFile[]> {
  const database = await getSQLiteDatabase();

  if (database) {
    return database.select<LibraryFile[]>(
      'SELECT * FROM files ORDER BY created_at DESC'
    );
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('files', 'readonly');
    const store = tx.objectStore('files');
    const files = await idbRequest(store.getAll());
    return files.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
}

export async function toggleFileFavorite(
  fileId: number
): Promise<LibraryFile | null> {
  const database = await getSQLiteDatabase();

  if (database) {
    await database.execute(
      'UPDATE files SET is_favorite = NOT is_favorite WHERE id = $1',
      [fileId]
    );
    const files = await database.select<LibraryFile[]>(
      'SELECT * FROM files WHERE id = $1',
      [fileId]
    );
    return files[0] || null;
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    const file = await idbRequest(store.get(fileId));
    if (file) {
      file.is_favorite = !file.is_favorite;
      await idbRequest(store.put(file));
      return file;
    }
    return null;
  }
}

export async function deleteFile(fileId: number): Promise<boolean> {
  const database = await getSQLiteDatabase();

  if (database) {
    const result = await database.execute('DELETE FROM files WHERE id = $1', [
      fileId,
    ]);
    return result.rowsAffected > 0;
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    await idbRequest(store.delete(fileId));
    return true;
  }
}

// Get files grouped by task with task info
export async function getFilesGroupedByTask(): Promise<
  { task: Task; files: LibraryFile[] }[]
> {
  const allFiles = await getAllFiles();
  const allTasks = await getAllTasks();

  // Create a map of task_id to files
  const filesByTask = new Map<string, LibraryFile[]>();
  for (const file of allFiles) {
    const existing = filesByTask.get(file.task_id) || [];
    existing.push(file);
    filesByTask.set(file.task_id, existing);
  }

  // Build result with task info
  const result: { task: Task; files: LibraryFile[] }[] = [];
  for (const task of allTasks) {
    const files = filesByTask.get(task.id);
    if (files && files.length > 0) {
      result.push({ task, files });
    }
  }

  return result;
}

// ============ Agent Operations ============
export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const now = new Date().toISOString();
  const agent: Agent = {
    id: input.id,
    name: input.name,
    avatar: input.avatar || null,
    soul_md: input.soul_md || '',
    model_provider: input.model_provider || null,
    model_name: input.model_name || null,
    model_config: input.model_config || null,
    mcp_config: input.mcp_config || null,
    tools: input.tools || null,
    is_default: input.is_default || false,
    created_at: now,
    updated_at: now,
  };

  const database = await getSQLiteDatabase();
  if (database) {
    await database.execute(
      `INSERT INTO agents (id, name, avatar, soul_md, model_provider, model_name, model_config, mcp_config, tools, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [input.id, input.name, agent.avatar, agent.soul_md, agent.model_provider, agent.model_name, agent.model_config, agent.mcp_config, agent.tools, agent.is_default ? 1 : 0]
    );
    return agent;
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('agents', 'readwrite');
    await idbRequest(tx.objectStore('agents').put(agent));
    return agent;
  }
}

export async function getAgent(id: string): Promise<Agent | null> {
  const database = await getSQLiteDatabase();
  if (database) {
    const result = await database.select<Agent[]>('SELECT * FROM agents WHERE id = $1', [id]);
    const a = result[0] || null;
    if (a) a.is_default = Boolean(a.is_default);
    return a;
  } else {
    const db = await getIndexedDB();
    const result = await idbRequest(db.transaction('agents', 'readonly').objectStore('agents').get(id));
    return result || null;
  }
}

export async function getAllAgents(): Promise<Agent[]> {
  const database = await getSQLiteDatabase();
  if (database) {
    const agents = await database.select<Agent[]>('SELECT * FROM agents ORDER BY created_at DESC');
    return agents.map((a) => ({ ...a, is_default: Boolean(a.is_default) }));
  } else {
    const db = await getIndexedDB();
    const agents = await idbRequest(db.transaction('agents', 'readonly').objectStore('agents').getAll());
    return agents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
}

export async function updateAgent(id: string, input: UpdateAgentInput): Promise<Agent | null> {
  const database = await getSQLiteDatabase();
  if (database) {
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    let idx = 1;
    if (input.name !== undefined) { updates.push(`name = $${idx++}`); values.push(input.name); }
    if (input.avatar !== undefined) { updates.push(`avatar = $${idx++}`); values.push(input.avatar); }
    if (input.soul_md !== undefined) { updates.push(`soul_md = $${idx++}`); values.push(input.soul_md); }
    if (input.model_provider !== undefined) { updates.push(`model_provider = $${idx++}`); values.push(input.model_provider); }
    if (input.model_name !== undefined) { updates.push(`model_name = $${idx++}`); values.push(input.model_name); }
    if (input.model_config !== undefined) { updates.push(`model_config = $${idx++}`); values.push(input.model_config); }
    if (input.mcp_config !== undefined) { updates.push(`mcp_config = $${idx++}`); values.push(input.mcp_config); }
    if (input.tools !== undefined) { updates.push(`tools = $${idx++}`); values.push(input.tools); }
    if (input.is_default !== undefined) { updates.push(`is_default = $${idx++}`); values.push(input.is_default ? 1 : 0); }
    if (updates.length > 0) {
      updates.push(`updated_at = datetime('now')`);
      values.push(id);
      await database.execute(`UPDATE agents SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    }
    return getAgent(id);
  } else {
    const db = await getIndexedDB();
    const agent = await getAgent(id);
    if (!agent) return null;
    const updated = { ...agent, ...input, updated_at: new Date().toISOString() };
    const tx = db.transaction('agents', 'readwrite');
    await idbRequest(tx.objectStore('agents').put(updated));
    return updated;
  }
}

export async function deleteAgent(id: string): Promise<boolean> {
  const database = await getSQLiteDatabase();
  if (database) {
    const result = await database.execute('DELETE FROM agents WHERE id = $1', [id]);
    return result.rowsAffected > 0;
  } else {
    const db = await getIndexedDB();
    await idbRequest(db.transaction('agents', 'readwrite').objectStore('agents').delete(id));
    return true;
  }
}

// ============ Team Operations ============
export async function createTeam(input: CreateTeamInput): Promise<Team> {
  const now = new Date().toISOString();
  const team: Team = {
    id: input.id,
    name: input.name,
    description: input.description || '',
    avatar: input.avatar || null,
    created_at: now,
    updated_at: now,
  };

  const database = await getSQLiteDatabase();
  if (database) {
    await database.execute(
      'INSERT INTO teams (id, name, description, avatar) VALUES ($1, $2, $3, $4)',
      [input.id, input.name, team.description, team.avatar]
    );
    return team;
  } else {
    const db = await getIndexedDB();
    await idbRequest(db.transaction('teams', 'readwrite').objectStore('teams').put(team));
    return team;
  }
}

export async function getTeam(id: string): Promise<Team | null> {
  const database = await getSQLiteDatabase();
  if (database) {
    const result = await database.select<Team[]>('SELECT * FROM teams WHERE id = $1', [id]);
    return result[0] || null;
  } else {
    const db = await getIndexedDB();
    const result = await idbRequest(db.transaction('teams', 'readonly').objectStore('teams').get(id));
    return result || null;
  }
}

export async function getAllTeams(): Promise<Team[]> {
  const database = await getSQLiteDatabase();
  if (database) {
    return database.select<Team[]>('SELECT * FROM teams ORDER BY created_at DESC');
  } else {
    const db = await getIndexedDB();
    const teams = await idbRequest(db.transaction('teams', 'readonly').objectStore('teams').getAll());
    return teams.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
}

export async function updateTeam(id: string, input: UpdateTeamInput): Promise<Team | null> {
  const database = await getSQLiteDatabase();
  if (database) {
    const updates: string[] = [];
    const values: (string | null)[] = [];
    let idx = 1;
    if (input.name !== undefined) { updates.push(`name = $${idx++}`); values.push(input.name); }
    if (input.description !== undefined) { updates.push(`description = $${idx++}`); values.push(input.description); }
    if (input.avatar !== undefined) { updates.push(`avatar = $${idx++}`); values.push(input.avatar); }
    if (updates.length > 0) {
      updates.push(`updated_at = datetime('now')`);
      values.push(id);
      await database.execute(`UPDATE teams SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    }
    return getTeam(id);
  } else {
    const db = await getIndexedDB();
    const team = await getTeam(id);
    if (!team) return null;
    const updated = { ...team, ...input, updated_at: new Date().toISOString() };
    await idbRequest(db.transaction('teams', 'readwrite').objectStore('teams').put(updated));
    return updated;
  }
}

export async function deleteTeam(id: string): Promise<boolean> {
  const database = await getSQLiteDatabase();
  if (database) {
    const result = await database.execute('DELETE FROM teams WHERE id = $1', [id]);
    return result.rowsAffected > 0;
  } else {
    const db = await getIndexedDB();
    await idbRequest(db.transaction('teams', 'readwrite').objectStore('teams').delete(id));
    return true;
  }
}

// ============ Team Member Operations ============
export async function addTeamMember(teamId: string, agentId: string, role: TeamMemberRole = 'member'): Promise<TeamMember> {
  const now = new Date().toISOString();
  const database = await getSQLiteDatabase();
  if (database) {
    const result = await database.execute(
      'INSERT INTO team_members (team_id, agent_id, role) VALUES ($1, $2, $3)',
      [teamId, agentId, role]
    );
    return { id: result.lastInsertId as number, team_id: teamId, agent_id: agentId, role, created_at: now };
  } else {
    const db = await getIndexedDB();
    const member: Omit<TeamMember, 'id'> & { id?: number } = { team_id: teamId, agent_id: agentId, role, created_at: now };
    const tx = db.transaction('team_members', 'readwrite');
    const id = await idbRequest(tx.objectStore('team_members').add(member));
    return { ...member, id: id as number } as TeamMember;
  }
}

export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  const database = await getSQLiteDatabase();
  if (database) {
    return database.select<TeamMember[]>('SELECT * FROM team_members WHERE team_id = $1', [teamId]);
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('team_members', 'readonly');
    const index = tx.objectStore('team_members').index('team_id');
    return idbRequest(index.getAll(teamId));
  }
}

export async function removeTeamMember(teamId: string, agentId: string): Promise<boolean> {
  const database = await getSQLiteDatabase();
  if (database) {
    const result = await database.execute('DELETE FROM team_members WHERE team_id = $1 AND agent_id = $2', [teamId, agentId]);
    return result.rowsAffected > 0;
  } else {
    const db = await getIndexedDB();
    const members = await getTeamMembers(teamId);
    const member = members.find((m) => m.agent_id === agentId);
    if (member) {
      await idbRequest(db.transaction('team_members', 'readwrite').objectStore('team_members').delete(member.id));
      return true;
    }
    return false;
  }
}

export async function updateTeamMemberRole(teamId: string, agentId: string, role: TeamMemberRole): Promise<boolean> {
  const database = await getSQLiteDatabase();
  if (database) {
    const result = await database.execute('UPDATE team_members SET role = $1 WHERE team_id = $2 AND agent_id = $3', [role, teamId, agentId]);
    return result.rowsAffected > 0;
  } else {
    const db = await getIndexedDB();
    const members = await getTeamMembers(teamId);
    const member = members.find((m) => m.agent_id === agentId);
    if (member) {
      member.role = role;
      await idbRequest(db.transaction('team_members', 'readwrite').objectStore('team_members').put(member));
      return true;
    }
    return false;
  }
}

// ============ Project Operations ============
export async function createProject(input: CreateProjectInput): Promise<Project> {
  const now = new Date().toISOString();
  const project: Project = {
    id: input.id,
    name: input.name,
    description: input.description || '',
    team_id: input.team_id || null,
    status: 'active',
    created_at: now,
    updated_at: now,
  };

  const database = await getSQLiteDatabase();
  if (database) {
    await database.execute(
      'INSERT INTO projects (id, name, description, team_id) VALUES ($1, $2, $3, $4)',
      [input.id, input.name, project.description, project.team_id]
    );
    return project;
  } else {
    const db = await getIndexedDB();
    await idbRequest(db.transaction('projects', 'readwrite').objectStore('projects').put(project));
    return project;
  }
}

export async function getProject(id: string): Promise<Project | null> {
  const database = await getSQLiteDatabase();
  if (database) {
    const result = await database.select<Project[]>('SELECT * FROM projects WHERE id = $1', [id]);
    return result[0] || null;
  } else {
    const db = await getIndexedDB();
    const result = await idbRequest(db.transaction('projects', 'readonly').objectStore('projects').get(id));
    return result || null;
  }
}

export async function getAllProjects(): Promise<Project[]> {
  const database = await getSQLiteDatabase();
  if (database) {
    return database.select<Project[]>('SELECT * FROM projects ORDER BY created_at DESC');
  } else {
    const db = await getIndexedDB();
    const projects = await idbRequest(db.transaction('projects', 'readonly').objectStore('projects').getAll());
    return projects.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project | null> {
  const database = await getSQLiteDatabase();
  if (database) {
    const updates: string[] = [];
    const values: (string | null)[] = [];
    let idx = 1;
    if (input.name !== undefined) { updates.push(`name = $${idx++}`); values.push(input.name); }
    if (input.description !== undefined) { updates.push(`description = $${idx++}`); values.push(input.description); }
    if (input.team_id !== undefined) { updates.push(`team_id = $${idx++}`); values.push(input.team_id); }
    if (input.status !== undefined) { updates.push(`status = $${idx++}`); values.push(input.status); }
    if (updates.length > 0) {
      updates.push(`updated_at = datetime('now')`);
      values.push(id);
      await database.execute(`UPDATE projects SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    }
    return getProject(id);
  } else {
    const db = await getIndexedDB();
    const project = await getProject(id);
    if (!project) return null;
    const updated = { ...project, ...input, updated_at: new Date().toISOString() };
    await idbRequest(db.transaction('projects', 'readwrite').objectStore('projects').put(updated));
    return updated;
  }
}

export async function deleteProject(id: string): Promise<boolean> {
  const database = await getSQLiteDatabase();
  if (database) {
    const result = await database.execute('DELETE FROM projects WHERE id = $1', [id]);
    return result.rowsAffected > 0;
  } else {
    const db = await getIndexedDB();
    await idbRequest(db.transaction('projects', 'readwrite').objectStore('projects').delete(id));
    return true;
  }
}

// ============ Issue Operations ============
export async function createIssue(input: CreateIssueInput): Promise<Issue> {
  const now = new Date().toISOString();
  const issue: Issue = {
    id: input.id,
    project_id: input.project_id,
    title: input.title,
    description: input.description || '',
    status: 'open',
    priority: input.priority || 'medium',
    assigned_agent_id: input.assigned_agent_id || null,
    task_id: null,
    created_at: now,
    updated_at: now,
  };

  const database = await getSQLiteDatabase();
  if (database) {
    await database.execute(
      'INSERT INTO issues (id, project_id, title, description, priority, assigned_agent_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [input.id, input.project_id, input.title, issue.description, issue.priority, issue.assigned_agent_id]
    );
    return issue;
  } else {
    const db = await getIndexedDB();
    await idbRequest(db.transaction('issues', 'readwrite').objectStore('issues').put(issue));
    return issue;
  }
}

export async function getIssue(id: string): Promise<Issue | null> {
  const database = await getSQLiteDatabase();
  if (database) {
    const result = await database.select<Issue[]>('SELECT * FROM issues WHERE id = $1', [id]);
    return result[0] || null;
  } else {
    const db = await getIndexedDB();
    const result = await idbRequest(db.transaction('issues', 'readonly').objectStore('issues').get(id));
    return result || null;
  }
}

export async function getIssuesByProjectId(projectId: string): Promise<Issue[]> {
  const database = await getSQLiteDatabase();
  if (database) {
    return database.select<Issue[]>('SELECT * FROM issues WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
  } else {
    const db = await getIndexedDB();
    const tx = db.transaction('issues', 'readonly');
    const index = tx.objectStore('issues').index('project_id');
    const issues = await idbRequest(index.getAll(projectId));
    return issues.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
}

export async function updateIssue(id: string, input: UpdateIssueInput): Promise<Issue | null> {
  const database = await getSQLiteDatabase();
  if (database) {
    const updates: string[] = [];
    const values: (string | null)[] = [];
    let idx = 1;
    if (input.title !== undefined) { updates.push(`title = $${idx++}`); values.push(input.title); }
    if (input.description !== undefined) { updates.push(`description = $${idx++}`); values.push(input.description); }
    if (input.status !== undefined) { updates.push(`status = $${idx++}`); values.push(input.status); }
    if (input.priority !== undefined) { updates.push(`priority = $${idx++}`); values.push(input.priority); }
    if (input.assigned_agent_id !== undefined) { updates.push(`assigned_agent_id = $${idx++}`); values.push(input.assigned_agent_id); }
    if (input.task_id !== undefined) { updates.push(`task_id = $${idx++}`); values.push(input.task_id); }
    if (updates.length > 0) {
      updates.push(`updated_at = datetime('now')`);
      values.push(id);
      await database.execute(`UPDATE issues SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    }
    return getIssue(id);
  } else {
    const db = await getIndexedDB();
    const issue = await getIssue(id);
    if (!issue) return null;
    const updated = { ...issue, ...input, updated_at: new Date().toISOString() };
    await idbRequest(db.transaction('issues', 'readwrite').objectStore('issues').put(updated));
    return updated;
  }
}

export async function deleteIssue(id: string): Promise<boolean> {
  const database = await getSQLiteDatabase();
  if (database) {
    const result = await database.execute('DELETE FROM issues WHERE id = $1', [id]);
    return result.rowsAffected > 0;
  } else {
    const db = await getIndexedDB();
    await idbRequest(db.transaction('issues', 'readwrite').objectStore('issues').delete(id));
    return true;
  }
}

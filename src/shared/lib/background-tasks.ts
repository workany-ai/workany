/**
 * Background Task Manager
 *
 * Manages tasks running in the background when user switches to another task.
 * Allows multiple tasks to run in parallel and tracks their status.
 */

export interface BackgroundTask {
  taskId: string;
  sessionId: string; // Backend session ID
  abortController: AbortController;
  isRunning: boolean;
  startedAt: Date;
  prompt: string;
}

// Global map of background tasks
const backgroundTasks = new Map<string, BackgroundTask>();

// Listeners for background task status changes
type BackgroundTaskListener = (tasks: BackgroundTask[]) => void;
const listeners = new Set<BackgroundTaskListener>();

/**
 * Notify all listeners of task changes
 */
function notifyListeners() {
  const tasks = Array.from(backgroundTasks.values());
  listeners.forEach((listener) => listener(tasks));
}

/**
 * Add a task to background
 */
export function addBackgroundTask(
  task: Omit<BackgroundTask, 'startedAt'>
): void {
  backgroundTasks.set(task.taskId, {
    ...task,
    startedAt: new Date(),
  });
  console.log('[BackgroundTasks] Added task:', task.taskId);
  notifyListeners();
}

/**
 * Remove a task from background
 */
export function removeBackgroundTask(taskId: string): void {
  backgroundTasks.delete(taskId);
  console.log('[BackgroundTasks] Removed task:', taskId);
  notifyListeners();
}

/**
 * Get a background task by ID
 */
export function getBackgroundTask(taskId: string): BackgroundTask | undefined {
  return backgroundTasks.get(taskId);
}

/**
 * Get all background tasks
 */
export function getAllBackgroundTasks(): BackgroundTask[] {
  return Array.from(backgroundTasks.values());
}

/**
 * Get count of running background tasks
 */
export function getRunningTaskCount(): number {
  return Array.from(backgroundTasks.values()).filter((t) => t.isRunning).length;
}

/**
 * Update task status
 */
export function updateBackgroundTaskStatus(
  taskId: string,
  isRunning: boolean
): void {
  const task = backgroundTasks.get(taskId);
  if (task) {
    task.isRunning = isRunning;
    if (!isRunning) {
      // Task completed, remove from background after a short delay
      setTimeout(() => {
        removeBackgroundTask(taskId);
      }, 1000);
    }
    notifyListeners();
  }
}

/**
 * Check if a task is running in background
 */
export function isTaskRunningInBackground(taskId: string): boolean {
  const task = backgroundTasks.get(taskId);
  return task?.isRunning ?? false;
}

/**
 * Stop a background task
 */
export function stopBackgroundTask(taskId: string): void {
  const task = backgroundTasks.get(taskId);
  if (task) {
    task.abortController.abort();
    task.isRunning = false;
    removeBackgroundTask(taskId);
  }
}

/**
 * Subscribe to background task changes
 */
export function subscribeToBackgroundTasks(
  listener: BackgroundTaskListener
): () => void {
  listeners.add(listener);
  // Immediately call with current state
  listener(getAllBackgroundTasks());
  // Return unsubscribe function
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Clear all background tasks
 */
export function clearAllBackgroundTasks(): void {
  backgroundTasks.forEach((task) => {
    task.abortController.abort();
  });
  backgroundTasks.clear();
  notifyListeners();
}

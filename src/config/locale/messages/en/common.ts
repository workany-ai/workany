export default {
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  edit: 'Edit',
  confirm: 'Confirm',
  reset: 'Reset',
  close: 'Close',
  more: 'more...',
  loading: 'Loading...',
  noData: 'No data',
  search: 'Search',
  add: 'Add',
  remove: 'Remove',
  yes: 'Yes',
  no: 'No',
  ok: 'OK',
  back: 'Back',
  next: 'Next',
  done: 'Done',
  error: 'Error',
  success: 'Success',
  warning: 'Warning',
  info: 'Info',

  // Scroll
  scrollToBottom: 'Scroll to bottom',

  // Task actions
  favorite: 'Add to favorites',
  unfavorite: 'Remove from favorites',
  deleteTask: 'Delete task',
  deleteTaskConfirm: 'Are you sure you want to delete this task?',
  deleteTaskDescription:
    'This action cannot be undone. All messages in this task will be permanently deleted.',
  noChatsYet: 'No chats yet',

  // Bot Chat
  botChatTitle: 'Bot Chat',
  botChatDescription: 'Chat with OpenClaw Bot',
  botChatWelcome: 'Start chatting with Bot',
  botChatWelcomeHint: 'Enter a message to start chatting with OpenClaw Bot',
  botChatInputPlaceholder: 'Enter a message...',
  botChatError:
    'Sorry, an error occurred. Please make sure OpenClaw Gateway is running.',

  // API error messages
  errors: {
    connectionFailed: 'Connection failed, retrying...',
    connectionFailedFinal:
      'Unable to connect. Please check your network or try again later',
    corsError: 'Request blocked. Please check service configuration',
    timeout: 'Request timed out. Please try again',
    serverNotRunning: 'Service not running. Please start the app first',
    requestFailed: 'Request failed: {message}',
    retrying: 'Retrying ({attempt}/{max})...',
    internalError: 'Internal server error. Please check log file: {logPath}',
    customApiError:
      'Custom API ({baseUrl}) may not be compatible with Claude Code SDK. Please check the API configuration or try a different provider. Log file: {logPath}',
    openLogFile: 'Open Log File',
    modelNotConfigured:
      'AI model not configured. Please configure a custom model (API URL, API key, model name) before starting a conversation.',
    claudeCodeNotFound:
      'Claude Code is not installed or unavailable. Please configure a custom AI model in Settings, or install Claude Code (npm install -g @anthropic-ai/claude-code)',
    configureModel: 'Configure Model',
    apiKeyError:
      'AI model request failed. Please check your model configuration (API URL, API key, model name, etc.)',
    configureApiKey: 'Go to Settings',
    agentProcessError:
      'Agent encountered an error. Please check your model configuration and try again.',
  },

  // Question input
  questionInput: {
    needsInput: 'Your input is needed',
    submit: 'Submit',
    other: 'Other',
    customInput: 'Custom input',
    placeholder: 'Enter your answer...',
  },
};

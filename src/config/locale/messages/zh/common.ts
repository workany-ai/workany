export default {
  save: '保存',
  cancel: '取消',
  delete: '删除',
  edit: '编辑',
  confirm: '确认',
  reset: '重置',
  close: '关闭',
  more: '更多...',
  loading: '加载中...',
  noData: '暂无数据',
  search: '搜索',
  add: '添加',
  remove: '移除',
  yes: '是',
  no: '否',
  ok: '确定',
  back: '返回',
  next: '下一步',
  done: '完成',
  error: '错误',
  success: '成功',
  warning: '警告',
  info: '提示',

  // 滚动
  scrollToBottom: '滚动到底部',

  // 任务操作
  favorite: '收藏',
  unfavorite: '取消收藏',
  deleteTask: '删除任务',
  deleteTaskConfirm: '确定要删除这个任务吗？',
  deleteTaskDescription: '此操作无法撤销，任务中的所有消息将被永久删除。',

  // API 错误提示
  errors: {
    connectionFailed: '连接服务失败，正在重试...',
    connectionFailedFinal: '无法连接到服务，请检查网络或稍后再试',
    corsError: '请求被阻止，请检查服务配置',
    timeout: '请求超时，请稍后再试',
    serverNotRunning: '服务未启动，请先启动应用',
    requestFailed: '请求失败：{message}',
    retrying: '正在重试 ({attempt}/{max})...',
    internalError: '服务内部错误，详情请查看日志文件：{logPath}',
    openLogFile: '打开日志文件',
    claudeCodeNotFound:
      'Claude Code 未安装或不可用。请在设置中配置自定义 AI 模型，或安装 Claude Code（npm install -g @anthropic-ai/claude-code）',
    configureModel: '配置模型',
    apiKeyError: 'AI 模型接口请求失败，请检查模型配置是否正确（API 地址、密钥、模型名称等）',
    configureApiKey: '前往配置',
    agentProcessError: 'Agent 运行遇到错误，请检查模型配置后重试',
  },
};

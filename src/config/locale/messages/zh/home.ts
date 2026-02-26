export default {
  inputPlaceholder: '描述一个任务...',
  reply: '回复...',
  welcomeTitle: '有什么可以帮到你？',
  welcomeSubtitle: '我可以帮你完成编程、写作、分析等各种任务。',
  addFilesOrPhotos: '添加文件或图片',
  samplePrompts: '示例任务',
  refreshPrompts: '换一批',

  // Mode switcher
  modeTask: '本地任务',
  modeBot: 'Bot 聊天',

  // Bot mode
  botWelcomeTitle: '与 Bot 对话',
  botWelcomeDescription: '与 OpenClaw Bot 对话，享受智能助手服务',
  botInputPlaceholder: '输入消息开始与 Bot 对话...',

  allPrompts: [
    {
      title: '智能整理下载内容',
      prompt:
        "严格限制在我的 'Downloads' 文件夹内，仅扫描最近 30 天添加的顶层文件（忽略子文件夹和 .app 包）。删除重复文件，并按类型将剩余文件分类到新的子文件夹中。",
    },
    {
      title: '清理大型视频文件',
      prompt:
        '找出我电脑上所有超过 500MB 且最近 6 个月未曾打开的视频文件，并生成一份清单表格供我审核。',
    },
    {
      title: '批量重命名资产',
      prompt:
        "读取 '~/Desktop/Project_Assets' 文件夹，并根据创建日期批量重命名所有图像，使用格式 YYYY-MM-DD ProjectName_###。",
    },
    {
      title: '生成咨询演示文稿',
      prompt:
        "分析 'Project_Proposal' 文件夹，生成一份 3 页的幻灯片 (.pptx)，采用高端咨询风格设计。专注于视觉叙事、整洁的排版以及连贯的逻辑流程。将演示文稿保存到我的桌面。",
    },
    {
      title: '提取发票到 Excel',
      prompt:
        "查找 'May_Tax_Returns' 文件夹中的所有 PDF 发票，提取账单日期、公司名称和总金额，并将它们整理成一份格式化的 .xlsx 总结报告。",
    },
    {
      title: '会议笔记转 Word',
      prompt:
        '总结本周 Syncs 文件夹中的会议笔记，按负责人生成行动项，并输出成格式整洁的执行摘要 Word 文档。',
    },
    {
      title: '运行本地网页爬虫',
      prompt:
        '写一个 Python 网页爬虫从 HackerNews 抓取前 30 条新闻标题，将结果保存至 CSV 文件，并立即在本地运行该脚本。',
    },
    {
      title: '自动设计产品海报',
      prompt:
        '查看 producthunt.com 本周排名前 3 的产品，提取它们的名称和宣传标语（tagline），生成时尚的 3:4 比例介绍海报，并保存到我的桌面。',
    },
    {
      title: '自动扩充客户 CSV',
      prompt:
        "读取桌面上包含公司名称的 'clients.csv'。编写并运行一个脚本，自动在网络上搜索每家公司的官方网站和联系邮箱，并用这些新数据更新本地 CSV 文件。",
    },
  ],
};

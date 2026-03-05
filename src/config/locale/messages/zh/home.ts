export default {
  inputPlaceholder: '输入任何内容...',
  reply: '回复...',
  welcomeTitle: '有什么可以帮到你？',
  welcomeSubtitle: '我可以帮你完成编程、写作、分析等各种任务。',
  addFilesOrPhotos: '添加文件或图片',
  modeAuto: '自动',
  modeChat: '对话',
  modeTask: '任务',
  modeAutoDesc: '自动识别意图',
  modeChatDesc: '快速对话',
  modeTaskDesc: '完整 Agent 能力',
  modeLabel: '模式',
  examplePrompts: {
    categories: {
      organizeFiles: {
        label: '整理文件',
        placeholder: '描述你想要如何整理文件',
        prompts: [
          '仅扫描「下载」文件夹中最近 30 天新增的顶层文件（忽略子文件夹和 .app 包），删除重复项，并按文件类型自动分类到新建的子文件夹中。',
          '找出电脑中所有超过 500MB 且最近 6 个月未打开过的视频文件，生成一份清单表格供我审核。',
          '读取「~/Desktop/Project_Assets」文件夹，根据图片的创建日期批量重命名，格式为 YYYY-MM-DD 项目名_###。',
        ],
      },
      generateDocs: {
        label: '生成文档',
        placeholder: '描述你想要生成的文档',
        prompts: [
          '分析「Project_Proposal」文件夹，生成一份 3 页的演示文稿（.pptx），采用高端咨询风格设计，注重视觉叙事、简洁排版和连贯的逻辑结构，保存到桌面。',
          '找出「May_Tax_Returns」文件夹中的所有 PDF 发票，提取开票日期、公司名称和总金额，汇总为格式化的 .xlsx 表格。',
          '汇总本周 Syncs 文件夹中的会议记录，按负责人生成待办事项，输出一份排版整洁的 Word 执行摘要。',
        ],
      },
      automateTasks: {
        label: '自动化任务',
        placeholder: '描述你想要自动化的任务',
        prompts: [
          '编写一个 Python 爬虫，抓取 HackerNews 最新的 30 条新闻标题，保存为 CSV 文件，并立即在本地运行。',
          '查看 producthunt.com 本周 Top 3 产品，提取名称和标语，生成一张简洁的 3:4 比例介绍海报，保存到桌面。',
          '读取桌面上包含公司名称的「clients.csv」，编写并运行脚本，自动搜索每家公司的官网和联系邮箱，更新到 CSV 文件中。',
        ],
      },
    },
  },
};

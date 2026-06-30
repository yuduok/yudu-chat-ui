import type { TranslationKey } from "./en";

export const zh: Record<TranslationKey, string> = {
  // Sidebar
  "sidebar.newChat": "新建对话",
  "sidebar.history": "历史记录",
  "sidebar.emptyHistory": "暂无对话，点击上方新建。",
  "sidebar.rename": "重命名",
  "sidebar.delete": "删除",
  "sidebar.settings": "设置",
  "sidebar.collapse": "收起侧边栏",
  "sidebar.expand": "展开侧边栏",

  // Composer
  "composer.placeholder": "输入消息…（Enter 发送，Shift+Enter 换行）",
  "composer.send": "发送",
  "composer.stop": "停止",
  "composer.disclaimer": "AI 可能会出错，请核实重要信息。",
  "composer.runWithTools": "使用工具",

  // Message
  "message.copy": "复制",
  "message.cancel": "取消",
  "message.copied": "已复制",
  "message.edit": "编辑并重新提交",
  "message.regenerate": "重新生成",
  "message.delete": "删除",

  // Tools
  "tool.call": "工具调用",
  "tool.result": "工具结果",
  "tool.error": "工具错误",

  // Agents
  "agent.menu": "智能体",
  "agent.menu.none": "无智能体",
  "agent.menu.noneHint": "普通对话，不使用编排与工具白名单",
  "agent.activity": "活动面板",
  "agent.events": "智能体",
  "agent.tools": "工具调用",
  "agent.started": "开始",
  "agent.finished": "完成",
  "agent.empty": "运行时，工具调用与智能体事件会出现在这里。",
  "chat.agentAttribution": "由 {agent} 生成",

  // Models picker (fetch result)
  "settings.fetchedModels": "已获取的模型",
  "settings.fetchedModelsAdd": "添加（{count}）",
  "settings.fetchedModelsAlready": "已添加",
  "settings.fetchedModelsAdded": "已添加 {count} 个模型",
  "settings.fetchedCount": "已加载 {count} 个模型",

  // Settings dialog
  "settings.title": "设置",
  "settings.description": "配置模型供应商和界面偏好。密钥仅保存在本地。",
  "settings.tab.providers": "模型供应商",
  "settings.tab.appearance": "外观",
  "settings.provider": "供应商",
  "settings.apiKey": "API Key",
  "settings.apiKey.placeholder": "sk-...",
  "settings.apiKey.hint": "留空表示保留已有 Key。Mock 模式不需要 Key。",
  "settings.baseUrl": "Base URL",
  "settings.models": "模型",
  "settings.appearance.dark": "深色模式",
  "settings.appearance.darkHint": "当“主题”选择为“跟随系统”时生效。",
  "settings.appearance.theme": "主题",
  "settings.appearance.theme.system": "跟随系统",
  "settings.appearance.theme.light": "浅色",
  "settings.appearance.theme.dark": "深色",
  "settings.cancel": "取消",
  "settings.save": "保存",
  "settings.saved": "设置已保存",
  "settings.fetchModels": "拉取模型",
  "settings.fetching": "拉取中…",
  "settings.fetchFailed": "拉取模型失败",
  "settings.manualModel.placeholder": "添加模型 ID",
  "settings.manualModel.add": "添加",
  "settings.manualModel.remove": "移除",
  "settings.manualModels": "自定义模型",
  "settings.source.fallback": "默认模型",
  "settings.source.manual": "自定义",
  "settings.source.remote": "来自服务器",

  // Chat page
  "chat.noConversation": "未选择对话",
  "chat.startPrompt": "发送消息即可开始对话。",
  "chat.empty.heading": "你的 AI 工作区",
  "chat.empty.subtitle": "实时流式响应、随时切换模型、所有对话可检索。开始你的第一次对话吧。",
  "chat.empty.cta": "新建对话",
  "chat.theme.toggle": "主题",
  "chat.appName": "语渡 Chat",
};

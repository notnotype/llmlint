export type SupportedLocale = "zh-CN" | "en-US";

export const supportedLocales: SupportedLocale[] = ["zh-CN", "en-US"];

export const localeLabels: Record<SupportedLocale, string> = {
    "zh-CN": "简体中文",
    "en-US": "English",
};

export type MessageKey =
    | "about.actions"
    | "about.close"
    | "about.copy"
    | "about.description"
    | "about.dimensions"
    | "about.github"
    | "about.highlight"
    | "about.json"
    | "about.level"
    | "about.mask"
    | "about.mindset"
    | "about.review"
    | "about.title"
    | "about.usage"
    | "auth.identity"
    | "auth.identityEditor"
    | "auth.identityPro"
    | "auth.identityReader"
    | "auth.identityWriter"
    | "auth.loginDescription"
    | "auth.loginFailed"
    | "auth.loginLink"
    | "auth.loginLoading"
    | "auth.loginOk"
    | "auth.loginTitle"
    | "auth.password"
    | "auth.registerDescription"
    | "auth.registerFailed"
    | "auth.registerLink"
    | "auth.registerLoading"
    | "auth.registerOk"
    | "auth.registerTitle"
    | "auth.username"
    | "common.agent"
    | "common.all"
    | "common.auto"
    | "common.cancel"
    | "common.candidate"
    | "common.clear"
    | "common.close"
    | "common.confirm"
    | "common.default"
    | "common.disabled"
    | "common.enabled"
    | "common.high"
    | "common.human"
    | "common.low"
    | "common.manual"
    | "common.medium"
    | "common.none"
    | "common.reset"
    | "common.search"
    | "common.selectOption"
    | "common.system"
    | "common.themeDark"
    | "common.themeLight"
    | "common.themeSepia"
    | "common.undo"
    | "header.about"
    | "header.account"
    | "header.check"
    | "header.contribute"
    | "header.dataset"
    | "header.github"
    | "header.login"
    | "header.logout"
    | "header.report"
    | "header.register"
    | "header.rules"
    | "header.settings"
    | "header.subtitle"
    | "header.theme"
    | "home.description"
    | "home.fileReadFailed"
    | "home.local"
    | "home.markdown"
    | "home.pickFile"
    | "home.placeholder"
    | "home.start"
    | "home.title"
    | "home.recentScans"
    | "home.clearHistory"
    | "home.clearHistoryTitle"
    | "home.collapseHistoryTitle"
    | "home.deleteHistoryTitle"
    | "home.expandHistoryTitle"
    | "home.historyHoursAgo"
    | "home.historyIssueCount"
    | "home.historyJustNow"
    | "home.historyMinutesAgo"
    | "home.recentScansCollapsed"
    | "home.noHistory"
    | "home.aiFlavor"
    | "home.readability"
    | "llm.replaceFullBody"
    | "llm.replaceFullConfirm"
    | "llm.replaceFullFromClipboard"
    | "llm.replaceFullTitle"
    | "layout.resizeReportPanelTitle"
    | "llmRules.description"
    | "llmRules.title"
    | "dimension.fixability"
    | "dimension.level"
    | "dimension.review"
    | "issue.applyTitle"
    | "issue.candidateApplyAction"
    | "issue.candidateFixable"
    | "issue.clean"
    | "issue.collapse"
    | "issue.count"
    | "issue.emptyNoText"
    | "issue.expandAll"
    | "issue.filteredHiddenDescription"
    | "issue.filteredHiddenTitle"
    | "issue.fixable"
    | "issue.locateTitle"
    | "issue.locateIssueTitle"
    | "issue.openRule"
    | "issue.openRuleTitle"
    | "issue.applyIssueTitle"
    | "issue.resetRules"
    | "issue.ruleSettingsHiddenDescription"
    | "issue.ruleSettingsHiddenTitle"
    | "issue.showAll"
    | "llm.copyPromptOnly"
    | "llm.copyPromptWithText"
    | "llm.menuLabel"
    | "llm.menuTitle"
    | "dataset.replace"
    | "dataset.chapterLabel"
    | "dataset.compareMode"
    | "dataset.browseMode"
    | "dataset.selectChapterPrompt"
    | "dataset.refHumanCharCount"
    | "dataset.issuesHit"
    | "dataset.renderStats"
    | "dataset.noRender"
    | "dataset.referenceHuman"
    | "contribute.unknown"
    | "contribute.humanWriting"
    | "contribute.aiGenerated"
    | "contribute.mixedWriting"
    | "contribute.privateExport"
    | "contribute.publicReview"
    | "contribute.blindReviewSaved"
    | "contribute.annotationSaved"
    | "contribute.title"
    | "contribute.charCount"
    | "contribute.textPlaceholder"
    | "contribute.sourceLabel"
    | "contribute.visibilityLabel"
    | "contribute.aiFlavorLabel"
    | "contribute.aiFlavorLow"
    | "contribute.aiFlavorHigh"
    | "contribute.wantReadOnLabel"
    | "contribute.wantReadOnLow"
    | "contribute.wantReadOnHigh"
    | "contribute.consentText"
    | "contribute.submitting"
    | "contribute.submitBlindReview"
    | "contribute.textHighlight"
    | "contribute.visibleCharCount"
    | "contribute.selectedSpan"
    | "contribute.annotationPlaceholder"
    | "contribute.cancel"
    | "contribute.saveAnnotation"
    | "contribute.blindReviewSavedTitle"
    | "contribute.aiFlavorScore"
    | "contribute.wantReadOnScore"
    | "contribute.hitSummary"
    | "notify.cleanDone"
    | "notify.commentDeleted"
    | "notify.commentContextCopied"
    | "notify.commentRestoreSkipped"
    | "notify.commentUpdated"
    | "notify.commentsCleared"
    | "notify.diffCleared"
    | "notify.diffContextCopied"
    | "notify.diffRestoreSkipped"
    | "notify.diffsCleared"
    | "notify.copyFailed"
    | "notify.copyOk"
    | "notify.documentChangeAutoReveal"
    | "notify.filtersAutoReveal"
    | "notify.issueNotAutoReplaceable"
    | "notify.optimizationPromptCopied"
    | "notify.optimizationPromptWithTextCopied"
    | "notify.repairDraftReset"
    | "notify.ruleSettingsRestored"
    | "notify.selectionCopied"
    | "notify.selectionFormatted"
    | "notify.clipboardEmpty"
    | "notify.clipboardReadFailed"
    | "notify.selectionReplaced"
    | "notify.fullTextReplaced"
    | "notify.fullTextReplacedWithComments"
    | "notify.logoutFailed"
    | "notify.logoutOk"
    | "notify.replacementDone"
    | "report.loadSample"
    | "report.loading"
    | "report.replace"
    | "ruleDetail.action"
    | "ruleDetail.deleteReplacement"
    | "ruleDetail.examples"
    | "ruleDetail.pattern"
    | "settings.detection"
    | "settings.detectionDescription"
    | "settings.display"
    | "settings.displayDescription"
    | "settings.activeRules"
    | "settings.fixabilityOverride"
    | "settings.highlight"
    | "settings.language"
    | "settings.levelOverride"
    | "settings.mask"
    | "settings.minLevel"
    | "settings.namespaces"
    | "settings.namespaceCount"
    | "settings.noRuleResult"
    | "settings.resetAllRules"
    | "settings.review"
    | "settings.reviewOverride"
    | "settings.ruleConfig"
    | "settings.ruleDescription"
    | "settings.ruleSearch"
    | "settings.rules"
    | "settings.theme"
    | "settings.title"
    | "summary.clean"
    | "summary.copyJson"
    | "summary.copyJsonTitle"
    | "summary.filteredHidden"
    | "summary.hidden"
    | "summary.noIssues"
    | "summary.resetRuleSettings"
    | "summary.resetRuleSettingsTitle"
    | "summary.ruleSettingsHidden"
    | "summary.ruleSettingsHiddenInline"
    | "summary.ruleSettingsWarning"
    | "summary.scanRules"
    | "summary.showHidden"
    | "summary.showHiddenTitle"
    | "summary.total"
    | "review.addComment"
    | "review.addCommentTitle"
    | "review.addIssueComment"
    | "review.addIssueCommentTitle"
    | "review.applyLink"
    | "review.applyCandidateDelete"
    | "review.applyCandidateReplace"
    | "review.applyDelete"
    | "review.applyReplace"
    | "review.activeReplacementTitle"
    | "review.activeIssueCommentPlaceholder"
    | "review.boldSelectionTitle"
    | "review.blockquoteSelection"
    | "review.blockquoteSelectionTitle"
    | "review.blockStyleTitle"
    | "review.bulletListSelection"
    | "review.bulletListSelectionTitle"
    | "review.candidate"
    | "review.clipboardDiffTitle"
    | "review.codeSelectionTitle"
    | "review.codeBlockSelection"
    | "review.codeBlockSelectionTitle"
    | "review.commentResolved"
    | "review.commentBodyLabel"
    | "review.commentQuoteLabel"
    | "review.commentStatusLabel"
    | "review.commentUnresolved"
    | "review.clearComments"
    | "review.clearCommentsTitle"
    | "review.clearCurrentDiffTitle"
    | "review.clearDiffsTitle"
    | "review.clearFormattingTitle"
    | "review.commentsCount"
    | "review.commentsPanelTitle"
    | "review.complete"
    | "review.completeCommentTitle"
    | "review.copySelectionPrompt"
    | "review.copySelectionPromptTitle"
    | "review.copyIssuePrompt"
    | "review.copyIssuePromptTitle"
    | "review.copyCommentContextTitle"
    | "review.copyDiffContextTitle"
    | "review.copySelectionTitle"
    | "review.delete"
    | "review.deleteCommentTitle"
    | "review.deletable"
    | "review.diffCount"
    | "review.diffDeletedLabel"
    | "review.diffInsertedLabel"
    | "review.diffSourceLabel"
    | "review.diffSourceLlm"
    | "review.diffSourceStatic"
    | "review.diffTitleLabel"
    | "review.edit"
    | "review.editCommentTitle"
    | "review.emptyText"
    | "review.expandCommentsTitle"
    | "review.fullTextClipboardDiffTitle"
    | "review.formatDiffTitle"
    | "review.fixActionCount"
    | "review.collapseCommentsTitle"
    | "review.heading1Selection"
    | "review.heading2Selection"
    | "review.heading3Selection"
    | "review.hitCount"
    | "review.locateSourceTitle"
    | "review.italicSelectionTitle"
    | "review.linkDiffTitle"
    | "review.linkSelectionTitle"
    | "review.linkUrlPlaceholder"
    | "review.listIndentTitle"
    | "review.listOutdentTitle"
    | "review.locateCommentTitle"
    | "review.manualDecision"
    | "review.modePreview"
    | "review.modePreviewTitle"
    | "review.modeSource"
    | "review.modeSourceTitle"
    | "review.nextCommentTitle"
    | "review.nextDiffTitle"
    | "review.nextUnresolvedCommentTitle"
    | "review.orderedListSelection"
    | "review.orderedListSelectionTitle"
    | "review.paragraphSelection"
    | "review.previousCommentTitle"
    | "review.previousDiffTitle"
    | "review.previousUnresolvedCommentTitle"
    | "review.previewMappingFailed"
    | "review.previewOccurrenceMismatch"
    | "review.repairBaselineDiffTitle"
    | "review.replace"
    | "review.replaceSelectionFromClipboardTitle"
    | "review.replaceable"
    | "review.replaceableCount"
    | "review.resizeCommentsTitle"
    | "review.removeLink"
    | "review.reopen"
    | "review.reopenCommentTitle"
    | "review.saveComment"
    | "review.selectDiffTitle"
    | "review.selectDiffFirstTitle"
    | "review.selectListFirstTitle"
    | "review.selectTextFirst"
    | "review.selectionReadyTitle"
    | "review.selectionHint"
    | "review.selectedChars"
    | "review.strikeSelectionTitle"
    | "review.unresolvedCount"
    | "review.writeCommentPlaceholder"
    | "review.zeroWidthSpace"
    | "review.zeroWidthNonJoiner"
    | "review.zeroWidthJoiner"
    | "review.byteOrderMark"
    | "repair.changed"
    | "repair.draft"
    | "repair.originalBaseline"
    | "repair.resetToOriginal"
    | "repair.resetToOriginalTitle"
    | "repair.unchanged"
    | "text.clear"
    | "text.cleanMechanical"
    | "text.cleanMechanicalTitle"
    | "text.highlight"
    | "text.highlightTitle"
    | "text.mask"
    | "text.maskTitle"
    | "text.placeholder"
    | "text.nextIssueTitle"
    | "text.previousIssueTitle"
    | "text.sample"
    | "text.wordCount";

const zhCN: Record<MessageKey, string> = {
    "about.actions": "左侧贴文本，右侧实时看命中；点命中/正文可双向定位。",
    "about.close": "关闭",
    "about.copy": "复制 JSON 导出结果。",
    "about.description": "用正则确定性地定位中文文本里的「AI 味」候选。全程在浏览器本地运行，文本不上传。",
    "about.dimensions": "三个维度",
    "about.github": "开源于 github.com/notnotype/llmlint，规则集 builtin/default。",
    "about.highlight": "行内高亮在正文里直接标出命中。",
    "about.json": "JSON",
    "about.level": "级别：严重度 高 / 中 / 低。",
    "about.mask": "Markdown 遮罩会跳过代码块、frontmatter 和链接。",
    "about.mindset": "命中是候选，不是定论。是否要改仍需结合上下文。",
    "about.review": "受众：给谁看，Agent / 人工 / 机械。",
    "about.title": "关于 llmlint 检测",
    "about.usage": "怎么用",
    "auth.identity": "身份",
    "auth.identityEditor": "编辑",
    "auth.identityPro": "行业从业者",
    "auth.identityReader": "读者",
    "auth.identityWriter": "作者",
    "auth.loginDescription": "进入贡献流程需要账号。",
    "auth.loginFailed": "登录失败",
    "auth.loginLink": "已有账号，去登录",
    "auth.loginLoading": "登录中",
    "auth.loginOk": "登录成功",
    "auth.loginTitle": "登录",
    "auth.password": "密码",
    "auth.registerDescription": "自述身份只用于后续校准，不影响权限。",
    "auth.registerFailed": "注册失败",
    "auth.registerLink": "还没有账号，去注册",
    "auth.registerLoading": "注册中",
    "auth.registerOk": "注册成功",
    "auth.registerTitle": "注册",
    "auth.username": "用户名",
    "common.agent": "Agent",
    "common.all": "全部",
    "common.auto": "自动",
    "common.cancel": "取消",
    "common.candidate": "候选",
    "common.clear": "清除",
    "common.close": "关闭",
    "common.confirm": "确定",
    "common.default": "默认",
    "common.disabled": "关闭",
    "common.enabled": "开启",
    "common.high": "高",
    "common.human": "人工",
    "common.low": "低",
    "common.manual": "手动",
    "common.medium": "中",
    "common.none": "机械",
    "common.reset": "重置",
    "common.search": "搜索",
    "common.selectOption": "选择选项",
    "common.system": "跟随系统",
    "common.themeDark": "深色",
    "common.themeLight": "浅色",
    "common.themeSepia": "纸张",
    "common.undo": "撤销",
    "header.about": "关于 / 使用说明",
    "header.account": "账号",
    "header.check": "检测",
    "header.contribute": "贡献数据",
    "header.dataset": "数据集",
    "header.github": "GitHub",
    "header.login": "登录",
    "header.logout": "退出登录",
    "header.report": "评测报告",
    "header.register": "注册账号",
    "header.rules": "规则",
    "header.settings": "设置",
    "header.subtitle": "中文 AI 味检测",
    "header.theme": "切换明暗",
    "home.description": "本地扫描中文正文里的模板化表达、机械修辞和可疑规则命中；命中是候选，最终判断仍回到上下文。",
    "home.fileReadFailed": "文件读取失败，请换一个文本文件。",
    "home.local": "浏览器本地运行",
    "home.markdown": "支持 Markdown 遮罩",
    "home.pickFile": "选择文件",
    "home.placeholder": "粘贴正文，或拖入 .txt / .md 文件",
    "home.start": "开始检测",
    "home.title": "中文稿件 AI 味检测",
    "llm.copyPromptOnly": "复制指令（不带正文）",
    "llm.copyPromptWithText": "复制指令 + 当前正文",
    "llm.menuLabel": "外部 LLM",
    "llm.menuTitle": "复制当前报告和优化建议，粘贴给外部 LLM 使用",
    "llm.replaceFullBody": "将用剪贴板里的 Markdown 替换当前全文。这个操作会重新计算命中和批注位置，可通过通知里的撤销恢复。",
    "llm.replaceFullConfirm": "替换全文",
    "llm.replaceFullFromClipboard": "用剪贴板替换全文",
    "llm.replaceFullTitle": "用剪贴板替换全文？",
    "layout.resizeReportPanelTitle": "拖拽调整报告面板宽度",
    "llmRules.description": "这些规则需要读全文语境判断，属 llmlint 的 Agent Skill 流程；本检测页只跑确定性 regex 规则。",
    "llmRules.title": "需 Agent 语义判断的规则（{count} 条，本页纯 regex 不检测）",
    "dimension.fixability": "修复",
    "dimension.level": "级别",
    "dimension.review": "受众",
    "issue.applyTitle": "{action}此处命中",
    "issue.candidateApplyAction": "候选{action}",
    "issue.candidateFixable": "候选修复",
    "issue.clean": "未发现命中（当前过滤下）",
    "issue.collapse": "收起",
    "issue.count": "{count} 处",
    "issue.emptyNoText": "在左侧粘贴文本，实时查看命中",
    "issue.expandAll": "展开全部（共 {count} 处）",
    "issue.filteredHiddenDescription": "放宽受众、级别或命名空间后可查看。",
    "issue.filteredHiddenTitle": "当前过滤隐藏了 {count} 条命中",
    "issue.fixable": "能修复",
    "issue.locateTitle": "点击定位到正文",
    "issue.locateIssueTitle": "定位到正文：{match}",
    "issue.openRule": "详情",
    "issue.openRuleTitle": "查看规则详情：{title}",
    "issue.applyIssueTitle": "{action}此处命中：{match}",
    "issue.resetRules": "恢复默认规则",
    "issue.ruleSettingsHiddenDescription": "恢复默认规则后可重新检查这段文本。",
    "issue.ruleSettingsHiddenTitle": "当前规则设置关闭了 {count} 条默认命中",
    "issue.showAll": "查看全部命中",
    "notify.cleanDone": "已清理 {count} 处机械问题",
    "notify.commentDeleted": "已删除 1 条批注",
    "notify.commentContextCopied": "已复制批注上下文",
    "notify.commentRestoreSkipped": "正文已改动，无法安全恢复这条批注",
    "notify.commentUpdated": "已更新批注",
    "notify.commentsCleared": "已清空 {count} 条批注",
    "notify.diffCleared": "已清除当前修改标注",
    "notify.diffContextCopied": "已复制修改上下文",
    "notify.diffRestoreSkipped": "正文已改动，无法安全恢复这处修改标注",
    "notify.diffsCleared": "已清除 {count} 处修改标注",
    "notify.copyFailed": "复制失败，请检查剪贴板权限",
    "notify.copyOk": "已复制 JSON 报告",
    "notify.documentChangeAutoReveal": "新文本被当前过滤器隐藏了命中，已自动切到全部命中",
    "notify.filtersAutoReveal": "当前过滤器隐藏了命中，已自动切到全部命中",
    "notify.issueNotAutoReplaceable": "这条命中当前不可自动替换",
    "notify.optimizationPromptCopied": "已复制优化指令",
    "notify.optimizationPromptWithTextCopied": "已复制优化指令和正文",
    "notify.repairDraftReset": "修复稿已重置为原文",
    "notify.ruleSettingsRestored": "已恢复默认规则并放宽当前过滤器",
    "notify.selectionCopied": "已复制选中文本",
    "notify.selectionFormatted": "已格式化选区",
    "notify.clipboardEmpty": "剪贴板为空，未替换文本",
    "notify.clipboardReadFailed": "读取剪贴板失败，请检查剪贴板权限",
    "notify.selectionReplaced": "已用剪贴板替换选区",
    "notify.fullTextReplaced": "已用剪贴板替换全文",
    "notify.fullTextReplacedWithComments": "已用剪贴板替换全文，批注会随正文变化更新",
    "notify.logoutFailed": "登出失败",
    "notify.logoutOk": "已登出",
    "notify.replacementDone": "已应用 1 处替换",
    "report.loadSample": "或 加载内置示例报告",
    "report.loading": "加载中...",
    "report.replace": "换报告",
    "ruleDetail.action": "修复动作",
    "ruleDetail.deleteReplacement": "（删除）",
    "ruleDetail.examples": "示例",
    "ruleDetail.pattern": "匹配模式",
    "settings.detection": "检测",
    "settings.detectionDescription": "调整默认筛选与正文显示偏好。",
    "settings.display": "界面",
    "settings.displayDescription": "语言和主题只保存在当前浏览器。",
    "settings.activeRules": "{active}/{total} 启用",
    "settings.fixabilityOverride": "修复能力",
    "settings.highlight": "行内高亮",
    "settings.language": "界面语言",
    "settings.levelOverride": "级别",
    "settings.mask": "Markdown 遮罩",
    "settings.minLevel": "最低级别",
    "settings.namespaces": "命名空间",
    "settings.namespaceCount": "{count} 个命名空间",
    "settings.noRuleResult": "没有匹配的规则。",
    "settings.resetAllRules": "重置全部规则配置",
    "settings.review": "受众",
    "settings.reviewOverride": "受众",
    "settings.ruleConfig": "规则配置",
    "settings.ruleDescription": "按 namespace 或 rule 覆盖启停、级别、受众和修复能力。",
    "settings.ruleSearch": "搜索规则 / namespace",
    "settings.rules": "规则",
    "settings.theme": "主题",
    "settings.title": "设置",
    "summary.clean": "当前过滤下无命中",
    "summary.copyJson": "复制 JSON",
    "summary.copyJsonTitle": "复制当前结果为 JSON（CheckJsonReport 形态）",
    "summary.filteredHidden": "当前过滤隐藏了 {count} 条命中",
    "summary.hidden": "已隐藏 {count} 条",
    "summary.noIssues": "当前过滤下无命中",
    "summary.resetRuleSettings": "恢复默认规则",
    "summary.resetRuleSettingsTitle": "恢复默认规则覆盖，并放宽当前过滤器",
    "summary.ruleSettingsHidden": "当前规则设置关闭了 {count} 条默认命中",
    "summary.ruleSettingsHiddenInline": "规则设置另隐藏 {count} 条",
    "summary.ruleSettingsWarning": "当前规则设置关闭了默认命中，可在右侧恢复默认规则",
    "summary.scanRules": "扫描 {count} 条规则",
    "summary.showHidden": "查看全部命中",
    "summary.showHiddenTitle": "放宽当前过滤器，查看被隐藏的命中",
    "summary.total": "共 {total} 处",
    "review.addComment": "批注",
    "review.addCommentTitle": "批注选中文本（Ctrl/Cmd+Alt+M）",
    "review.addIssueComment": "批注命中",
    "review.addIssueCommentTitle": "给当前命中「{text}」添加批注（Ctrl/Cmd+Alt+M）",
    "review.applyLink": "添加链接",
    "review.applyCandidateDelete": "应用候选删除",
    "review.applyCandidateReplace": "应用候选替换",
    "review.applyDelete": "应用删除",
    "review.applyReplace": "应用替换",
    "review.activeReplacementTitle": "应用当前替换（Ctrl/Cmd+Alt+R）",
    "review.activeIssueCommentPlaceholder": "写一条针对这处命中的批注",
    "review.boldSelectionTitle": "加粗选区（Ctrl/Cmd+B）",
    "review.blockquoteSelection": "引用",
    "review.blockquoteSelectionTitle": "设为引用",
    "review.blockStyleTitle": "文本块样式（Ctrl/Cmd+Alt+0/1/2/3）",
    "review.bulletListSelection": "无序列表",
    "review.bulletListSelectionTitle": "设为无序列表（Ctrl/Cmd+Shift+8）",
    "review.candidate": "候选",
    "review.clipboardDiffTitle": "剪贴板替换选区",
    "review.codeSelectionTitle": "设为行内代码（Ctrl/Cmd+`）",
    "review.codeBlockSelection": "代码块",
    "review.codeBlockSelectionTitle": "设为代码块",
    "review.commentResolved": "已完成",
    "review.commentBodyLabel": "批注",
    "review.commentQuoteLabel": "原文片段",
    "review.commentStatusLabel": "状态",
    "review.commentUnresolved": "未处理",
    "review.clearComments": "清空批注",
    "review.clearCommentsTitle": "清空当前文本的全部批注",
    "review.clearCurrentDiffTitle": "清除当前修改标注（Ctrl/Cmd+Alt+Enter）",
    "review.clearDiffsTitle": "清除当前文本的修改标注",
    "review.clearFormattingTitle": "清除 Markdown 格式（Ctrl/Cmd+\\）",
    "review.commentsCount": "批注 {open} / {total}",
    "review.commentsPanelTitle": "批注",
    "review.complete": "完成",
    "review.completeCommentTitle": "完成当前批注（Ctrl/Cmd+Alt+D）",
    "review.copySelectionPrompt": "复制指令",
    "review.copySelectionPromptTitle": "复制选区、上下文和相关批注，交给外部 LLM 优化（Ctrl/Cmd+Alt+L）",
    "review.copyIssuePrompt": "复制当前命中优化指令",
    "review.copyIssuePromptTitle": "复制当前命中、上下文和相关批注，交给外部 LLM 优化（Ctrl/Cmd+Alt+L）",
    "review.copyCommentContextTitle": "复制当前批注上下文（Ctrl/Cmd+Alt+C）",
    "review.copyDiffContextTitle": "复制当前修改上下文（Ctrl/Cmd+Alt+Shift+C）",
    "review.copySelectionTitle": "复制选中文本",
    "review.delete": "删除",
    "review.deleteCommentTitle": "删除这条批注",
    "review.deletable": "可删除",
    "review.diffCount": "{count} 处修改",
    "review.diffDeletedLabel": "删除文本",
    "review.diffInsertedLabel": "插入文本",
    "review.diffSourceLabel": "来源",
    "review.diffSourceLlm": "外部 LLM / 剪贴板",
    "review.diffSourceStatic": "静态规则",
    "review.diffTitleLabel": "修改",
    "review.edit": "编辑",
    "review.editCommentTitle": "编辑当前批注（Ctrl/Cmd+Alt+E）",
    "review.emptyText": "空文本",
    "review.expandCommentsTitle": "展开批注栏",
    "review.fullTextClipboardDiffTitle": "剪贴板替换全文",
    "review.formatDiffTitle": "Markdown 格式化",
    "review.fixActionCount": "替换 {replace} / 删除 {delete}",
    "review.collapseCommentsTitle": "收起批注栏",
    "review.heading1Selection": "标题 1",
    "review.heading2Selection": "标题 2",
    "review.heading3Selection": "标题 3",
    "review.hitCount": "{count} 命中",
    "review.italicSelectionTitle": "斜体选区（Ctrl/Cmd+I）",
    "review.linkDiffTitle": "Markdown 链接",
    "review.linkSelectionTitle": "添加或更新链接（Ctrl/Cmd+K）",
    "review.linkUrlPlaceholder": "粘贴链接地址",
    "review.listIndentTitle": "增加列表缩进",
    "review.listOutdentTitle": "减少列表缩进",
    "review.locateSourceTitle": "切到源码位置",
    "review.locateCommentTitle": "定位到这条批注",
    "review.manualDecision": "需人工判断",
    "review.modePreview": "预览",
    "review.modePreviewTitle": "切到预览模式（Ctrl/Cmd+Alt+T）",
    "review.modeSource": "源码",
    "review.modeSourceTitle": "切到源码模式（Ctrl/Cmd+Alt+T）",
    "review.nextCommentTitle": "下一条批注（Ctrl/Cmd+Alt+J）",
    "review.nextDiffTitle": "下一处修改（Ctrl/Cmd+Alt+N）",
    "review.nextUnresolvedCommentTitle": "下一条未处理批注（Ctrl/Cmd+Alt+J）",
    "review.orderedListSelection": "有序列表",
    "review.orderedListSelectionTitle": "设为有序列表（Ctrl/Cmd+Shift+7）",
    "review.paragraphSelection": "段落",
    "review.previousCommentTitle": "上一条批注（Ctrl/Cmd+Alt+K）",
    "review.previousDiffTitle": "上一处修改（Ctrl/Cmd+Alt+P）",
    "review.previousUnresolvedCommentTitle": "上一条未处理批注（Ctrl/Cmd+Alt+K）",
    "review.previewMappingFailed": "预览选区无法精确映射到源码，请切到源码模式批注。",
    "review.previewOccurrenceMismatch": "这段文字在源码和预览中的出现次数不一致，请切到源码模式精确批注。",
    "review.repairBaselineDiffTitle": "修复稿相对原文",
    "review.replace": "替换",
    "review.replaceSelectionFromClipboardTitle": "用剪贴板替换选区（Ctrl/Cmd+Alt+V）",
    "review.replaceable": "可替换",
    "review.replaceableCount": "{count} 可替换",
    "review.resizeCommentsTitle": "拖拽调整批注栏宽度",
    "review.removeLink": "移除链接",
    "review.reopen": "重开",
    "review.reopenCommentTitle": "重开当前批注（Ctrl/Cmd+Alt+D）",
    "review.saveComment": "保存",
    "review.selectDiffTitle": "点击选中这处修改",
    "review.selectDiffFirstTitle": "先选择一处修改",
    "review.selectListFirstTitle": "先选择列表项",
    "review.selectTextFirst": "先选择一段正文",
    "review.selectionReadyTitle": "当前选区可批注",
    "review.selectionHint": "选择正文可添加批注",
    "review.selectedChars": "选中 {count} 字",
    "review.strikeSelectionTitle": "删除线选区（Ctrl/Cmd+Shift+X）",
    "review.unresolvedCount": "未处理 {open} / {total}",
    "review.writeCommentPlaceholder": "写一条批注",
    "review.zeroWidthSpace": "零宽空格",
    "review.zeroWidthNonJoiner": "零宽不连字",
    "review.zeroWidthJoiner": "零宽连字",
    "review.byteOrderMark": "字节序标记",
    "repair.changed": "净 {delta} 字",
    "repair.draft": "修复稿",
    "repair.originalBaseline": "原文 {count} 字",
    "repair.resetToOriginal": "回到原文",
    "repair.resetToOriginalTitle": "将修复稿重置为进入工作台时的原文",
    "repair.unchanged": "未修改",
    "text.clear": "清空",
    "text.cleanMechanical": "清理机械问题",
    "text.cleanMechanicalTitle": "清掉零宽字符、连续标点等确定性机械问题（代码块内不动）",
    "text.highlight": "行内高亮",
    "text.highlightTitle": "在正文里直接标出命中",
    "text.mask": "Markdown 遮罩",
    "text.maskTitle": "跳过代码块 / frontmatter / 链接",
    "text.placeholder": "在此粘贴中文稿件...（点“示例”可载入一段带 AI 味的样例）",
    "text.nextIssueTitle": "下一处命中（Ctrl/Cmd+Alt+↓）",
    "text.previousIssueTitle": "上一处命中（Ctrl/Cmd+Alt+↑）",
    "text.sample": "示例",
    "text.wordCount": "{count} 字",
    "home.recentScans": "最近检测历史",
    "home.clearHistory": "清空历史",
    "home.clearHistoryTitle": "清空历史",
    "home.collapseHistoryTitle": "收起历史",
    "home.deleteHistoryTitle": "删除",
    "home.expandHistoryTitle": "展开历史记录",
    "home.historyHoursAgo": "{count}小时前",
    "home.historyIssueCount": "{count} 处 AI 味",
    "home.historyJustNow": "刚刚",
    "home.historyMinutesAgo": "{count}分钟前",
    "home.recentScansCollapsed": "最近检测",
    "home.noHistory": "暂无本地检测历史记录",
    "home.aiFlavor": "AI 味",
    "home.readability": "想读度",
    "dataset.replace": "更换数据集",
    "dataset.chapterLabel": "第 {chapter} 章",
    "dataset.compareMode": "并排对比",
    "dataset.browseMode": "单篇浏览",
    "dataset.selectChapterPrompt": "← 从左侧选择章节开始阅读",
    "dataset.refHumanCharCount": "参考(人类) · {count} 字",
    "dataset.issuesHit": "命中 {count}",
    "dataset.renderStats": "{char} 字 · 命中 {hit}",
    "dataset.noRender": "本章节无渲染样本",
    "dataset.referenceHuman": "参考(人类)",
    "contribute.unknown": "不确定",
    "contribute.humanWriting": "人类写作",
    "contribute.aiGenerated": "AI 生成",
    "contribute.mixedWriting": "混合",
    "contribute.privateExport": "仅用于研究导出",
    "contribute.publicReview": "后续可参与众评",
    "contribute.blindReviewSaved": "盲评已保存，检测报告已揭示",
    "contribute.annotationSaved": "标注已保存",
    "contribute.title": "贡献检测数据",
    "contribute.charCount": "{count} 字符",
    "contribute.textPlaceholder": "粘贴小说正文...",
    "contribute.sourceLabel": "自述来源",
    "contribute.visibilityLabel": "可见性",
    "contribute.aiFlavorLabel": "AI 味：{count}",
    "contribute.aiFlavorLow": "0 像人",
    "contribute.aiFlavorHigh": "5 像 AI",
    "contribute.wantReadOnLabel": "想继续读：{count}",
    "contribute.wantReadOnLow": "0 马上关",
    "contribute.wantReadOnHigh": "5 想追更",
    "contribute.consentText": "我确认有权提交这段正文，并同意按研究数据保留",
    "contribute.submitting": "提交中",
    "contribute.submitBlindReview": "提交盲评",
    "contribute.textHighlight": "正文高亮",
    "contribute.visibleCharCount": "可见字数 {count}",
    "contribute.selectedSpan": "选中：{text}",
    "contribute.annotationPlaceholder": "哪里读起来不好，或者为什么像 AI？",
    "contribute.cancel": "取消",
    "contribute.saveAnnotation": "保存标注",
    "contribute.blindReviewSavedTitle": "盲评分已保存",
    "contribute.aiFlavorScore": "AI 味 {score}/5",
    "contribute.wantReadOnScore": "想读 {score}/5",
    "contribute.hitSummary": "命中 {total} 条：high {high} / medium {medium} / low {low}",
};

const enUS: Record<MessageKey, string> = {
    ...zhCN,
    "auth.identity": "Identity",
    "auth.identityEditor": "Editor",
    "auth.identityPro": "Industry professional",
    "auth.identityReader": "Reader",
    "auth.identityWriter": "Writer",
    "auth.loginDescription": "An account is required to enter the contribution flow.",
    "auth.loginFailed": "Log in failed",
    "auth.loginLink": "Already have an account? Log in",
    "auth.loginLoading": "Logging in",
    "auth.loginOk": "Logged in",
    "auth.loginTitle": "Log in",
    "auth.password": "Password",
    "auth.registerDescription": "Your self-declared identity is used only for later calibration and does not affect permissions.",
    "auth.registerFailed": "Registration failed",
    "auth.registerLink": "No account yet? Create one",
    "auth.registerLoading": "Creating account",
    "auth.registerOk": "Account created",
    "auth.registerTitle": "Create account",
    "auth.username": "Username",
    "common.agent": "Agent",
    "common.all": "All",
    "common.auto": "Auto",
    "common.cancel": "Cancel",
    "common.candidate": "Candidate",
    "common.clear": "Clear",
    "common.close": "Close",
    "common.confirm": "Confirm",
    "common.default": "Default",
    "common.disabled": "Disabled",
    "common.enabled": "Enabled",
    "common.high": "High",
    "common.human": "Human",
    "common.low": "Low",
    "common.manual": "Manual",
    "common.medium": "Medium",
    "common.none": "Mechanical",
    "common.reset": "Reset",
    "common.search": "Search",
    "common.system": "System",
    "common.selectOption": "Select an option",
    "common.themeLight": "Light",
    "common.themeDark": "Dark",
    "common.themeSepia": "Sepia",
    "common.undo": "Undo",
    "header.subtitle": "Chinese AI-style detector",
    "header.check": "Check",
    "header.dataset": "Dataset",
    "header.report": "Report",
    "header.settings": "Settings",
    "header.about": "About",
    "settings.title": "Settings",
    "settings.display": "Display",
    "settings.displayDescription": "Language and theme are stored only in this browser.",
    "settings.detection": "Detection",
    "settings.detectionDescription": "Adjust default filters and text display preferences.",
    "settings.rules": "Rules",
    "settings.language": "Language",
    "settings.theme": "Theme",
    "settings.highlight": "Inline highlights",
    "settings.mask": "Markdown mask",
    "settings.review": "Review",
    "settings.minLevel": "Min level",
    "settings.namespaces": "Namespaces",
    "settings.namespaceCount": "{count} namespaces",
    "settings.noRuleResult": "No matching rules.",
    "settings.ruleConfig": "Rule overrides",
    "settings.ruleDescription": "Override enablement, level, audience, and fixability by namespace or rule.",
    "settings.ruleSearch": "Search rules / namespace",
    "settings.resetAllRules": "Reset all rule overrides",
    "settings.activeRules": "{active}/{total} active",
    "settings.fixabilityOverride": "Fixability",
    "settings.levelOverride": "Level",
    "settings.reviewOverride": "Review",
    "llm.copyPromptOnly": "Copy prompt only",
    "llm.copyPromptWithText": "Copy prompt + current text",
    "llm.menuLabel": "External LLM",
    "llm.menuTitle": "Copy the current report and optimization advice for an external LLM",
    "llm.replaceFullBody": "The Markdown currently in your clipboard will replace the whole document. Hits and comment positions will be recalculated, and the notification undo action can restore the previous state.",
    "llm.replaceFullConfirm": "Replace full text",
    "llm.replaceFullFromClipboard": "Replace full text from clipboard",
    "llm.replaceFullTitle": "Replace full text from clipboard?",
    "layout.resizeReportPanelTitle": "Drag to resize report panel",
    "llmRules.description": "These rules require full-context semantic judgment in the llmlint Agent Skill flow. This page only runs deterministic regex rules.",
    "llmRules.title": "{count} Agent semantic rules (not checked on this regex-only page)",
    "dimension.fixability": "Fix",
    "dimension.level": "Level",
    "dimension.review": "Audience",
    "issue.applyTitle": "{action} this hit",
    "issue.clean": "No hits under current filters",
    "issue.collapse": "Collapse",
    "issue.count": "{count} hits",
    "issue.emptyNoText": "Paste text on the left to review hits",
    "issue.expandAll": "Show all ({count})",
    "issue.filteredHiddenDescription": "Relax audience, level, or namespace filters to view them.",
    "issue.filteredHiddenTitle": "{count} hits hidden by current filters",
    "issue.fixable": "Fixable",
    "issue.locateTitle": "Locate in text",
    "issue.locateIssueTitle": "Locate in text: {match}",
    "issue.openRule": "Details",
    "issue.openRuleTitle": "View rule details: {title}",
    "issue.applyIssueTitle": "{action} this hit: {match}",
    "issue.candidateApplyAction": "Candidate {action}",
    "issue.candidateFixable": "Candidate fix",
    "issue.resetRules": "Restore default rules",
    "issue.ruleSettingsHiddenDescription": "Restore default rules to scan this text again.",
    "issue.ruleSettingsHiddenTitle": "{count} default hits disabled by rule settings",
    "issue.showAll": "Show all hits",
    "notify.replacementDone": "Applied 1 replacement",
    "notify.commentDeleted": "Deleted 1 comment",
    "notify.commentContextCopied": "Comment context copied",
    "notify.commentRestoreSkipped": "Text changed; this comment could not be restored safely",
    "notify.commentUpdated": "Comment updated",
    "notify.commentsCleared": "Cleared {count} comments",
    "notify.diffCleared": "Cleared the current edit marker",
    "notify.diffContextCopied": "Edit context copied",
    "notify.diffRestoreSkipped": "Text changed; this edit marker could not be restored safely",
    "notify.diffsCleared": "Cleared {count} edit markers",
    "notify.documentChangeAutoReveal": "The new text had hits hidden by the current filters, so all hits are now shown",
    "notify.filtersAutoReveal": "The current filters hid all hits, so all hits are now shown",
    "notify.issueNotAutoReplaceable": "This hit cannot be replaced automatically",
    "notify.optimizationPromptCopied": "Optimization prompt copied",
    "notify.optimizationPromptWithTextCopied": "Optimization prompt and text copied",
    "notify.repairDraftReset": "Repair draft reset to original",
    "notify.ruleSettingsRestored": "Default rules restored and current filters relaxed",
    "notify.selectionCopied": "Selected text copied",
    "notify.selectionFormatted": "Selection formatted",
    "notify.clipboardEmpty": "Clipboard is empty; text was not replaced",
    "notify.clipboardReadFailed": "Clipboard read failed; check clipboard permission",
    "notify.selectionReplaced": "Selection replaced from clipboard",
    "notify.fullTextReplaced": "Full text replaced from clipboard",
    "notify.fullTextReplacedWithComments": "Full text replaced; comments were updated with the text",
    "notify.logoutFailed": "Log out failed",
    "notify.logoutOk": "Logged out",
    "ruleDetail.action": "Action",
    "ruleDetail.deleteReplacement": "(delete)",
    "ruleDetail.examples": "Examples",
    "ruleDetail.pattern": "Pattern",
    "text.sample": "Sample",
    "text.clear": "Clear",
    "text.cleanMechanical": "Clean mechanical issues",
    "text.cleanMechanicalTitle": "Clean deterministic mechanical issues such as zero-width characters and repeated punctuation, excluding code blocks",
    "text.highlight": "Inline highlights",
    "text.highlightTitle": "Show hits directly in the text",
    "text.mask": "Markdown mask",
    "text.maskTitle": "Skip code blocks, frontmatter, and links",
    "text.nextIssueTitle": "Next hit (Ctrl/Cmd+Alt+↓)",
    "text.previousIssueTitle": "Previous hit (Ctrl/Cmd+Alt+↑)",
    "text.wordCount": "{count} chars",
    "summary.copyJson": "Copy JSON",
    "summary.copyJsonTitle": "Copy the current result as CheckJsonReport JSON",
    "summary.clean": "No hits under current filters",
    "summary.filteredHidden": "Current filters hide {count} hits",
    "summary.hidden": "{count} hidden",
    "summary.noIssues": "No hits under current filters",
    "summary.resetRuleSettings": "Restore default rules",
    "summary.resetRuleSettingsTitle": "Restore default rule overrides and relax the current filters",
    "summary.ruleSettingsHidden": "Current rule settings disabled {count} default hits",
    "summary.ruleSettingsHiddenInline": "Rule settings hide another {count}",
    "summary.ruleSettingsWarning": "Current rule settings disabled default hits. Restore default rules from the right pane.",
    "summary.scanRules": "Scanned {count} rules",
    "summary.showHidden": "Show all hits",
    "summary.showHiddenTitle": "Relax current filters and show hidden hits",
    "summary.total": "{total} hits",
    "review.addComment": "Comment",
    "review.addCommentTitle": "Comment on selected text (Ctrl/Cmd+Alt+M)",
    "review.addIssueComment": "Comment hit",
    "review.addIssueCommentTitle": "Comment on current hit: \"{text}\" (Ctrl/Cmd+Alt+M)",
    "review.applyLink": "Apply link",
    "review.applyCandidateDelete": "Apply candidate delete",
    "review.applyCandidateReplace": "Apply candidate replace",
    "review.applyDelete": "Apply delete",
    "review.applyReplace": "Apply replace",
    "review.activeReplacementTitle": "Apply current replacement (Ctrl/Cmd+Alt+R)",
    "review.activeIssueCommentPlaceholder": "Write a comment for this hit",
    "review.boldSelectionTitle": "Bold selection (Ctrl/Cmd+B)",
    "review.blockquoteSelection": "Blockquote",
    "review.blockquoteSelectionTitle": "Format as blockquote",
    "review.blockStyleTitle": "Text block style (Ctrl/Cmd+Alt+0/1/2/3)",
    "review.bulletListSelection": "Bullet list",
    "review.bulletListSelectionTitle": "Format as bullet list (Ctrl/Cmd+Shift+8)",
    "review.candidate": "Candidate",
    "review.clipboardDiffTitle": "Selection replaced from clipboard",
    "review.codeSelectionTitle": "Mark as inline code (Ctrl/Cmd+`)",
    "review.codeBlockSelection": "Code block",
    "review.codeBlockSelectionTitle": "Format as code block",
    "review.commentResolved": "Done",
    "review.commentBodyLabel": "Comment",
    "review.commentQuoteLabel": "Quoted text",
    "review.commentStatusLabel": "Status",
    "review.commentUnresolved": "Open",
    "review.clearComments": "Clear comments",
    "review.clearCommentsTitle": "Clear all comments for this text",
    "review.clearCurrentDiffTitle": "Clear current edit marker (Ctrl/Cmd+Alt+Enter)",
    "review.clearDiffsTitle": "Clear edit markers for this text",
    "review.clearFormattingTitle": "Clear Markdown formatting (Ctrl/Cmd+\\)",
    "review.commentsCount": "Comments {open} / {total}",
    "review.commentsPanelTitle": "Comments",
    "review.complete": "Complete",
    "review.completeCommentTitle": "Complete current comment (Ctrl/Cmd+Alt+D)",
    "review.copySelectionPrompt": "Copy prompt",
    "review.copySelectionPromptTitle": "Copy this selection, context, and related comments for an external LLM (Ctrl/Cmd+Alt+L)",
    "review.copyIssuePrompt": "Copy hit prompt",
    "review.copyIssuePromptTitle": "Copy this hit, context, and related comments for an external LLM (Ctrl/Cmd+Alt+L)",
    "review.copyCommentContextTitle": "Copy current comment context (Ctrl/Cmd+Alt+C)",
    "review.copyDiffContextTitle": "Copy current edit context (Ctrl/Cmd+Alt+Shift+C)",
    "review.copySelectionTitle": "Copy selected text",
    "review.delete": "Delete",
    "review.deleteCommentTitle": "Delete this comment",
    "review.deletable": "Deletable",
    "review.diffCount": "{count} edits",
    "review.diffDeletedLabel": "Deleted text",
    "review.diffInsertedLabel": "Inserted text",
    "review.diffSourceLabel": "Source",
    "review.diffSourceLlm": "External LLM / clipboard",
    "review.diffSourceStatic": "Static rule",
    "review.diffTitleLabel": "Edit",
    "review.edit": "Edit",
    "review.editCommentTitle": "Edit current comment (Ctrl/Cmd+Alt+E)",
    "review.emptyText": "empty text",
    "review.expandCommentsTitle": "Expand comments",
    "review.fullTextClipboardDiffTitle": "Full text replaced from clipboard",
    "review.formatDiffTitle": "Markdown formatting",
    "review.fixActionCount": "{replace} replace / {delete} delete",
    "review.collapseCommentsTitle": "Collapse comments",
    "review.heading1Selection": "Heading 1",
    "review.heading2Selection": "Heading 2",
    "review.heading3Selection": "Heading 3",
    "review.hitCount": "{count} hits",
    "review.italicSelectionTitle": "Italic selection (Ctrl/Cmd+I)",
    "review.linkDiffTitle": "Markdown link",
    "review.linkSelectionTitle": "Add or update link (Ctrl/Cmd+K)",
    "review.linkUrlPlaceholder": "Paste link URL",
    "review.listIndentTitle": "Increase list indent",
    "review.listOutdentTitle": "Decrease list indent",
    "review.locateSourceTitle": "Go to source position",
    "review.locateCommentTitle": "Locate this comment",
    "review.manualDecision": "Manual review",
    "review.modePreview": "Preview",
    "review.modePreviewTitle": "Switch to preview mode (Ctrl/Cmd+Alt+T)",
    "review.modeSource": "Source",
    "review.modeSourceTitle": "Switch to source mode (Ctrl/Cmd+Alt+T)",
    "review.nextCommentTitle": "Next comment (Ctrl/Cmd+Alt+J)",
    "review.nextDiffTitle": "Next edit (Ctrl/Cmd+Alt+N)",
    "review.nextUnresolvedCommentTitle": "Next open comment (Ctrl/Cmd+Alt+J)",
    "review.orderedListSelection": "Ordered list",
    "review.orderedListSelectionTitle": "Format as ordered list (Ctrl/Cmd+Shift+7)",
    "review.paragraphSelection": "Paragraph",
    "review.previousCommentTitle": "Previous comment (Ctrl/Cmd+Alt+K)",
    "review.previousDiffTitle": "Previous edit (Ctrl/Cmd+Alt+P)",
    "review.previousUnresolvedCommentTitle": "Previous open comment (Ctrl/Cmd+Alt+K)",
    "review.previewMappingFailed": "This preview selection cannot be mapped precisely to source. Switch to source mode to comment.",
    "review.previewOccurrenceMismatch": "This text appears a different number of times in source and preview. Switch to source mode for precise commenting.",
    "review.repairBaselineDiffTitle": "Repair draft vs original",
    "review.replace": "Replace",
    "review.replaceSelectionFromClipboardTitle": "Replace selection from clipboard (Ctrl/Cmd+Alt+V)",
    "review.replaceable": "Replaceable",
    "review.replaceableCount": "{count} replaceable",
    "review.resizeCommentsTitle": "Drag to resize comments panel",
    "review.removeLink": "Remove link",
    "review.reopen": "Reopen",
    "review.reopenCommentTitle": "Reopen current comment (Ctrl/Cmd+Alt+D)",
    "review.saveComment": "Save",
    "review.selectDiffTitle": "Click to select this edit",
    "review.selectDiffFirstTitle": "Select an edit first",
    "review.selectListFirstTitle": "Select a list item first",
    "review.selectTextFirst": "Select body text first",
    "review.selectionReadyTitle": "Current selection can be commented",
    "review.selectionHint": "Select body text to add a comment",
    "review.selectedChars": "{count} chars selected",
    "review.strikeSelectionTitle": "Strikethrough selection (Ctrl/Cmd+Shift+X)",
    "review.unresolvedCount": "Open {open} / {total}",
    "review.writeCommentPlaceholder": "Write a comment",
    "review.zeroWidthSpace": "zero-width space",
    "review.zeroWidthNonJoiner": "zero-width non-joiner",
    "review.zeroWidthJoiner": "zero-width joiner",
    "review.byteOrderMark": "byte order mark",
    "repair.changed": "Net {delta} chars",
    "repair.draft": "Repair draft",
    "repair.originalBaseline": "Original {count} chars",
    "repair.resetToOriginal": "Reset",
    "repair.resetToOriginalTitle": "Reset the repair draft to the original text captured when entering the workbench",
    "repair.unchanged": "Unchanged",
    "header.account": "Account",
    "header.contribute": "Contribute data",
    "header.login": "Log in",
    "header.logout": "Log out",
    "header.register": "Create account",
    "home.description": "Scan Chinese drafts locally for templated phrasing, mechanical rhetoric, and suspicious rule hits. Hits are candidates; context still decides.",
    "home.fileReadFailed": "Could not read this file. Try another text file.",
    "home.local": "Runs in your browser",
    "home.markdown": "Markdown masking supported",
    "home.pickFile": "Choose file",
    "home.placeholder": "Paste text, or drop a .txt / .md file",
    "home.start": "Start scan",
    "home.title": "Chinese AI-style draft scanner",
    "home.recentScans": "Recent Scans",
    "home.clearHistory": "Clear History",
    "home.clearHistoryTitle": "Clear history",
    "home.collapseHistoryTitle": "Collapse history",
    "home.deleteHistoryTitle": "Delete",
    "home.expandHistoryTitle": "Expand recent scans",
    "home.historyHoursAgo": "{count}h ago",
    "home.historyIssueCount": "{count} AI-style hits",
    "home.historyJustNow": "Just now",
    "home.historyMinutesAgo": "{count}m ago",
    "home.recentScansCollapsed": "RECENT",
    "home.noHistory": "No recent scans on this browser",
    "home.aiFlavor": "AI Flavor",
    "home.readability": "Readability",
    "dataset.replace": "Change Dataset",
    "dataset.chapterLabel": "Chapter {chapter}",
    "dataset.compareMode": "Compare side-by-side",
    "dataset.browseMode": "Browse single",
    "dataset.selectChapterPrompt": "← Select a chapter from the list",
    "dataset.refHumanCharCount": "Reference (Human) · {count} chars",
    "dataset.issuesHit": "{count} issues",
    "dataset.renderStats": "{char} chars · {hit} hits",
    "dataset.noRender": "No rendered sample for this chapter",
    "dataset.referenceHuman": "Reference (Human)",
    "contribute.unknown": "Unknown / Unsure",
    "contribute.humanWriting": "Human Writing",
    "contribute.aiGenerated": "AI Generated",
    "contribute.mixedWriting": "Mixed",
    "contribute.privateExport": "For research exports only",
    "contribute.publicReview": "Can participate in review later",
    "contribute.blindReviewSaved": "Blind review saved. Scanned report revealed.",
    "contribute.annotationSaved": "Annotation saved",
    "contribute.title": "Contribute Scan Data",
    "contribute.charCount": "{count} chars",
    "contribute.textPlaceholder": "Paste novel text here...",
    "contribute.sourceLabel": "Self-declared provenance",
    "contribute.visibilityLabel": "Visibility",
    "contribute.aiFlavorLabel": "AI Flavor: {count}",
    "contribute.aiFlavorLow": "0 human-like",
    "contribute.aiFlavorHigh": "5 AI-like",
    "contribute.wantReadOnLabel": "Want to read on: {count}",
    "contribute.wantReadOnLow": "0 close immediately",
    "contribute.wantReadOnHigh": "5 want to follow",
    "contribute.consentText": "I confirm I have the right to submit this text, and agree to keep it as research data",
    "contribute.submitting": "Submitting",
    "contribute.submitBlindReview": "Submit Blind Review",
    "contribute.textHighlight": "Highlighted Text",
    "contribute.visibleCharCount": "Visible count {count}",
    "contribute.selectedSpan": "Selected: {text}",
    "contribute.annotationPlaceholder": "Where does it read poorly, or why does it feel AI-generated?",
    "contribute.cancel": "Cancel",
    "contribute.saveAnnotation": "Save Annotation",
    "contribute.blindReviewSavedTitle": "Blind scores saved",
    "contribute.aiFlavorScore": "AI Flavor {score}/5",
    "contribute.wantReadOnScore": "Likeability {score}/5",
    "contribute.hitSummary": "{total} issues: high {high} / medium {medium} / low {low}",
};

export const messages: Record<SupportedLocale, Record<MessageKey, string>> = {
    "zh-CN": zhCN,
    "en-US": enUS,
};

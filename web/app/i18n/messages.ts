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
    | "common.retry"
    | "common.search"
    | "common.selectOption"
    | "common.system"
    | "common.themeDark"
    | "common.themeLight"
    | "common.themeSepia"
    | "common.undo"
    | "header.about"
    | "header.account"
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
    | "issue.hideRuleTitle"
    | "issue.locateTitle"
    | "issue.locateIssueTitle"
    | "issue.openRule"
    | "issue.openRuleTitle"
    | "issue.applyIssueTitle"
    | "issue.resetRules"
    | "issue.ruleSettingsHiddenDescription"
    | "issue.ruleSettingsHiddenTitle"
    | "issue.showAll"
    | "issue.applyGroup"
    | "issue.applyGroupTitle"
    | "issue.batchSelectTitle"
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
    | "contribute.selectedSpan"
    | "contribute.annotationPlaceholder"
    | "contribute.cancel"
    | "contribute.saveAnnotation"
    | "contribute.blindReviewSavedTitle"
    | "contribute.aiFlavorScore"
    | "contribute.wantReadOnScore"
    | "contribute.hitSummary"
    | "contribute.genreLabel"
    | "contribute.textTypeLabel"
    | "contribute.sourceNoteLabel"
    | "contribute.sourceNotePlaceholder"
    | "contribute.notProvided"
    | "contribute.blindHint"
    | "contribute.skipBlindReview"
    | "contribute.consentRequired"
    | "contribute.uploadRevealed"
    | "contribute.blindSkippedTitle"
    | "contribute.uploadButton"
    | "contribute.flowStage1"
    | "contribute.flowStage2"
    | "contribute.flowStage3"
    | "contribute.flowStageLockWorkspace"
    | "contribute.flowStageLockDone"
    | "contribute.guideDraft"
    | "contribute.guideBlind"
    | "contribute.guideWorkspace"
    | "contribute.guideViewing"
    | "contribute.guideCollapse"
    | "contribute.guideExpand"
    | "contribute.guideLabel"
    | "contribute.lineageLabel"
    | "contribute.lineageKindUpload"
    | "contribute.lineageKindStatic"
    | "contribute.lineageKindLlm"
    | "contribute.lineageKindUser"
    | "contribute.lineageCurrentTitle"
    | "contribute.versionViewTitle"
    | "contribute.versionViewHeadTitle"
    | "contribute.versionDraftChip"
    | "contribute.versionDraftTitle"
    | "contribute.recheckButton"
    | "contribute.recheckTitle"
    | "contribute.tabReport"
    | "contribute.tabIssues"
    | "contribute.tabAiFix"
    | "contribute.aiFixPanelHint"
    | "contribute.aiFixSelectionHint"
    | "contribute.aiFixNeedEditor"
    | "contribute.agentChatTitle"
    | "contribute.agentChatHint"
    | "contribute.agentChatLoading"
    | "contribute.agentChatYou"
    | "contribute.agentChatEdit"
    | "contribute.agentChatReport"
    | "contribute.agentChatSelection"
    | "contribute.agentChatPlaceholder"
    | "contribute.agentChatRunning"
    | "contribute.agentChatShortcut"
    | "contribute.agentChatSend"
    | "contribute.agentThinking"
    | "contribute.agentConnectionConnected"
    | "contribute.agentConnectionConnecting"
    | "contribute.agentConnectionReconnecting"
    | "contribute.agentConnectionRecovering"
    | "contribute.agentConnectionDisconnected"
    | "contribute.agentPhasePending"
    | "contribute.agentPhaseStreaming"
    | "contribute.agentPhaseTool"
    | "contribute.agentPhaseFinishing"
    | "contribute.reportSummaryTitle"
    | "contribute.summaryHitsLine"
    | "contribute.summaryStrongLine"
    | "contribute.summaryAutoLine"
    | "contribute.summaryHiddenLine"
    | "contribute.processExplain"
    | "contribute.docScoreExplain"
    | "contribute.detectExplain"
    | "contribute.compareExplain"
    | "contribute.viewingTitle"
    | "contribute.draftKeptNotice"
    | "contribute.headAnnotateButton"
    | "contribute.headAnnotateTitle"
    | "contribute.backToEditButton"
    | "contribute.finishLlmFixRunning"
    | "contribute.summaryTitle"
    | "contribute.summaryThanks"
    | "contribute.summaryScoresTitle"
    | "contribute.summaryBlindCol"
    | "contribute.summaryFinalCol"
    | "contribute.summaryAiFlavorRow"
    | "contribute.summaryWantReadOnRow"
    | "contribute.summarySkippedBlind"
    | "contribute.summaryNotRescored"
    | "contribute.summaryD5Row"
    | "contribute.summaryVerdictNone"
    | "contribute.summaryAnnotationsRow"
    | "contribute.summaryAnnotationsValue"
    | "contribute.restartButton"
    | "contribute.finishButton"
    | "contribute.viewDataset"
    | "contribute.editHits"
    | "contribute.baseHits"
    | "contribute.hitsDown"
    | "contribute.hitsNotDown"
    | "contribute.committing"
    | "contribute.commitFailed"
    | "contribute.strongFixScope"
    | "contribute.staticFixButton"
    | "contribute.staticFixTitle"
    | "contribute.oneClickFixButton"
    | "contribute.oneClickFixTitle"
    | "contribute.strongFixDegraded"
    | "contribute.blindCardTitle"
    | "contribute.scoreCardTitle"
    | "contribute.scoreRefNote"
    | "contribute.scoreDegradedNote"
    | "contribute.scoreDetecting"
    | "contribute.scoreDetectingNote"
    | "contribute.scoreGradeHeavy"
    | "contribute.scoreGradeObvious"
    | "contribute.scoreGradeLight"
    | "contribute.scoreGradeHuman"
    | "contribute.llmReviewCardTitle"
    | "contribute.llmReviewWaitingNote"
    | "contribute.llmReviewModelLine"
    | "contribute.llmReviewNoHits"
    | "contribute.processTitle"
    | "contribute.processEngine"
    | "contribute.processEngineDone"
    | "contribute.processDetector"
    | "contribute.processDetectorDone"
    | "contribute.processLlmJudge"
    | "contribute.processLlmJudgeNote"
    | "contribute.channelWaiting"
    | "contribute.channelRunning"
    | "contribute.channelCompleted"
    | "contribute.channelFailed"
    | "contribute.channelCancelled"
    | "contribute.channelInterrupted"
    | "contribute.channelUnavailable"
    | "contribute.llmConfidence"
    | "contribute.compositeSecondary"
    | "contribute.compositeComplete"
    | "contribute.compositePartial"
    | "contribute.llmEvidenceTitle"
    | "contribute.llmSuggestionsTitle"
    | "contribute.llmHitsDetail"
    | "contribute.riskDirectionNote"
    | "contribute.riskIndex"
    | "contribute.riskLow"
    | "contribute.riskModerate"
    | "contribute.riskElevated"
    | "contribute.riskHigh"
    | "contribute.compositeRisk"
    | "contribute.rerunReview"
    | "contribute.metricsTitle"
    | "contribute.metricsNote"
    | "contribute.compareWithRev0"
    | "contribute.actionGroupTitle"
    | "contribute.verdictHitsRow"
    | "contribute.verdictCompareValue"
    | "contribute.docScoreRow"
    | "contribute.detectPAi"
    | "contribute.detectPending"
    | "contribute.detectUnavailable"
    | "contribute.detectCompareRow"
    | "contribute.detectCompareValue"
    | "contribute.detectDown"
    | "contribute.detectNotDown"
    | "contribute.detectComparePending"
    | "contribute.detectCompareUnavailable"
    | "contribute.llmFixButton"
    | "contribute.llmFixRunning"
    | "contribute.llmFixTitle"
    | "contribute.llmFixDiffTitle"
    | "contribute.llmFixNoChanges"
    | "contribute.llmFixStaleTitle"
    | "contribute.llmFixStaleBody"
    | "contribute.llmFixStaleApply"
    | "contribute.llmFixStaleDiscard"
    | "contribute.llmFixDiscarded"
    | "contribute.llmFixFailed"
    | "contribute.llmFixFailedPlain"
    | "contribute.llmFixTimeout"
    | "contribute.llmFixUnavailableNote"
    | "contribute.llmFixBusy"
    | "contribute.llmFixCancel"
    | "contribute.llmFixCancelTitle"
    | "contribute.llmFixCancelled"
    | "contribute.llmFixRetry"
    | "contribute.llmFixTooLong"
    | "contribute.llmFixSelectionDiffTitle"
    | "contribute.llmFixSelectionStale"
    | "contribute.llmReviewTitle"
    | "contribute.llmReviewVisited"
    | "contribute.llmReviewPrevious"
    | "contribute.llmReviewNext"
    | "contribute.llmReviewReject"
    | "contribute.postJudgmentTitle"
    | "contribute.postJudgmentHint"
    | "contribute.postAiFlavorLabel"
    | "contribute.postWantReadOnLabel"
    | "contribute.blindBaselineRef"
    | "contribute.noBlindBaseline"
    | "contribute.improvementLabel"
    | "contribute.improvementLow"
    | "contribute.improvementHigh"
    | "contribute.commentLabel"
    | "contribute.commentPlaceholder"
    | "contribute.submitPostJudgment"
    | "contribute.postJudgmentSavedButton"
    | "contribute.postJudgmentSaved"
    | "contribute.postJudgmentFailed"
    | "contribute.verdictPassTitle"
    | "contribute.verdictPassTitleDegraded"
    | "contribute.verdictFailTitle"
    | "contribute.verdictNoBaselineTitle"
    | "contribute.verdictDetail"
    | "contribute.verdictHitsLowered"
    | "contribute.verdictHitsNotLowered"
    | "contribute.verdictDetectorLowered"
    | "contribute.verdictDetectorNotLowered"
    | "contribute.verdictWantKept"
    | "contribute.verdictWantDropped"
    | "contribute.verdictWantNoBaseline"
    | "contribute.verdictScopeDetector"
    | "contribute.verdictScopeHitsFallback"
    | "contribute.continueHint"
    | "contribute.historyTitle"
    | "contribute.historyLoading"
    | "contribute.historyLoadFailed"
    | "contribute.historyEmpty"
    | "contribute.historyOpenTitle"
    | "contribute.historyOpenFailed"
    | "contribute.historyRevisionCount"
    | "contribute.historyDocScore"
    | "contribute.historyNotRevealed"
    | "contribute.historyAnonymousNote"
    | "contribute.heatmapToggle"
    | "contribute.heatmapToggleTitle"
    | "contribute.heatmapStripTitle"
    | "contribute.llmStreamTitle"
    | "contribute.llmStreamWaiting"
    | "contribute.llmEditsCount"
    | "contribute.batchApplySelected"
    | "contribute.batchApplyClear"
    | "notify.batchReplacementDone"
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
    | "notify.ruleHidden"
    | "notify.optimizationPromptCopied"
    | "notify.optimizationPromptWithTextCopied"
    | "notify.repairDraftReset"
    | "notify.ruleSettingsRestored"
    | "notify.selectionCopied"
    | "notify.selectionFormatted"
    | "notify.clipboardEmpty"
    | "notify.clipboardReadFailed"
    | "notify.selectionReplaced"
    | "notify.selectionLlmRewritten"
    | "notify.fullTextReplaced"
    | "notify.fullTextReplacedWithComments"
    | "notify.llmRewriteApplied"
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
    | "rules.colAiRate"
    | "rules.colEffLift"
    | "rules.colHumanRate"
    | "rules.colRule"
    | "rules.colVerdict"
    | "rules.colVisibility"
    | "rules.degraded"
    | "rules.description"
    | "rules.effLiftHint"
    | "rules.hideRule"
    | "rules.llmNotScanned"
    | "rules.llmPrompt"
    | "rules.meta"
    | "rules.noMatch"
    | "rules.pageInfo"
    | "rules.pageNext"
    | "rules.pagePrev"
    | "rules.profileAnti"
    | "rules.profileExcluded"
    | "rules.profileNoise"
    | "rules.profileOverlap"
    | "rules.rateHint"
    | "rules.sampleCounts"
    | "rules.searchPlaceholder"
    | "rules.showRule"
    | "rules.statFireFrac"
    | "rules.statHits"
    | "rules.statLift"
    | "rules.statPairs"
    | "rules.statPrevLift"
    | "rules.title"
    | "rules.typeLlm"
    | "rules.typeReplace"
    | "rules.typeSuggest"
    | "rules.untestedNote"
    | "rules.verdictAnti"
    | "rules.verdictInsufficient"
    | "rules.verdictNoise"
    | "rules.verdictStrong"
    | "rules.verdictUntested"
    | "rules.verdictWeak"
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
    | "review.commentStale"
    | "review.commentStaleTitle"
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
    | "review.llmRewriteSelection"
    | "review.llmRewriteSelectionTitle"
    | "review.annotateSelection"
    | "review.annotateSelectionTitle"
    | "review.annotationNotePlaceholder"
    | "contribute.annotationSpanEdited"
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
    | "review.proofreadApplyHint"
    | "review.proofreadOffTitle"
    | "review.proofreadOnTitle"
    | "review.ruleMenuHide"
    | "review.ruleHiddenNotice"
    | "review.draftDiffOnTitle"
    | "review.draftDiffOffTitle"
    | "review.editorHeatmapOnTitle"
    | "review.editorHeatmapOffTitle"
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
    "common.retry": "重试",
    "common.search": "搜索",
    "common.selectOption": "选择选项",
    "common.system": "跟随系统",
    "common.themeDark": "深色",
    "common.themeLight": "浅色",
    "common.themeSepia": "纸张",
    "common.undo": "撤销",
    "header.about": "关于 / 使用说明",
    "header.account": "账号",
    "header.contribute": "检测",
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
    "issue.hideRuleTitle": "隐藏此规则的所有命中（可在规则页恢复显示）",
    "issue.locateTitle": "点击定位到正文",
    "issue.locateIssueTitle": "定位到正文：{match}",
    "issue.openRule": "详情",
    "issue.openRuleTitle": "查看规则详情：{title}",
    "issue.applyIssueTitle": "{action}此处命中：{match}",
    "issue.resetRules": "恢复默认规则",
    "issue.ruleSettingsHiddenDescription": "恢复默认规则后可重新检查这段文本。",
    "issue.ruleSettingsHiddenTitle": "当前规则设置关闭了 {count} 条默认命中",
    "issue.showAll": "查看全部命中",
    "issue.applyGroup": "应用全部（{count} 处）",
    "issue.applyGroupTitle": "应用该规则的全部可自动替换命中（坐标从后往前并入，一条通知内可整批撤销）",
    "issue.batchSelectTitle": "勾选该规则，参与上方「应用所选规则」批量替换",
    "notify.cleanDone": "已清理 {count} 处机械问题",
    "notify.batchReplacementDone": "已批量应用 {count} 处替换",
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
    "notify.ruleHidden": "已隐藏该规则：编辑器与命中列表不再显示它（可在「规则」页恢复）",
    "notify.optimizationPromptCopied": "已复制优化指令",
    "notify.optimizationPromptWithTextCopied": "已复制优化指令和正文",
    "notify.repairDraftReset": "修复稿已重置为原文",
    "notify.ruleSettingsRestored": "已恢复默认规则并放宽当前过滤器",
    "notify.selectionCopied": "已复制选中文本",
    "notify.selectionFormatted": "已格式化选区",
    "notify.clipboardEmpty": "剪贴板为空，未替换文本",
    "notify.clipboardReadFailed": "读取剪贴板失败，请检查剪贴板权限",
    "notify.selectionReplaced": "已用剪贴板替换选区",
    "notify.selectionLlmRewritten": "已并入选区 AI 改写",
    "notify.fullTextReplaced": "已用剪贴板替换全文",
    "notify.fullTextReplacedWithComments": "已用剪贴板替换全文，批注会随正文变化更新",
    "notify.llmRewriteApplied": "已并入 AI 改写：{count} 处修改",
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
    "rules.colAiRate": "AI 率",
    "rules.colEffLift": "effLift",
    "rules.colHumanRate": "人类率",
    "rules.colRule": "规则",
    "rules.colVerdict": "裁决",
    "rules.colVisibility": "显示",
    "rules.degraded": "评测数据缺失：本次构建未跑评测（report.json 缺失），仅展示规则本体，无判别统计。",
    "rules.description": "内置 regex 规则全量清单，附评测判别统计，默认按 effectiveLift（判别力）降序。",
    "rules.effLiftHint": "effectiveLift = max(lift, prevalenceLift)：裁决与排序口径",
    "rules.hideRule": "隐藏此规则（本机扫描不再报告其命中）",
    "rules.llmNotScanned": "LLM 规则未参与静态扫描：仅登记规则本体，无命中与判别统计。",
    "rules.llmPrompt": "检测提示词（概要）",
    "rules.meta": "共 {total} 条规则 · 已测 {tested} 条 · 引擎 {engine}",
    "rules.noMatch": "无匹配规则",
    "rules.pageInfo": "第 {page} / {pages} 页 · 共 {count} 条",
    "rules.pageNext": "下一页",
    "rules.pagePrev": "上一页",
    "rules.profileAnti": "该规则在 holdout 训练集更偏向人类文本，未进入创作 Profile。",
    "rules.profileExcluded": "创作 Profile 排除",
    "rules.profileNoise": "该规则在 holdout 训练集未显示足够的 AI 判别力，未进入创作 Profile。",
    "rules.profileOverlap": "该规则与 {canonical} 高度重叠，创作 Profile 只保留 canonical rule。",
    "rules.rateHint": "两侧千字命中率中位数",
    "rules.sampleCounts": "样本：人类 {human} 篇 · AI {ai} 篇 · min-support {minSupport}",
    "rules.searchPlaceholder": "搜规则 ID / 名称 / 说明…",
    "rules.showRule": "恢复显示（清除该规则的隐藏覆盖）",
    "rules.statFireFrac": "命中文档占比：人 {human} · AI {ai}",
    "rules.statHits": "命中数：人 {human} · AI {ai}",
    "rules.statLift": "lift（千字率比）",
    "rules.statPairs": "逐章配对 AI>人：{aiGreater}/{total}",
    "rules.statPrevLift": "prevLift（文档占比比）",
    "rules.title": "规则库",
    "rules.typeLlm": "LLM 规则",
    "rules.typeReplace": "替换模板",
    "rules.typeSuggest": "仅检测",
    "rules.untestedNote": "该规则未进入本次评测报告（两侧均未命中或样本不足）。",
    "rules.verdictAnti": "反指标",
    "rules.verdictInsufficient": "数据不足",
    "rules.verdictNoise": "噪声",
    "rules.verdictStrong": "强判别",
    "rules.verdictUntested": "未测",
    "rules.verdictWeak": "弱",
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
    "review.commentStale": "原句已改",
    "review.commentStaleTitle": "批注锚定的原文片段在当前草稿中已被改动，引文可能与正文不一致",
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
    "review.llmRewriteSelection": "AI 改写选区",
    "review.llmRewriteSelectionTitle": "用内置 AI 通道改写选中片段（携带上下文与相关批注；结果以可撤销的修改并入）",
    "review.annotateSelection": "保存标注",
    "review.annotateSelectionTitle": "把选中片段保存为数据集标注（挂当前版本正文坐标）",
    "review.annotationNotePlaceholder": "哪里读起来不好，或者为什么像 AI？",
    "contribute.annotationSpanEdited": "该片段已被编辑，映射回原文不可靠：请对未修改的片段标注",
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
    "review.proofreadApplyHint": "点击查看规则与应用",
    "review.proofreadOffTitle": "校对批注已关闭：开启后可自动修复的命中会在正文行内显示删除线与建议文本，点击符号打开规则菜单应用",
    "review.proofreadOnTitle": "校对批注已开启：可自动修复的命中在正文行内显示删除线与建议文本，点击符号打开规则菜单应用；再点此关闭",
    "review.ruleMenuHide": "隐藏此规则",
    "review.ruleHiddenNotice": "已隐藏规则「{title}」，后续扫描不再提示",
    "review.draftDiffOnTitle": "修改痕迹已显示：正文标注本轮草稿相对原文的未提交改动；点此隐藏",
    "review.draftDiffOffTitle": "修改痕迹已隐藏：开启后正文标注本轮草稿相对原文的未提交改动",
    "review.editorHeatmapOnTitle": "编辑器热力图已开启：正文按检测分块铺 P(AI) 梯度底色（数值锚定上次检测，编辑后渐陈旧）；点此关闭",
    "review.editorHeatmapOffTitle": "编辑器热力图已关闭：开启后正文按检测分块铺 P(AI) 梯度底色",
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
    "contribute.title": "检测正文",
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
    "contribute.selectedSpan": "选中：{text}",
    "contribute.annotationPlaceholder": "哪里读起来不好，或者为什么像 AI？",
    "contribute.cancel": "取消",
    "contribute.saveAnnotation": "保存标注",
    "contribute.blindReviewSavedTitle": "初读打分：",
    "contribute.aiFlavorScore": "AI 味 {score}/5",
    "contribute.wantReadOnScore": "想继续读 {score}/5",
    "contribute.hitSummary": "命中 {total} 条：high {high} / medium {medium} / low {low}",
    "contribute.genreLabel": "题材（可选）",
    "contribute.textTypeLabel": "体裁（可选）",
    "contribute.sourceNoteLabel": "作品名（可选）",
    "contribute.sourceNotePlaceholder": "作品名或出处，可留空",
    "contribute.notProvided": "不填",
    "contribute.blindHint": "两轴打分可跳过：现在打分即为盲评（先于机器结果揭示）；跳过则本篇没有盲评基线，验收时人评腿不可判。",
    "contribute.skipBlindReview": "跳过打分直接看报告",
    "contribute.consentRequired": "请先确认授权与保留说明",
    "contribute.uploadRevealed": "已上传并揭示检测报告（未打盲评）",
    "contribute.blindSkippedTitle": "本篇未做初读打分（无前后对照基线）",
    "contribute.uploadButton": "上传并进入工作台",
    "contribute.flowStage1": "上传",
    "contribute.flowStage2": "工作台",
    "contribute.flowStage3": "完成",
    "contribute.flowStageLockWorkspace": "上传正文后进入检测工作台",
    "contribute.flowStageLockDone": "在工作台报告页点「完成本篇」",
    "contribute.guideDraft": "粘贴正文、按需填写自报信息，上传后进入检测工作台——报告揭示前会先请你盲评打分（可跳过）。",
    "contribute.guideBlind": "凭第一印象给「AI 味」「想继续读」打分——先打分再看报告，直觉不被机器结果带偏（也可跳过）。提交后揭示检测报告。",
    "contribute.guideWorkspace": "左侧编辑正文：一键清理 → 逐条处理命中 → 手改，随时可撤销；右侧「检测报告 / 命中列表 / AI 改写」三个页签，AI 改写以 diff 并入左侧逐处审阅。改好后点「再次检测」保存新版本并重新检测。",
    "contribute.guideViewing": "正在查看历史版本（只读）：右侧是该版检测报告，选中正文片段可写标注——AI 改写会参考你的标注。点版本条最新一版回到编辑器。",
    "contribute.guideCollapse": "收起引导",
    "contribute.guideExpand": "展开引导",
    "contribute.guideLabel": "流程引导",
    "contribute.lineageLabel": "修订链",
    "contribute.lineageKindUpload": "原文",
    "contribute.lineageKindStatic": "静态清理",
    "contribute.lineageKindLlm": "AI 改写",
    "contribute.lineageKindUser": "手改",
    "contribute.lineageCurrentTitle": "当前版本",
    "contribute.versionViewTitle": "查看 rev{ordinal}（只读）",
    "contribute.versionViewHeadTitle": "回到最新版本（编辑器）",
    "contribute.versionDraftChip": "未提交草稿",
    "contribute.versionDraftTitle": "编辑器里有未提交的草稿改动：点「再次检测」保存为新版本并重新检测",
    "contribute.recheckButton": "再次检测",
    "contribute.recheckTitle": "保存当前草稿为新版本并重新检测（版本条追加、报告刷新）",
    "contribute.tabReport": "检测报告",
    "contribute.tabIssues": "命中列表",
    "contribute.tabAiFix": "Agent",
    "contribute.aiFixPanelHint": "AI 改写不会直接改动你的文章：结果以修改建议（diff）并入左侧编辑器，逐处审阅后由你决定采纳或拒绝。",
    "contribute.aiFixSelectionHint": "只想改一段？在左侧编辑器选中文字，用选区菜单里的「AI 改写选区」（长文时这是唯一整段 AI 路径）。",
    "contribute.aiFixNeedEditor": "请先回到最新版编辑视图（点版本条最后一个版本），改写结果需要并入编辑器草稿",
    "contribute.agentChatTitle": "Agent",
    "contribute.agentChatHint": "检测与改写共享同一个持久化 Agent session；每次最多 64 轮、64 处修改。",
    "contribute.agentChatLoading": "正在恢复 Agent 会话…",
    "contribute.agentChatYou": "你",
    "contribute.agentChatEdit": "已完成一处修改",
    "contribute.agentChatReport": "分析报告",
    "contribute.agentChatSelection": "引用选区",
    "contribute.agentChatPlaceholder": "告诉 Agent 你想怎样优化当前草稿…",
    "contribute.agentChatRunning": "Agent 运行中，完成或取消前不能发送新消息。",
    "contribute.agentChatShortcut": "Ctrl / ⌘ + Enter 发送",
    "contribute.agentChatSend": "发送",
    "contribute.agentThinking": "思考过程",
    "contribute.agentConnectionConnected": "实时连接正常",
    "contribute.agentConnectionConnecting": "正在连接",
    "contribute.agentConnectionReconnecting": "正在重连",
    "contribute.agentConnectionRecovering": "正在恢复会话",
    "contribute.agentConnectionDisconnected": "实时连接已断开",
    "contribute.agentPhasePending": "等待模型响应",
    "contribute.agentPhaseStreaming": "Agent 正在输出",
    "contribute.agentPhaseTool": "正在执行工具",
    "contribute.agentPhaseFinishing": "正在整理下一步",
    "contribute.reportSummaryTitle": "一句话摘要",
    "contribute.summaryHitsLine": "规则引擎共找到 {total} 处疑似 AI 味表达（高危 {high} · 中危 {medium} · 低危 {low}）。",
    "contribute.summaryStrongLine": "其中 {count} 处命中「强判别」规则——评测中被证实最能区分 AI 与人类文本的规则。",
    "contribute.summaryAutoLine": "{count} 处可以一键自动替换（去命中列表按规则批量应用）。",
    "contribute.summaryHiddenLine": "另有 {count} 处命中来自你隐藏的规则：编辑器和命中列表已不显示它们，但报告统计保持全量口径。",
    "contribute.processExplain": "三路信号独立采集：规则引擎（上传即算）、外部神经检测器（异步，约几十秒）、LLM 评审；综合分由前两路加权合成，仅作引导。",
    "contribute.docScoreExplain": "每千字有多少处疑似 AI 痕迹（去重后），越低越干净；只统计规则命中，不等于「是 AI 的概率」。",
    "contribute.detectExplain": "P(AI) 是外部神经检测器判定整篇为 AI 生成的概率；色条是分块概率分布（绿=像人写，红=像 AI）。",
    "contribute.compareExplain": "与最初上传的原文对比，看这轮修改在机器口径上是否真的有效。",
    "contribute.viewingTitle": "rev{ordinal} 正文（只读，选中片段可标注）",
    "contribute.draftKeptNotice": "编辑草稿已保留：回到 rev{ordinal}（最新）可继续编辑",
    "contribute.headAnnotateButton": "只读标注",
    "contribute.headAnnotateTitle": "切到当前版只读正文：选中片段可保存标注（挂当前版本；编辑草稿保留，随时返回）",
    "contribute.backToEditButton": "返回编辑",
    "contribute.finishLlmFixRunning": "AI 改写进行中：请等它完成或先取消，再完成本篇",
    "contribute.summaryTitle": "本篇贡献完成",
    "contribute.summaryThanks": "感谢贡献！这篇的评分、标注与修订链已计入研究数据集。",
    "contribute.summaryScoresTitle": "盲评 vs 终评",
    "contribute.summaryBlindCol": "盲评",
    "contribute.summaryFinalCol": "终评",
    "contribute.summaryAiFlavorRow": "AI 味",
    "contribute.summaryWantReadOnRow": "想追更",
    "contribute.summarySkippedBlind": "已跳过",
    "contribute.summaryNotRescored": "未复评",
    "contribute.summaryD5Row": "D5 结论",
    "contribute.summaryVerdictNone": "未提交复评（本篇不计 D5 结论）",
    "contribute.summaryAnnotationsRow": "标注",
    "contribute.summaryAnnotationsValue": "{count} 条",
    "contribute.restartButton": "再传一篇",
    "contribute.finishButton": "完成本篇",
    "contribute.viewDataset": "查看数据集",
    "contribute.editHits": "改后命中 {count}",
    "contribute.baseHits": "原文 {count}",
    "contribute.hitsDown": "↓ 降低",
    "contribute.hitsNotDown": "未降低",
    "contribute.committing": "提交中…",
    "contribute.commitFailed": "提交修订失败",
    "contribute.strongFixScope": "只处理无需语境判断的机械规则；候选替换保留给你或 AI 逐条决定",
    "contribute.staticFixButton": "机械修复（{count}）",
    "contribute.staticFixTitle": "应用全部确定性机械修复（逐条可撤销）",
    "contribute.oneClickFixButton": "一键修到底",
    "contribute.oneClickFixTitle": "先应用确定性机械修复，再把候选问题交给 LLM 整篇逐处改写——结果并入编辑器后逐处审阅",
    "contribute.strongFixDegraded": "只处理无需语境判断的机械规则；候选替换不会批量应用",
    "contribute.blindCardTitle": "盲评：先凭直觉打分，再揭示机器结果",
    "contribute.scoreCardTitle": "AI 味指数（AI-flavor index）",
    "contribute.scoreRefNote": "综合参考分，仅作引导；分项指标见下方展开。",
    "contribute.scoreDegradedNote": "降级口径：外部检测器无数据，本分数仅由规则命中密度计算。",
    "contribute.scoreDetecting": "检测中…",
    "contribute.scoreDetectingNote": "规则引擎扫描完成后即可出分；外部检测器结果到达后会并入综合分。",
    "contribute.scoreGradeHeavy": "AI 味很重",
    "contribute.scoreGradeObvious": "AI 味明显",
    "contribute.scoreGradeLight": "AI 味轻微",
    "contribute.scoreGradeHuman": "接近人写",
    "contribute.llmReviewCardTitle": "LLM 评审（LLM review）",
    "contribute.llmReviewWaitingNote": "等待接入 / 本版暂无 LLM 评审结果。",
    "contribute.llmReviewModelLine": "模型 {model} · 指出 {count} 处",
    "contribute.llmReviewNoHits": "LLM 评审未发现问题。",
    "contribute.processTitle": "检测进程",
    "contribute.processEngine": "规则引擎（llmlint）",
    "contribute.processEngineDone": "已完成：{count} 处命中 · 引擎 {engine}",
    "contribute.processDetector": "外部检测器（AIGC detector）",
    "contribute.processDetectorDone": "已完成",
    "contribute.processLlmJudge": "LLM 评审（LLM review）",
    "contribute.processLlmJudgeNote": "评审中（异步约 1–2 分钟；通道未配置时不会有结果）",
    "contribute.channelWaiting": "等待运行",
    "contribute.channelRunning": "运行中",
    "contribute.channelCompleted": "已完成",
    "contribute.channelFailed": "运行失败",
    "contribute.channelCancelled": "已取消",
    "contribute.channelInterrupted": "服务重启中断",
    "contribute.channelUnavailable": "不可用",
    "contribute.llmConfidence": "置信度 {percent}%",
    "contribute.compositeSecondary": "综合参考分",
    "contribute.compositeComplete": "三路完整结果 · 规则 30% / 外部 45% / LLM 25%",
    "contribute.compositePartial": "部分结果 · 已完成通道重新归一权重",
    "contribute.llmEvidenceTitle": "关键证据",
    "contribute.llmSuggestionsTitle": "改进建议",
    "contribute.llmHitsDetail": "展开 LLM 规则命中（{count}）",
    "contribute.riskDirectionNote": "以下数字是 AI 痕迹风险，不是稿件质量分：越高表示越可疑、越需要检查。",
    "contribute.riskIndex": "AI 痕迹风险",
    "contribute.riskLow": "低风险",
    "contribute.riskModerate": "中等风险",
    "contribute.riskElevated": "较高风险",
    "contribute.riskHigh": "高风险",
    "contribute.compositeRisk": "综合 AI 痕迹风险",
    "contribute.rerunReview": "重新评审",
    "contribute.metricsTitle": "详细数据（第 {ordinal} 版）",
    "contribute.metricsNote": "以下为各分项原始口径，综合分仅作参考",
    "contribute.compareWithRev0": "第 {ordinal} 版 vs 原文",
    "contribute.actionGroupTitle": "和原文比怎么样",
    "contribute.verdictHitsRow": "疑似痕迹数",
    "contribute.verdictCompareValue": "原文 {before} → 改后 {after}",
    "contribute.docScoreRow": "每千字命中",
    "contribute.detectPAi": "AI 概率（P(AI)）{percent}% · {name}",
    "contribute.detectPending": "外部检测器检测中…（HF 免费实例较慢，约 0.5–2 分钟）",
    "contribute.detectUnavailable": "外部检测器暂不可用（本篇无检测数据）",
    "contribute.detectCompareRow": "AI 概率（P(AI)）",
    "contribute.detectCompareValue": "原文 {before}% → 改后 {after}%",
    "contribute.detectDown": "↓ 下降",
    "contribute.detectNotDown": "未下降",
    "contribute.detectComparePending": "外部检测器 P(AI) 对比：检测中…（两端到齐后自动并入 D5）",
    "contribute.detectCompareUnavailable": "外部检测器 P(AI) 对比：数据缺失（D5 机器腿按命中数降级判定）",
    "contribute.llmFixButton": "AI 改写",
    "contribute.llmFixRunning": "AI 改写中…（约 1–3 分钟，可继续编辑）",
    "contribute.llmFixTitle": "基于当前草稿做一轮 LLM 润色（携带命中清单与你的标注），结果以逐处修改并入编辑器供审阅",
    "contribute.llmFixDiffTitle": "AI 改写",
    "contribute.llmFixNoChanges": "AI 返回结果与当前草稿一致，没有需要并入的修改",
    "contribute.llmFixStaleTitle": "草稿在 AI 改写期间有修改",
    "contribute.llmFixStaleBody": "这份 AI 改写基于发起时的草稿。「应用」会先把草稿回到发起时的状态（期间的修改会被放弃），再逐处并入 AI 修改；「丢弃」保留你当前的草稿，AI 结果作废。",
    "contribute.llmFixStaleApply": "应用（放弃期间修改）",
    "contribute.llmFixStaleDiscard": "丢弃 AI 结果",
    "contribute.llmFixDiscarded": "已丢弃本次 AI 改写结果",
    "contribute.llmFixFailed": "AI 改写失败：{reason}",
    "contribute.llmFixFailedPlain": "AI 改写失败",
    "contribute.llmFixTimeout": "AI 改写超时（任务可能仍在后台执行），请稍后重试",
    "contribute.llmFixUnavailableNote": "AI 改写不可用：{reason}",
    "contribute.llmFixBusy": "已有一个 AI 改写任务进行中，请等它完成再发起",
    "contribute.llmFixCancel": "取消改写",
    "contribute.llmFixCancelTitle": "停止等待本次 AI 改写：后台任务会继续跑完但结果不再采用，可立即重新发起",
    "contribute.llmFixCancelled": "已取消 AI 改写等待，后台任务结果将被忽略",
    "contribute.llmFixRetry": "重试",
    "contribute.llmFixTooLong": "正文较长（超过 {max} 可见字），整篇改写会被截断——请选中片段用「AI 改写选区」",
    "contribute.llmFixSelectionDiffTitle": "AI 改写选区",
    "contribute.llmFixSelectionStale": "选区内容已变化，无法在当前草稿中唯一定位，AI 改写结果未并入",
    "contribute.llmReviewTitle": "AI 改写完成：共 {count} 处修改",
    "contribute.llmReviewVisited": "已巡检 {visited}/{total}",
    "contribute.llmReviewPrevious": "上一处",
    "contribute.llmReviewNext": "下一处",
    "contribute.llmReviewReject": "拒绝该处",
    "contribute.postJudgmentTitle": "对改后版本 rev{ordinal} 再打一次分（非盲）",
    "contribute.postJudgmentHint": "AI 味作采集数据留存；验收看「外部检测概率↓（缺数据时降级为命中↓）且 想追更不降」。",
    "contribute.postAiFlavorLabel": "AI 味 {score}",
    "contribute.postWantReadOnLabel": "想追更 {score}",
    "contribute.blindBaselineRef": "（初读时 {score}）",
    "contribute.noBlindBaseline": "（无初读打分）",
    "contribute.improvementLabel": "这轮改得好不好 {score}",
    "contribute.improvementLow": "0 更差了",
    "contribute.improvementHigh": "5 明显更好",
    "contribute.commentLabel": "文字反馈（可选）",
    "contribute.commentPlaceholder": "这轮改动整体感觉如何？哪里改好了、哪里还差？",
    "contribute.submitPostJudgment": "提交复评",
    "contribute.postJudgmentSavedButton": "已提交复评",
    "contribute.postJudgmentSaved": "改后复评已保存",
    "contribute.postJudgmentFailed": "提交复评失败",
    "contribute.verdictPassTitle": "✓ 验收通过：AI 概率降了，读者缘没掉",
    "contribute.verdictPassTitleDegraded": "✓ 验收通过（检测器缺席，按痕迹数判）：痕迹少了，读者缘没掉",
    "contribute.verdictFailTitle": "△ 还差一点，可以再润色一版",
    "contribute.verdictNoBaselineTitle": "△ 没有初读打分，只能看机器信号",
    "contribute.verdictDetail": "{machine}、{want}。{scope}",
    "contribute.verdictHitsLowered": "命中降低",
    "contribute.verdictHitsNotLowered": "命中未降",
    "contribute.verdictDetectorLowered": "外部检测器 P(AI) {before}%→{after}%（下降）",
    "contribute.verdictDetectorNotLowered": "外部检测器 P(AI) {before}%→{after}%（未下降）",
    "contribute.verdictWantKept": "想追更未降",
    "contribute.verdictWantDropped": "想追更下降",
    "contribute.verdictWantNoBaseline": "想追更缺初读打分基线",
    "contribute.verdictScopeDetector": "当前口径：按外部检测概率判定（完整双条件）。",
    "contribute.verdictScopeHitsFallback": "当前口径：检测数据缺失，机器腿按命中数降级判定。",
    "contribute.continueHint": "还不满意？回到编辑器继续润色，「再次检测」开始下一轮。",
    "contribute.historyTitle": "我的检测历史",
    "contribute.historyLoading": "正在加载检测历史…",
    "contribute.historyLoadFailed": "加载检测历史失败",
    "contribute.historyEmpty": "还没有检测记录：上传一篇正文即可开始。",
    "contribute.historyOpenTitle": "打开这篇的检测工作台（恢复版本链、报告与评分）",
    "contribute.historyOpenFailed": "恢复工作台失败",
    "contribute.historyRevisionCount": "{count} 个版本",
    "contribute.historyDocScore": "docScore {score}",
    "contribute.historyNotRevealed": "未揭示",
    "contribute.historyAnonymousNote": "历史属于当前身份；关闭登录的开发模式使用稳定的本地开发身份。",
    "contribute.heatmapToggle": "热力图",
    "contribute.heatmapToggleTitle": "按外部检测器的分块 P(AI) 给正文铺梯度底色（绿→红）；开启时规则命中改为下划线标注。开关状态会记住",
    "contribute.heatmapStripTitle": "分块 P(AI) 热力缩略条（悬停色块查看该块概率）",
    "contribute.llmStreamTitle": "AI 改写进行中（逐处修改）",
    "contribute.llmStreamWaiting": "等待模型输出…",
    "contribute.llmEditsCount": "已修改 {count} 处",
    "contribute.batchApplySelected": "应用所选规则（{rules} 条规则 · {count} 处）",
    "contribute.batchApplyClear": "清除选择",
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
    "header.dataset": "Dataset",
    "header.report": "Report",
    "header.rules": "Rules",
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
    "issue.hideRuleTitle": "Hide all hits of this rule (restore on the Rules page)",
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
    "notify.ruleHidden": "Rule hidden: the editor and hits list no longer show it (restore on the Rules page)",
    "notify.optimizationPromptCopied": "Optimization prompt copied",
    "notify.optimizationPromptWithTextCopied": "Optimization prompt and text copied",
    "notify.repairDraftReset": "Repair draft reset to original",
    "notify.ruleSettingsRestored": "Default rules restored and current filters relaxed",
    "notify.selectionCopied": "Selected text copied",
    "notify.selectionFormatted": "Selection formatted",
    "notify.clipboardEmpty": "Clipboard is empty; text was not replaced",
    "notify.clipboardReadFailed": "Clipboard read failed; check clipboard permission",
    "notify.selectionReplaced": "Selection replaced from clipboard",
    "notify.selectionLlmRewritten": "AI selection rewrite merged",
    "notify.fullTextReplaced": "Full text replaced from clipboard",
    "notify.fullTextReplacedWithComments": "Full text replaced; comments were updated with the text",
    "notify.llmRewriteApplied": "AI rewrite merged: {count} edits",
    "notify.logoutFailed": "Log out failed",
    "notify.logoutOk": "Logged out",
    "ruleDetail.action": "Action",
    "ruleDetail.deleteReplacement": "(delete)",
    "ruleDetail.examples": "Examples",
    "ruleDetail.pattern": "Pattern",
    "rules.colAiRate": "AI rate",
    "rules.colEffLift": "effLift",
    "rules.colHumanRate": "Human rate",
    "rules.colRule": "Rule",
    "rules.colVerdict": "Verdict",
    "rules.colVisibility": "Visible",
    "rules.degraded": "Evaluation data missing: this build has no eval report (report.json absent). Only rule definitions are shown, without discrimination stats.",
    "rules.description": "Full catalog of built-in regex rules with eval discrimination stats, sorted by effectiveLift (discriminative power) by default.",
    "rules.effLiftHint": "effectiveLift = max(lift, prevalenceLift): verdict & sorting basis",
    "rules.hideRule": "Hide this rule (its hits stop being reported on this device)",
    "rules.llmNotScanned": "LLM rules are not part of static scanning: registry entry only, no hits or discrimination stats.",
    "rules.llmPrompt": "Detector prompt (summary)",
    "rules.meta": "{total} rules · {tested} evaluated · engine {engine}",
    "rules.noMatch": "No matching rules",
    "rules.pageInfo": "Page {page} / {pages} · {count} rules",
    "rules.pageNext": "Next",
    "rules.pagePrev": "Prev",
    "rules.profileAnti": "This rule leaned toward human text in the holdout training split and is excluded from the creative profile.",
    "rules.profileExcluded": "Excluded from profile",
    "rules.profileNoise": "This rule lacked sufficient AI discrimination in the holdout training split and is excluded from the creative profile.",
    "rules.profileOverlap": "This rule heavily overlaps {canonical}; the creative profile keeps only the canonical rule.",
    "rules.rateHint": "Median hits per 1000 chars on each side",
    "rules.sampleCounts": "Samples: human {human} · AI {ai} · min-support {minSupport}",
    "rules.searchPlaceholder": "Search rule ID / title / note…",
    "rules.showRule": "Show again (clear the hide override for this rule)",
    "rules.statFireFrac": "Doc fire fraction: human {human} · AI {ai}",
    "rules.statHits": "Hits: human {human} · AI {ai}",
    "rules.statLift": "lift (rate ratio)",
    "rules.statPairs": "Paired AI>human: {aiGreater}/{total}",
    "rules.statPrevLift": "prevLift (prevalence ratio)",
    "rules.title": "Rule catalog",
    "rules.typeLlm": "LLM rule",
    "rules.typeReplace": "Replacement template",
    "rules.typeSuggest": "Detect only",
    "rules.untestedNote": "This rule did not enter the eval report (no hits on either side or insufficient samples).",
    "rules.verdictAnti": "Anti",
    "rules.verdictInsufficient": "Insufficient",
    "rules.verdictNoise": "Noise",
    "rules.verdictStrong": "Strong",
    "rules.verdictUntested": "Untested",
    "rules.verdictWeak": "Weak",
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
    "review.commentStale": "Source edited",
    "review.commentStaleTitle": "The anchored source span has been edited in the current draft; the quote may no longer match",
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
    "review.llmRewriteSelection": "AI rewrite selection",
    "review.llmRewriteSelectionTitle": "Rewrite the selected fragment with the built-in AI channel (context and related comments included; merged as an undoable edit)",
    "review.annotateSelection": "Save annotation",
    "review.annotateSelectionTitle": "Save the selected span as a dataset annotation (anchored to the current version body)",
    "review.annotationNotePlaceholder": "Where does it read poorly, or why does it feel AI-generated?",
    "contribute.annotationSpanEdited": "This span has been edited; mapping back to the original is unreliable. Please annotate an unmodified span.",
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
    "review.proofreadApplyHint": "click for rule menu & apply",
    "review.proofreadOffTitle": "Proofread marks off: turn on to show inline strikethrough and suggested text for auto-fixable hits; click a mark to open its rule menu and apply",
    "review.proofreadOnTitle": "Proofread marks on: auto-fixable hits show inline strikethrough and suggested text; click a mark to open its rule menu and apply, click here to turn off",
    "review.ruleMenuHide": "Hide this rule",
    "review.ruleHiddenNotice": "Rule \"{title}\" hidden; future scans will skip it",
    "review.draftDiffOnTitle": "Draft changes shown: uncommitted edits vs. the base text are marked inline; click to hide",
    "review.draftDiffOffTitle": "Draft changes hidden: turn on to mark uncommitted edits vs. the base text inline",
    "review.editorHeatmapOnTitle": "Editor heatmap on: chunks are tinted by detector P(AI) (values anchor the last detection and go stale as you edit); click to turn off",
    "review.editorHeatmapOffTitle": "Editor heatmap off: turn on to tint chunks by detector P(AI)",
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
    "header.contribute": "Detect",
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
    "contribute.title": "Scan a Text",
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
    "contribute.selectedSpan": "Selected: {text}",
    "contribute.annotationPlaceholder": "Where does it read poorly, or why does it feel AI-generated?",
    "contribute.cancel": "Cancel",
    "contribute.saveAnnotation": "Save Annotation",
    "contribute.blindReviewSavedTitle": "First-read rating:",
    "contribute.aiFlavorScore": "AI Flavor {score}/5",
    "contribute.wantReadOnScore": "Want to keep reading {score}/5",
    "contribute.hitSummary": "{total} issues: high {high} / medium {medium} / low {low}",
    "contribute.genreLabel": "Genre (optional)",
    "contribute.textTypeLabel": "Text type (optional)",
    "contribute.sourceNoteLabel": "Work title (optional)",
    "contribute.sourceNotePlaceholder": "Work title or source, optional",
    "contribute.notProvided": "Not specified",
    "contribute.blindHint": "Scoring is optional: scores given now count as blind (before machine results are revealed); skipping leaves this text without a blind baseline, so the human leg of the verdict cannot be judged.",
    "contribute.skipBlindReview": "Skip scoring, view report",
    "contribute.consentRequired": "Please confirm the consent statement first",
    "contribute.uploadRevealed": "Uploaded. Scan report revealed (blind review skipped).",
    "contribute.blindSkippedTitle": "No first-read rating for this piece (no before/after baseline)",
    "contribute.uploadButton": "Upload & open workbench",
    "contribute.flowStage1": "Upload",
    "contribute.flowStage2": "Workbench",
    "contribute.flowStage3": "Done",
    "contribute.flowStageLockWorkspace": "Enter the detection workbench after uploading your text",
    "contribute.flowStageLockDone": "Click \"Finish this piece\" in the report tab of the workbench",
    "contribute.guideDraft": "Paste your text, optionally fill in the self-declared fields, then upload to enter the detection workbench — you'll be asked for a blind score (skippable) before the report is revealed.",
    "contribute.guideBlind": "Score \"AI flavor\" and \"want to read on\" on first impression — scoring before the reveal keeps your gut feel unbiased (you can also skip). Submit to reveal the detection report.",
    "contribute.guideWorkspace": "Edit on the left: one-click cleanup → handle hits one by one → manual edits, all undoable; the right side has three tabs — report / hits / AI rewrite (results merge into the editor as reviewable diffs). Click \"Re-check\" to save a new version and re-run detection.",
    "contribute.guideViewing": "Viewing a past version (read-only): the right side shows its report; select spans in the text to annotate — the AI rewrite takes your annotations into account. Click the latest chip in the version bar to return to the editor.",
    "contribute.guideCollapse": "Collapse guide",
    "contribute.guideExpand": "Expand guide",
    "contribute.guideLabel": "Flow guide",
    "contribute.lineageLabel": "Revision chain",
    "contribute.lineageKindUpload": "original",
    "contribute.lineageKindStatic": "static fix",
    "contribute.lineageKindLlm": "AI rewrite",
    "contribute.lineageKindUser": "manual fix",
    "contribute.lineageCurrentTitle": "Current head",
    "contribute.versionViewTitle": "View rev{ordinal} (read-only)",
    "contribute.versionViewHeadTitle": "Back to the latest version (editor)",
    "contribute.versionDraftChip": "unsaved draft",
    "contribute.versionDraftTitle": "The editor has uncommitted draft changes: click \"Re-check\" to save them as a new version and re-run detection",
    "contribute.recheckButton": "Re-check",
    "contribute.recheckTitle": "Save the current draft as a new version and re-run detection (appends to the version bar, refreshes the report)",
    "contribute.tabReport": "Report",
    "contribute.tabIssues": "Hits",
    "contribute.tabAiFix": "Agent",
    "contribute.aiFixPanelHint": "AI rewrite never edits your text directly: the result lands in the left editor as suggested diffs, and you review each one before it counts.",
    "contribute.aiFixSelectionHint": "Only want one passage changed? Select text in the editor and use \"AI rewrite selection\" in the selection menu (for long texts this is the only whole-passage AI path).",
    "contribute.aiFixNeedEditor": "Return to the latest-version edit view first (click the last chip on the version bar) — rewrite results merge into the editor draft",
    "contribute.agentChatTitle": "Agent",
    "contribute.agentChatHint": "Analysis and rewriting share one persistent Agent session; each invocation allows up to 64 turns and 64 edits.",
    "contribute.agentChatLoading": "Restoring Agent session…",
    "contribute.agentChatYou": "You",
    "contribute.agentChatEdit": "One edit completed",
    "contribute.agentChatReport": "Analysis report",
    "contribute.agentChatSelection": "Quoted selection",
    "contribute.agentChatPlaceholder": "Tell the Agent how to improve the current draft…",
    "contribute.agentChatRunning": "The Agent is running. New messages are disabled until it finishes or is cancelled.",
    "contribute.agentChatShortcut": "Ctrl / ⌘ + Enter to send",
    "contribute.agentChatSend": "Send",
    "contribute.agentThinking": "Thinking",
    "contribute.agentConnectionConnected": "Live connection active",
    "contribute.agentConnectionConnecting": "Connecting",
    "contribute.agentConnectionReconnecting": "Reconnecting",
    "contribute.agentConnectionRecovering": "Recovering session",
    "contribute.agentConnectionDisconnected": "Live connection disconnected",
    "contribute.agentPhasePending": "Waiting for model",
    "contribute.agentPhaseStreaming": "Agent is responding",
    "contribute.agentPhaseTool": "Running tool",
    "contribute.agentPhaseFinishing": "Preparing next step",
    "contribute.reportSummaryTitle": "Plain-language summary",
    "contribute.summaryHitsLine": "The rule engine found {total} AI-flavored expressions ({high} high · {medium} medium · {low} low).",
    "contribute.summaryStrongLine": "{count} of them hit \"strong\" rules — the ones proven in evals to best separate AI from human text.",
    "contribute.summaryAutoLine": "{count} can be fixed with one click (batch-apply by rule in the hits tab).",
    "contribute.summaryHiddenLine": "{count} more hits come from rules you hid: the editor and hits list no longer show them, but report totals stay complete.",
    "contribute.processExplain": "Three signals collected independently: rule engine (instant), external neural detector (async, ~tens of seconds), LLM review; the composite score blends the first two and is advisory only.",
    "contribute.docScoreExplain": "Suspected AI traces per 1,000 chars (deduplicated) — lower is cleaner. Rule hits only, not the probability of AI.",
    "contribute.detectExplain": "P(AI) is an external neural detector's probability that the whole text is AI-generated; the strip shows per-chunk probability (green = human-like, red = AI-like).",
    "contribute.compareExplain": "Compared against the originally uploaded text: did this round of edits actually help by machine measures?",
    "contribute.viewingTitle": "rev{ordinal} text (read-only; select a span to annotate)",
    "contribute.draftKeptNotice": "Your draft is kept: return to rev{ordinal} (latest) to keep editing",
    "contribute.headAnnotateButton": "Annotate (read-only)",
    "contribute.headAnnotateTitle": "Switch to a read-only view of the current version: select a span to save an annotation (anchored to this version; your draft is kept, return anytime)",
    "contribute.backToEditButton": "Back to editing",
    "contribute.finishLlmFixRunning": "AI rewrite in progress: wait for it to finish or cancel it before finishing this piece",
    "contribute.summaryTitle": "Contribution completed",
    "contribute.summaryThanks": "Thank you! The scores, annotations and revision chain of this piece are now part of the research dataset.",
    "contribute.summaryScoresTitle": "Blind vs final scores",
    "contribute.summaryBlindCol": "Blind",
    "contribute.summaryFinalCol": "Final",
    "contribute.summaryAiFlavorRow": "AI flavor",
    "contribute.summaryWantReadOnRow": "Want to read on",
    "contribute.summarySkippedBlind": "skipped",
    "contribute.summaryNotRescored": "not re-scored",
    "contribute.summaryD5Row": "D5 verdict",
    "contribute.summaryVerdictNone": "Re-score not submitted (no D5 verdict for this piece)",
    "contribute.summaryAnnotationsRow": "Annotations",
    "contribute.summaryAnnotationsValue": "{count}",
    "contribute.restartButton": "Contribute another",
    "contribute.finishButton": "Finish this piece",
    "contribute.viewDataset": "View dataset",
    "contribute.editHits": "Draft hits {count}",
    "contribute.baseHits": "Original {count}",
    "contribute.hitsDown": "↓ down",
    "contribute.hitsNotDown": "not down",
    "contribute.committing": "Submitting…",
    "contribute.commitFailed": "Failed to submit revision",
    "contribute.strongFixScope": "Only applies context-free mechanical fixes; candidate replacements remain for you or the AI to review",
    "contribute.staticFixButton": "Quick fix ({count})",
    "contribute.staticFixTitle": "Apply all deterministic mechanical fixes (each undoable)",
    "contribute.oneClickFixButton": "Fix everything",
    "contribute.oneClickFixTitle": "Apply deterministic mechanical fixes, then let the LLM handle contextual candidates edit by edit for review",
    "contribute.strongFixDegraded": "Only context-free mechanical rules are applied; candidate replacements are never batched",
    "contribute.blindCardTitle": "Blind review: score by first impression before the reveal",
    "contribute.scoreCardTitle": "AI-flavor index",
    "contribute.scoreRefNote": "Advisory composite score; see the breakdown metrics below.",
    "contribute.scoreDegradedNote": "Degraded basis: no external detector data — this score is computed from rule-hit density only.",
    "contribute.scoreDetecting": "Detecting…",
    "contribute.scoreDetectingNote": "The score appears once the rule-engine scan lands; external detector results merge in when they arrive.",
    "contribute.scoreGradeHeavy": "Heavily AI-flavored",
    "contribute.scoreGradeObvious": "Clearly AI-flavored",
    "contribute.scoreGradeLight": "Slightly AI-flavored",
    "contribute.scoreGradeHuman": "Reads human",
    "contribute.llmReviewCardTitle": "LLM review",
    "contribute.llmReviewWaitingNote": "Waiting to be wired / no LLM review for this revision yet.",
    "contribute.llmReviewModelLine": "Model {model} · {count} findings",
    "contribute.llmReviewNoHits": "LLM review found no issues.",
    "contribute.processTitle": "Detection progress",
    "contribute.processEngine": "Rule engine (llmlint)",
    "contribute.processEngineDone": "done: {count} hits · engine {engine}",
    "contribute.processDetector": "External AIGC detector",
    "contribute.processDetectorDone": "done",
    "contribute.processLlmJudge": "LLM review",
    "contribute.processLlmJudgeNote": "reviewing (async, ~1–2 min; no result if the channel is not configured)",
    "contribute.channelWaiting": "Waiting",
    "contribute.channelRunning": "Running",
    "contribute.channelCompleted": "Completed",
    "contribute.channelFailed": "Failed",
    "contribute.channelCancelled": "Cancelled",
    "contribute.channelInterrupted": "Interrupted by restart",
    "contribute.channelUnavailable": "Unavailable",
    "contribute.llmConfidence": "Confidence {percent}%",
    "contribute.compositeSecondary": "Composite reference score",
    "contribute.compositeComplete": "Complete · Rules 30% / external 45% / LLM 25%",
    "contribute.compositePartial": "Partial · completed channels are reweighted",
    "contribute.llmEvidenceTitle": "Key evidence",
    "contribute.llmSuggestionsTitle": "Suggestions",
    "contribute.llmHitsDetail": "Expand LLM rule hits ({count})",
    "contribute.riskDirectionNote": "These numbers are AI-trace risk indicators, not writing-quality scores. Higher means more suspicious and worth reviewing.",
    "contribute.riskIndex": "AI-trace risk",
    "contribute.riskLow": "Low risk",
    "contribute.riskModerate": "Moderate risk",
    "contribute.riskElevated": "Elevated risk",
    "contribute.riskHigh": "High risk",
    "contribute.compositeRisk": "Composite AI-trace risk",
    "contribute.rerunReview": "Run review again",
    "contribute.metricsTitle": "Details (version {ordinal})",
    "contribute.metricsNote": "raw per-signal figures below; the composite score is advisory only",
    "contribute.compareWithRev0": "Version {ordinal} vs original",
    "contribute.actionGroupTitle": "How it compares to the original",
    "contribute.verdictHitsRow": "Suspected traces",
    "contribute.verdictCompareValue": "Original {before} → revised {after}",
    "contribute.docScoreRow": "Hits per 1,000 chars",
    "contribute.detectPAi": "AI probability (P(AI)) {percent}% · {name}",
    "contribute.detectPending": "External detector running… (free HF instance, roughly 0.5–2 min)",
    "contribute.detectUnavailable": "External detector unavailable (no detection data for this text)",
    "contribute.detectCompareRow": "AI probability (P(AI))",
    "contribute.detectCompareValue": "Original {before}% → revised {after}%",
    "contribute.detectDown": "↓ down",
    "contribute.detectNotDown": "not down",
    "contribute.detectComparePending": "External detector P(AI) comparison: running… (joins D5 once both ends land)",
    "contribute.detectCompareUnavailable": "External detector P(AI) comparison: data missing (D5 machine leg degrades to hit count)",
    "contribute.llmFixButton": "AI rewrite",
    "contribute.llmFixRunning": "AI rewriting… (about 1–3 min, you can keep editing)",
    "contribute.llmFixTitle": "Run one LLM polishing pass on the current draft (with the issue list and your annotations); the result lands in the editor as per-edit diffs for review",
    "contribute.llmFixDiffTitle": "AI rewrite",
    "contribute.llmFixNoChanges": "The AI result is identical to the current draft; nothing to merge",
    "contribute.llmFixStaleTitle": "Draft changed while the AI was rewriting",
    "contribute.llmFixStaleBody": "This AI rewrite is based on the draft at launch time. \"Apply\" first restores the draft to that state (edits made in the meantime are discarded), then merges the AI edits one by one; \"Discard\" keeps your current draft and drops the AI result.",
    "contribute.llmFixStaleApply": "Apply (discard interim edits)",
    "contribute.llmFixStaleDiscard": "Discard AI result",
    "contribute.llmFixDiscarded": "AI rewrite result discarded",
    "contribute.llmFixFailed": "AI rewrite failed: {reason}",
    "contribute.llmFixFailedPlain": "AI rewrite failed",
    "contribute.llmFixTimeout": "AI rewrite timed out (the job may still finish in the background), try again later",
    "contribute.llmFixUnavailableNote": "AI rewrite unavailable: {reason}",
    "contribute.llmFixBusy": "An AI rewrite job is already running; wait for it to finish first",
    "contribute.llmFixCancel": "Cancel rewrite",
    "contribute.llmFixCancelTitle": "Stop waiting for this AI rewrite: the background job still finishes but its result is ignored; you can start a new one right away",
    "contribute.llmFixCancelled": "AI rewrite wait cancelled; the background job result will be ignored",
    "contribute.llmFixRetry": "Retry",
    "contribute.llmFixTooLong": "Text is long (over {max} visible chars); a full rewrite would be truncated — select a fragment and use \"AI rewrite selection\"",
    "contribute.llmFixSelectionDiffTitle": "AI selection rewrite",
    "contribute.llmFixSelectionStale": "The selected text changed and can no longer be uniquely located in the draft; the AI rewrite was not merged",
    "contribute.llmReviewTitle": "AI rewrite ready: {count} edits",
    "contribute.llmReviewVisited": "Reviewed {visited}/{total}",
    "contribute.llmReviewPrevious": "Previous",
    "contribute.llmReviewNext": "Next",
    "contribute.llmReviewReject": "Reject this edit",
    "contribute.postJudgmentTitle": "Re-score the revised rev{ordinal} (non-blind)",
    "contribute.postJudgmentHint": "AI-flavor is kept as research data; the verdict checks \"external detector probability down (falls back to hits down when data is missing) AND want-read-on not lower\".",
    "contribute.postAiFlavorLabel": "AI flavor {score}",
    "contribute.postWantReadOnLabel": "Want to read on {score}",
    "contribute.blindBaselineRef": "(first read: {score})",
    "contribute.noBlindBaseline": "(no first-read rating)",
    "contribute.improvementLabel": "How good is this round of edits {score}",
    "contribute.improvementLow": "0 worse",
    "contribute.improvementHigh": "5 much better",
    "contribute.commentLabel": "Written feedback (optional)",
    "contribute.commentPlaceholder": "How does this round feel overall? What improved, what still falls short?",
    "contribute.submitPostJudgment": "Submit re-score",
    "contribute.postJudgmentSavedButton": "Re-score submitted",
    "contribute.postJudgmentSaved": "Post-edit re-score saved",
    "contribute.postJudgmentFailed": "Failed to submit re-score",
    "contribute.verdictPassTitle": "✓ Accepted: AI probability down, readability kept",
    "contribute.verdictPassTitleDegraded": "✓ Accepted (detector unavailable, judged by trace count): fewer traces, readability kept",
    "contribute.verdictFailTitle": "△ Not quite there — worth another pass",
    "contribute.verdictNoBaselineTitle": "△ No first-read rating — machine signals only",
    "contribute.verdictDetail": "{machine}; {want}. {scope}",
    "contribute.verdictHitsLowered": "hits down",
    "contribute.verdictHitsNotLowered": "hits not down",
    "contribute.verdictDetectorLowered": "external detector P(AI) {before}%→{after}% (down)",
    "contribute.verdictDetectorNotLowered": "external detector P(AI) {before}%→{after}% (not down)",
    "contribute.verdictWantKept": "want-read-on kept",
    "contribute.verdictWantDropped": "want-read-on dropped",
    "contribute.verdictWantNoBaseline": "want-read-on lacks a first-read baseline",
    "contribute.verdictScopeDetector": "Current scope: judged by external detector probability (full dual condition).",
    "contribute.verdictScopeHitsFallback": "Current scope: detection data missing, the machine leg degrades to hit count.",
    "contribute.continueHint": "Not satisfied? Keep polishing in the editor and hit \"Re-check\" for another round.",
    "common.retry": "Retry",
    "issue.applyGroup": "Apply all ({count})",
    "issue.applyGroupTitle": "Apply every auto-replaceable hit of this rule (merged back-to-front, one undoable notification)",
    "issue.batchSelectTitle": "Select this rule for the \"Apply selected rules\" batch above",
    "notify.batchReplacementDone": "Applied {count} replacements in batch",
    "contribute.historyTitle": "My detection history",
    "contribute.historyLoading": "Loading detection history…",
    "contribute.historyLoadFailed": "Failed to load detection history",
    "contribute.historyEmpty": "No detections yet — upload a text to get started.",
    "contribute.historyOpenTitle": "Open the workbench for this text (restores revisions, reports and scores)",
    "contribute.historyOpenFailed": "Failed to restore the workbench",
    "contribute.historyRevisionCount": "{count} revisions",
    "contribute.historyDocScore": "docScore {score}",
    "contribute.historyNotRevealed": "not revealed",
    "contribute.historyAnonymousNote": "History belongs to the current identity; auth-disabled development mode uses a stable local development identity.",
    "contribute.heatmapToggle": "Heatmap",
    "contribute.heatmapToggleTitle": "Shade the text by per-chunk detector P(AI) (green→red); rule hits switch to underlines while on. The toggle is remembered",
    "contribute.heatmapStripTitle": "Per-chunk P(AI) heat strip (hover a block for its probability)",
    "contribute.llmStreamTitle": "AI rewrite in progress (edit by edit)",
    "contribute.llmStreamWaiting": "Waiting for model output…",
    "contribute.llmEditsCount": "{count} edits applied",
    "contribute.batchApplySelected": "Apply selected rules ({rules} rules · {count} hits)",
    "contribute.batchApplyClear": "Clear selection",
};

export const messages: Record<SupportedLocale, Record<MessageKey, string>> = {
    "zh-CN": zhCN,
    "en-US": enUS,
};

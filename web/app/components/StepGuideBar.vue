<script setup lang="ts">
// 每屏引导条（Task 13 W8 G2 → Task 15 P0-A 工作台语境改写）：阶段指示下一行的紧凑引导文案
// （做什么 + 为什么 + 下一步预告）。五步方法论的叙事层落在这里（采集点全部保留在工作台内）。
// W8 拍板：常显一行 + 可折叠且 localStorage 记住偏好——折叠记忆内聚在本组件内，
// 是纯展示组件纪律的唯一例外（它是用户偏好，不是流程状态）。
import {ref} from "vue";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

const props = defineProps<{
    /** 当前引导语境（done 完成态不渲染引导条，由宿主 v-if 守卫）：
     *  draft=上传屏；blind=工作台未揭示（盲评阶段）；workspace=head 编辑视图；viewing=查看历史版本（只读）。 */
    screen: "draft" | "blind" | "workspace" | "viewing";
}>();

const {t} = useLlmlintI18n();

// 折叠偏好持久化 key（web 是 ssr:false，仍守 import.meta.client，与 useWebSettings 同款防御）。
const GUIDE_COLLAPSED_KEY = "llmlint.contribute.guideCollapsed";

/** 读折叠偏好；无记录默认**折叠**（Task 19：引导文案是一次性信息，默认不占宽度）；localStorage 不可用（隐私模式等）同折叠。 */
function readCollapsed(): boolean {
    if (!import.meta.client) {
        return true;
    }
    try {
        return window.localStorage.getItem(GUIDE_COLLAPSED_KEY) !== "0";
    } catch {
        return true;
    }
}

const collapsed = ref(readCollapsed());

/** 切换折叠并持久化偏好；写失败只影响持久化，本次会话内仍生效。 */
function toggleCollapsed(): void {
    collapsed.value = !collapsed.value;
    if (import.meta.client) {
        try {
            window.localStorage.setItem(GUIDE_COLLAPSED_KEY, collapsed.value ? "1" : "0");
        } catch {
            // 忽略：偏好写入失败不阻塞交互
        }
    }
}

// 语境 → 引导文案 key（四套文案见 messages.ts，zh/en 两套）。
const guideKeys = {
    draft: "contribute.guideDraft",
    blind: "contribute.guideBlind",
    workspace: "contribute.guideWorkspace",
    viewing: "contribute.guideViewing",
} as const;
</script>

<template>
    <!-- 引导条（Task 19 C：不再独占一行，由宿主内联进顶栏行）：
         展开 = 罗盘 + 当前屏完整引导句 + 收起按钮；折叠 = 只剩一个罗盘按钮（title 带引导句） -->
    <div class="flex min-w-0 items-center gap-2 text-xs">
        <template v-if="!collapsed">
            <span class="i-lucide-compass h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]" />
            <span class="min-w-0 flex-1 truncate text-[var(--text-muted)]" :title="t(guideKeys[props.screen])">{{ t(guideKeys[props.screen]) }}</span>
            <button type="button" class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-[var(--bg-hover)]" :title="t('contribute.guideCollapse')" :aria-label="t('contribute.guideCollapse')" @click="toggleCollapsed">
                <span class="i-lucide-chevron-up h-3.5 w-3.5 text-[var(--text-muted)]" />
            </button>
        </template>
        <button v-else type="button" class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-[var(--bg-hover)]" :title="`${t('contribute.guideLabel')}：${t(guideKeys[props.screen])}`" :aria-label="t('contribute.guideExpand')" @click="toggleCollapsed">
            <span class="i-lucide-compass h-3.5 w-3.5 text-[var(--accent-main)]" />
        </button>
    </div>
</template>

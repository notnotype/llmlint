import {computed, ref} from "vue";
import {
    createPlan,
    foldDraft,
    deriveDiffs,
    applyDraftSplice,
    applySourceEdit,
    removeEdit,
    clearEdits,
    locateMinimalSplice,
    type RepairDiff,
    type RepairEditKind,
    type RepairPlan,
} from "../utils/repair-draft";

/**
 * 修复草稿组合式：分层派生编辑模型的 Vue 状态所有者（唯一 mutable 状态 = plan）。
 * `draft` / `diffs` 全部派生；命令式 diffs 数组 + transform* 位置搬运机制被彻底取代。
 *
 * source（原文）不可变；一切编辑（自由打字 / LLM 改写 / 接受命中替换）都折算成
 * 锚定原文坐标的编辑并入 plan，草稿与差异靠 fold 现算，无需任何位置搬运。
 *
 * 自由打字**合并成一条编辑**（burst）：连续输入复用同一 base plan + 同一 edit id 重算，
 * 失焦（`sealDraft`）或任何结构化操作时封口，下一段输入才起新编辑——避免「每键一版」。
 */
export function useRepairDraft(initialSource: string) {
    const plan = ref<RepairPlan>(createPlan(initialSource));
    let sequence = 0;
    // session 内自增 id：不用 Date.now/Math.random，保持决定性、便于快照与重放。
    const nextId = (): string => `edit-${++sequence}`;

    // 进行中的打字 burst：base = burst 起点的 plan，id = 该 burst 的编辑 id。null = 无 burst。
    let burstBasePlan: RepairPlan | null = null;
    let burstId: string | null = null;

    const draft = computed<string>(() => foldDraft(plan.value));
    const diffs = computed<RepairDiff[]>(() => deriveDiffs(plan.value));
    const changed = computed<boolean>(() => plan.value.edits.length > 0);
    const netDelta = computed<number>(() => draft.value.length - plan.value.source.length);

    /** 封口当前打字 burst（失焦时调用）；下一段输入起新编辑。 */
    function sealDraft(): void {
        burstBasePlan = null;
        burstId = null;
    }

    /** 重挂新原文（换文档 / rebase 基线），清空全部编辑。 */
    function resetSource(source: string): void {
        sealDraft();
        plan.value = createPlan(source);
        sequence = 0;
    }

    /**
     * textarea 整串回传（自由打字入口）：把「burst 起点草稿 → nextDraft」折算成**单条**编辑，
     * 每次击键复用同一 base + id 重算，于是连续打字始终只成一条编辑（直到 sealDraft）。
     */
    function setDraft(nextDraft: string, kind: RepairEditKind = "user", title = ""): void {
        if (nextDraft === draft.value) {
            return;
        }
        if (burstBasePlan === null || burstId === null) {
            burstBasePlan = plan.value;
            burstId = nextId();
        }
        const splice = locateMinimalSplice(foldDraft(burstBasePlan), nextDraft);
        plan.value = applyDraftSplice(burstBasePlan, splice.from, splice.to, splice.inserted, {id: burstId, kind, title});
    }

    /** draft 坐标上的定点替换（选区替换 / Markdown 格式化 / 接受命中）。结构化操作 → 先封口 burst。 */
    function spliceDraft(from: number, to: number, replacement: string, kind: RepairEditKind, title: string, ruleId?: string): void {
        sealDraft();
        plan.value = applyDraftSplice(plan.value, from, to, replacement, {id: nextId(), kind, title, ruleId});
    }

    /** 原文坐标上的替换（接受命中的规则替换），携带 ruleId 溯源。 */
    function editSource(from: number, to: number, replacement: string, kind: RepairEditKind, title: string, ruleId?: string): void {
        sealDraft();
        plan.value = applySourceEdit(plan.value, from, to, replacement, {id: nextId(), kind, title, ruleId});
    }

    /** 逐条 reject：移除一条编辑，该处回到原文。 */
    function reject(editId: string): void {
        sealDraft();
        plan.value = removeEdit(plan.value, editId);
    }

    /** 清空全部编辑，草稿回到原文。 */
    function clear(): void {
        sealDraft();
        plan.value = clearEdits(plan.value);
    }

    return {plan, draft, diffs, changed, netDelta, resetSource, setDraft, sealDraft, spliceDraft, editSource, reject, clear};
}

import {agentHarness} from "../agent";
import {reconcileDetectRuns} from "../utils/detect";

/** 服务重启不能恢复进程内 AbortController：把悬空运行显式投影为 interrupted。 */
export default defineNitroPlugin(async () => {
    // SQLite 写锁是进程级资源；恢复和检测 run 顺序执行，避免启动阶段自相竞争。
    try {
        await agentHarness.reconcileInterrupted();
    } catch (error) {
        console.error("[agent-reconcile] Harness 恢复失败", error);
    }
    try {
        await reconcileDetectRuns();
    } catch (error) {
        console.error("[agent-reconcile] detector run 恢复失败", error);
    }
});

import {agentHarness} from "../agent";
import {reconcileDetectRuns} from "../utils/detect";

/** 服务重启不能恢复进程内 AbortController：把悬空运行显式投影为 interrupted。 */
export default defineNitroPlugin(async () => {
    await Promise.all([agentHarness.reconcileInterrupted(), reconcileDetectRuns()]);
});

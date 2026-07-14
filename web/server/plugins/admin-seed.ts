import {prisma} from "../database/prisma";
import {hashUserPassword} from "../utils/password";

/**
 * W9-B admin env seed：nitro 启动时执行一次，按环境变量引导管理员账号
 * （register 恒建 role=user，系统原本没有任何内置 admin，/api/export 等 requireAdmin 面无人能进）。
 *
 * 配置走 Nuxt 惯例路径：nuxt.config 的 runtimeConfig.adminUsername/adminPassword 声明空串默认，
 * 运行期由 NUXT_ADMIN_USERNAME / NUXT_ADMIN_PASSWORD 环境变量覆盖（放 gitignored 的 .env）。
 * 三态语义（各记一条日志，绝不落密码）：
 * - 两者齐备且用户不存在 → 创建 admin（密码 scrypt 散列落库）；
 * - 用户已存在 → 仅确保 role=admin，**不覆盖密码**（幂等：重启不重置口令，改密走正常渠道）；
 * - env 缺任一 → 跳过，零 DB 副作用。
 */
export default defineNitroPlugin(async () => {
    const config = useRuntimeConfig();
    const username = config.adminUsername;
    const password = config.adminPassword;
    if (!username || !password) {
        console.info("[admin-seed] 未配置 NUXT_ADMIN_USERNAME / NUXT_ADMIN_PASSWORD，跳过 admin 种子");
        return;
    }

    try {
        const existing = await prisma.user.findUnique({where: {username}});
        if (!existing) {
            const created = await prisma.user.create({
                data: {
                    username,
                    displayName: username,
                    passwordHash: await hashUserPassword(password),
                    role: "admin",
                },
            });
            console.info(`[admin-seed] 已创建 admin：username=${username} userId=${created.id}`);
            return;
        }

        if (existing.role !== "admin") {
            await prisma.user.update({where: {id: existing.id}, data: {role: "admin"}});
            console.info(`[admin-seed] 已把既有用户提升为 admin（密码未动）：username=${username}`);
            return;
        }

        console.info(`[admin-seed] admin 已就绪（密码未动）：username=${username}`);
    } catch (caught) {
        // 种子失败不拦整站启动：匿名采集主流程不依赖 admin，记错误留待人工处理。
        console.error("[admin-seed] admin 种子失败：", caught);
    }
});

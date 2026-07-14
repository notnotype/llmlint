// evals 的 bun CLI 模块（generator/eval-config.ts 等）使用 import.meta.dir——Bun 专有属性，
// 根仓 tsconfig 靠 bun-types 提供其类型。web 服务端经 alias 复用 evals 模块（W6 分类通道）后，
// app 程序（经 nitro 路由类型 InternalApi 拉进 server 端点及其 import 链）与 server 程序
// 都会把这些文件纳入类型检查，而两个程序都不含 bun-types——这里补一个等价的窄声明，
// 放 shared/ 是因为它同时进两个 tsconfig 的 include（`../shared/**/*.d.ts`）。
// 运行期 nitro/node 下该属性为 undefined：web 自己的代码禁止使用它；被复用的 evals 模块
// 也只允许其默认路径常量引用（web 侧一律显式传路径，见 server/utils/classify.ts）。
interface ImportMeta {
    /** Bun 运行时：当前模块所在目录的绝对路径（node/nitro 下为 undefined，勿在 web 代码中使用）。 */
    readonly dir: string;
}

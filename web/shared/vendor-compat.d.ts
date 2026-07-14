// 第三方包解析补丁的类型声明（放 shared/ 是因为 app 与 server 两个 tsconfig 都要覆盖）。
//
// `node-fetch-native-proxy`（W3 detect 通道的代理 fetch）：nitro 自带别名
// `node-fetch-native` → `node-fetch-native/native` 会把子路径 `node-fetch-native/proxy`
// 错误改写成 `…/native.mjs/proxy`，故 nuxt.config 用独立别名直指 `dist/proxy.cjs`（node 实现）。
// 别名目标是 .cjs，TS 拿不到类型 → 在此 re-export 原包的 `./proxy` 类型（exports map 指向 lib/proxy.d.ts）。
declare module "node-fetch-native-proxy" {
    export * from "node-fetch-native/proxy";
}

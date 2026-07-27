// render prompt 版本契约守门（bun:test）。
// 核心是「空约束时 v2 与 v1 逐字节等价」——写作期约束元评测的两臂只能差这一个变量，
// 如果 v2 的模板顺手改了别的措辞，那次 A/B 测的就不是注入约束的效果。
import {test, expect} from "bun:test";
import {renderPrompt, renderSystem} from "./prompts";

const TARGET = 2000;

test("render-v2 空约束时与 v1 逐字节等价（两臂唯一变量 = 约束块）", () => {
    const v1 = renderSystem(renderPrompt("render-v1"), TARGET);
    const v2 = renderSystem(renderPrompt("render-v2"), TARGET);
    expect(v2).toBe(v1);
});

test("render-v2 空白约束等同不注入（避免生成侧传了空文件却记成约束臂）", () => {
    const v1 = renderSystem(renderPrompt("render-v1"), TARGET);
    expect(renderSystem(renderPrompt("render-v2"), TARGET, "   \n\n  ")).toBe(v1);
});

test("render-v2 注入约束时把正文原样带进系统提示词，并保留 {TARGET} 替换", () => {
    const constraints = "- **章尾预告腔**：结尾停在具体动作、画面或一句台词上。";
    const system = renderSystem(renderPrompt("render-v2"), TARGET, constraints);
    expect(system).toContain(constraints);
    expect(system).toContain(`目标篇幅约 ${TARGET} 字`);
    expect(system).not.toContain("{CONSTRAINTS}");
    expect(system).not.toContain("{TARGET}");
});

test("render-v1 不认约束（它是 baseline，模板里没有槽位）", () => {
    const system = renderSystem(renderPrompt("render-v1"), TARGET, "不该出现的约束");
    expect(system).not.toContain("不该出现的约束");
});

test("未知 render 版本直接抛，不静默回落到默认（I8）", () => {
    expect(() => renderPrompt("render-v99")).toThrow("未知 render prompt 版本");
});

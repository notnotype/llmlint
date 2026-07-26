import {describe, expect, it} from "vitest";
import {Window} from "happy-dom";
import {renderAgentMarkdown} from "../web/app/utils/agent-markdown";

// happy-dom 与 lib.dom 的构造器声明来自不同 realm；运行时满足 DOMPurify 的 WindowLike 合同。
const testWindow = new Window() as unknown as Parameters<typeof renderAgentMarkdown>[1];

describe("Agent Markdown", () => {
    it("渲染常用 Markdown，并给链接补安全属性", () => {
        const html = renderAgentMarkdown("**重点**\n\n- 第一项\n- 第二项\n\n[文档](https://example.com)", testWindow);

        expect(html).toContain("<strong>重点</strong>");
        expect(html).toContain("<ul>");
        expect(html).toContain("target=\"_blank\"");
        expect(html).toContain("rel=\"noopener noreferrer\"");
    });

    it("移除原始 HTML、事件属性和危险协议", () => {
        const html = renderAgentMarkdown("<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[危险](javascript:alert(1))", testWindow);

        expect(html).not.toContain("script");
        expect(html).not.toContain("img");
        expect(html).not.toContain("onerror");
        expect(html).not.toContain("javascript:");
    });
});

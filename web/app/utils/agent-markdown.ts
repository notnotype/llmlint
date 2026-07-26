import DOMPurify, {type DOMPurify as DOMPurifyInstance, type WindowLike} from "dompurify";
import {marked} from "marked";

const ALLOWED_TAGS = ["p", "br", "strong", "em", "del", "ul", "ol", "li", "blockquote", "code", "pre", "a", "h1", "h2", "h3", "h4", "hr", "table", "thead", "tbody", "tr", "th", "td"];
const ALLOWED_ATTRIBUTES = ["href", "title", "target", "rel"];
const renderer = new marked.Renderer();
const purifierByWindow = new WeakMap<WindowLike, DOMPurifyInstance>();

// Agent 输出中的原始 HTML 不属于 Markdown 合同；先丢弃，再由 DOMPurify 清理 Markdown 生成的 HTML。
renderer.html = () => "";

/** 将 Agent Markdown 渲染为经过 allow-list 清理的 HTML。 */
export function renderAgentMarkdown(source: string, windowLike: WindowLike): string {
    if (!source.trim() || !windowLike.document) return "";
    const rendered = marked.parse(source, {async: false, breaks: true, gfm: true, renderer});
    const purifier = purifierFor(windowLike);
    const sanitized = purifier.sanitize(rendered, {
        ALLOWED_TAGS,
        ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        ALLOW_UNKNOWN_PROTOCOLS: false,
        FORBID_TAGS: ["style", "svg", "math", "form", "input", "button"],
        FORBID_ATTR: ["style"],
    });
    const template = windowLike.document.createElement("template");
    template.innerHTML = sanitized;
    for (const link of template.content.querySelectorAll("a")) {
        const href = link.getAttribute("href");
        if (!href || !isSafeHref(href)) {
            link.removeAttribute("href");
            link.removeAttribute("target");
            link.removeAttribute("rel");
            continue;
        }
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
    }
    return template.innerHTML;
}

/** DOMPurify 实例按浏览器 Window 复用，避免流式 token 更新反复初始化 sanitizer。 */
function purifierFor(windowLike: WindowLike): DOMPurifyInstance {
    const existing = purifierByWindow.get(windowLike);
    if (existing) return existing;
    const created = DOMPurify(windowLike);
    purifierByWindow.set(windowLike, created);
    return created;
}

/** 只允许网页、邮件及站内相对地址。 */
function isSafeHref(href: string): boolean {
    const normalized = href.trim().toLowerCase();
    if (normalized.startsWith("/") || normalized.startsWith("./") || normalized.startsWith("../") || normalized.startsWith("#")) return true;
    return normalized.startsWith("https://") || normalized.startsWith("http://") || normalized.startsWith("mailto:");
}

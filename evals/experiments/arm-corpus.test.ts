import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, test} from "bun:test";
import {assertExperimentValidity, assertGuideProvenance, verifyExperimentGuide} from "./arm-corpus";
import type {GuideProvenance} from "../../skill/src/guide";

const provenance: GuideProvenance = {
    tier: "standard",
    profileFingerprint: "sha256:b54f839131a065419cbde73389537b0c103144535f63068240bd855f5e4e698b",
    selectedRuleFingerprint: "sha256:555c7194a12ee4372ca5bdd2235bf5cb16634aa0dc34f6db2400b7d2bb9c85e6",
    selectedRuleCount: 71,
    textFingerprint: "sha256:ad938e8afebc2d207f51d178eef420f02e3c0e019faa3d9a2bfb0c3ef67f8a92",
};

describe("experiment guide provenance", () => {
    test("完整匹配通过，旧 guideTier 或缺 profile 直接失败并列出字段", () => {
        expect(() => assertGuideProvenance({...provenance}, provenance, "meta.json")).not.toThrow();
        expect(() => assertGuideProvenance({guideTier: "standard"}, provenance, "meta.json"))
            .toThrow(/profileFingerprint/);
        expect(() => assertGuideProvenance({...provenance, profileFingerprint: null}, provenance, "meta.json"))
            .toThrow(/profileFingerprint: 期望/);
    });

    test("规则数或文本变化会报告预期值与实际值", () => {
        expect(() => assertGuideProvenance({...provenance, selectedRuleCount: 66}, provenance, "meta.json"))
            .toThrow(/selectedRuleCount: 期望 71，实际 66/);
        expect(() => assertGuideProvenance({...provenance, textFingerprint: "bad"}, provenance, "meta.json"))
            .toThrow(/textFingerprint/);
    });

    test("validity 缺失或 invalid 在 guide provenance 与样本扫描之前失败", () => {
        expect(() => assertExperimentValidity({status: "valid"}, "meta.json")).not.toThrow();
        expect(() => assertExperimentValidity(undefined, "meta.json")).toThrow(/缺少合法 validity/);
        expect(() => assertExperimentValidity({status: "invalid", reason: "toolresult 漏传 profile"}, "meta.json"))
            .toThrow(/toolresult 漏传 profile/);

        const root = mkdtempSync(join(tmpdir(), "llmlint-arm-validity-"));
        try {
            const group = join(root, "genre", "plot");
            mkdirSync(group, {recursive: true});
            writeFileSync(join(group, "meta.json"), JSON.stringify({
                genre: "genre",
                plotId: "plot",
                promptVersion: {render: "render-v2"},
                validity: {status: "invalid", reason: "INVALID_BEFORE_PROVENANCE_SENTINEL"},
                guide: {selectedRuleCount: 999},
                samples: [{file: "render.md", role: "render"}],
            }), "utf-8");
            expect(() => verifyExperimentGuide(root, provenance)).toThrow(/INVALID_BEFORE_PROVENANCE_SENTINEL/);
        } finally {
            rmSync(root, {recursive: true, force: true});
        }
    });

    test("非空题组缺 meta 时不能被静默跳过", () => {
        const root = mkdtempSync(join(tmpdir(), "llmlint-arm-missing-meta-"));
        try {
            const group = join(root, "genre", "plot");
            mkdirSync(group, {recursive: true});
            writeFileSync(join(group, "render-01.md"), "正文", "utf-8");
            expect(() => verifyExperimentGuide(root, provenance)).toThrow(/meta\.json 缺失/);
        } finally {
            rmSync(root, {recursive: true, force: true});
        }
    });
});

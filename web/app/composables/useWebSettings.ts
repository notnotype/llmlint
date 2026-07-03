import {computed, watch} from "vue";
import {
    defaultWebSettings,
    normalizeWebSettings,
    type LlmlintWebSettings,
    type WebRuleOverride,
} from "../utils/web-settings";

const SETTINGS_KEY = "llmlint.webSettings.v1";

function readSettings(): LlmlintWebSettings {
    if (!import.meta.client) {
        return {...defaultWebSettings};
    }
    try {
        return normalizeWebSettings(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") as unknown);
    } catch {
        return {...defaultWebSettings};
    }
}

export function useWebSettings() {
    const settings = useState<LlmlintWebSettings>("llmlint-web-settings", readSettings);

    if (import.meta.client) {
        watch(settings, (nextSettings) => {
            window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
        }, {deep: true});
    }

    function patch(patchValue: Partial<LlmlintWebSettings>): void {
        settings.value = {...settings.value, ...patchValue};
    }

    function setNamespaceOverride(namespace: string, override: WebRuleOverride | null): void {
        const next = {...settings.value.namespaceOverrides};
        if (override) {
            next[namespace] = override;
        } else {
            delete next[namespace];
        }
        patch({namespaceOverrides: next});
    }

    function setRuleOverride(ruleId: string, override: WebRuleOverride | null): void {
        const next = {...settings.value.ruleOverrides};
        if (override) {
            next[ruleId] = override;
        } else {
            delete next[ruleId];
        }
        patch({ruleOverrides: next});
    }

    function resetRuleOverrides(): void {
        patch({namespaceOverrides: {}, ruleOverrides: {}});
    }

    const overrideCount = computed(() => Object.keys(settings.value.namespaceOverrides).length + Object.keys(settings.value.ruleOverrides).length);

    return {
        settings,
        overrideCount,
        patch,
        setNamespaceOverride,
        setRuleOverride,
        resetRuleOverrides,
    };
}

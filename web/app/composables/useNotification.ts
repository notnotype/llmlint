export type NotificationTone = "success" | "warning" | "info" | "error";

export type NotificationAction = {
    label: string;
    run: () => void;
};

export type NotificationInput = {
    message: string;
    tone?: NotificationTone;
    action?: NotificationAction;
    duration?: number;
};

export type NotificationItem = Required<Pick<NotificationInput, "tone" | "duration">> & NotificationInput & {
    id: string;
};

const timers = new Map<string, number | ReturnType<typeof globalThis.setTimeout>>();

function createId(): string {
    return `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useNotification() {
    const notifications = useState<NotificationItem[]>("llmlint-notifications", () => []);

    function remove(id: string): void {
        const timer = timers.get(id);
        if (timer) {
            globalThis.clearTimeout(timer);
            timers.delete(id);
        }
        notifications.value = notifications.value.filter((item) => item.id !== id);
    }

    function notify(input: NotificationInput | string): string {
        const normalized = typeof input === "string" ? {message: input} : input;
        const item: NotificationItem = {
            id: createId(),
            message: normalized.message,
            tone: normalized.tone ?? "info",
            action: normalized.action,
            duration: normalized.duration ?? 3200,
        };
        notifications.value = [...notifications.value, item];
        if (import.meta.client && item.duration > 0) {
            timers.set(item.id, window.setTimeout(() => remove(item.id), item.duration));
        }
        return item.id;
    }

    return {
        notifications,
        notify,
        remove,
        success: (message: string, action?: NotificationAction) => notify({message, action, tone: "success"}),
        error: (message: string) => notify({message, tone: "error", duration: 5200}),
        info: (message: string, action?: NotificationAction) => notify({message, action, tone: "info"}),
    };
}

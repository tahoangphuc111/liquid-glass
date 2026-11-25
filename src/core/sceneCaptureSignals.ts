interface SceneCaptureSubscriber {
    source: HTMLElement;
    scheduleCapture: () => void;
    scheduleObserverCapture: () => void;
    handleVisibilityChange: () => void;
}

interface SceneCaptureSignals {
    subscribers: Set<SceneCaptureSubscriber>;
    disconnect: () => void;
}

const documentSignals = new WeakMap<Document, SceneCaptureSignals>();

function createDocumentSignals(doc: Document): SceneCaptureSignals {
    const view = doc.defaultView;
    const subscribers = new Set<SceneCaptureSubscriber>();

    const scheduleCapture = () => {
        for (const subscriber of subscribers) subscriber.scheduleCapture();
    };
    const scheduleObserverCapture = () => {
        for (const subscriber of subscribers) subscriber.scheduleObserverCapture();
    };
    const handleVisibilityChange = () => {
        for (const subscriber of subscribers) subscriber.handleVisibilityChange();
    };

    const themeObserver = typeof MutationObserver === "function" ? new MutationObserver((records) => {
        let rootChanged = false;
        let bodyChanged = false;
        let rootThemeChanged = false;
        let bodyThemeChanged = false;
        const root = doc.documentElement;
        for (const { target, attributeName } of records) {
            if (target === root) {
                rootChanged = true;
                rootThemeChanged ||= attributeName !== "style";
            } else {
                bodyChanged = true;
                bodyThemeChanged ||= attributeName !== "style";
            }
        }
        for (const subscriber of subscribers) {
            const source = subscriber.source;
            if ((rootThemeChanged && source !== root) || (bodyThemeChanged && source !== doc.body)) {
                subscriber.scheduleCapture();
            } else if ((rootChanged && source !== root) || (bodyChanged && source !== doc.body)) {
                subscriber.scheduleObserverCapture();
            }
        }
    }) : null;
    const themeAttributes = {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme", "data-color-scheme"],
    };
    if (doc.documentElement) themeObserver?.observe(doc.documentElement, themeAttributes);
    if (doc.body) themeObserver?.observe(doc.body, themeAttributes);

    const colorScheme = view?.matchMedia?.("(prefers-color-scheme: dark)");
    colorScheme?.addEventListener?.("change", scheduleCapture);
    view?.addEventListener("resize", scheduleObserverCapture, { passive: true });
    doc.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });
    const fonts = doc.fonts;
    fonts?.addEventListener?.("loadingdone", scheduleObserverCapture);
    if (fonts?.status === "loading") void fonts.ready.then(scheduleCapture);

    return {
        subscribers,
        disconnect() {
            themeObserver?.disconnect();
            colorScheme?.removeEventListener?.("change", scheduleCapture);
            view?.removeEventListener("resize", scheduleObserverCapture);
            doc.removeEventListener("visibilitychange", handleVisibilityChange);
            fonts?.removeEventListener?.("loadingdone", scheduleObserverCapture);
        },
    };
}

export function subscribeSceneCaptureSignals(subscriber: SceneCaptureSubscriber): () => void {
    const doc = subscriber.source.ownerDocument;
    let signals = documentSignals.get(doc);
    if (!signals) {
        signals = createDocumentSignals(doc);
        documentSignals.set(doc, signals);
    }
    const { subscribers, disconnect } = signals;
    subscribers.add(subscriber);

    return () => {
        if (subscribers.delete(subscriber) && subscribers.size === 0) {
            documentSignals.delete(doc);
            disconnect();
        }
    };
}

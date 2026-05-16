import "./overlay.css";
import { DEFAULT_SETTINGS, LyriKanaSettings, loadSettings, watchSettings } from "../src/settings";

type OverlayPayload = {
  original: string;
  reading: string;
  translation: string;
  next: string;
  settings: LyriKanaSettings;
};

const overlay = document.querySelector<HTMLElement>("#overlay");
const originalLine = document.querySelector<HTMLElement>("#original");
const readingLine = document.querySelector<HTMLElement>("#reading");
const translationLine = document.querySelector<HTMLElement>("#translation");
const nextLine = document.querySelector<HTMLElement>("#next");

let settings: LyriKanaSettings = { ...DEFAULT_SETTINGS };

function requireElement<T extends Element>(element: T | null, name: string): T {
  if (!element) {
    throw new Error(`Missing overlay element: ${name}`);
  }

  return element;
}

function applySettings(nextSettings: LyriKanaSettings): void {
  settings = nextSettings;

  const root = requireElement(overlay, "overlay");
  const resolvedTheme =
    settings.themeMode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : settings.themeMode;
  root.style.display = settings.enabled ? "block" : "none";
  root.dataset.theme = resolvedTheme;
  root.style.setProperty("--overlay-opacity", String(settings.overlayOpacity));

  root.style.setProperty("--original-min-size", `${settings.originalFontSize}px`);
  root.style.setProperty("--reading-min-size", `${settings.readingFontSize}px`);
  root.style.setProperty(
    "--translation-min-size",
    `${settings.translationFontSize}px`
  );

  const reading = requireElement(readingLine, "reading");
  reading.style.display = settings.showReading ? "block" : "none";

  const translation = requireElement(translationLine, "translation");
  translation.style.display = settings.showTranslation ? "block" : "none";

  requireElement(nextLine, "next").style.display =
    settings.showNextLine ? "block" : "none";
}

function render(payload: OverlayPayload): void {
  applySettings(payload.settings);

  requireElement(originalLine, "original").innerText = payload.original;
  requireElement(readingLine, "reading").innerText = payload.reading;
  requireElement(translationLine, "translation").innerText = payload.translation;
  requireElement(nextLine, "next").innerText = payload.next;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "LYRIKANA_OVERLAY_UPDATE") {
    render(message.payload as OverlayPayload);
  }

  if (message?.type === "LYRIKANA_SETTINGS_UPDATE") {
    applySettings(message.payload as LyriKanaSettings);
  }
});

void loadSettings().then(applySettings);
watchSettings(applySettings);

chrome.runtime.sendMessage({ type: "LYRIKANA_OVERLAY_READY" }).catch(() => {
  // The content script may not be ready yet.
});

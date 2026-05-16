export interface LyriKanaSettings {
  enabled: boolean;
  showReading: boolean;
  showTranslation: boolean;
  showNextLine: boolean;
  originalFontSize: number;
  readingFontSize: number;
  translationFontSize: number;
  overlayOpacity: number;
  themeMode: "system" | "dark" | "light";
  bottomOffset: number;
  previewLeadTime: number;
}

export const SETTINGS_KEY = "lyrikana_settings";

export const DEFAULT_SETTINGS: LyriKanaSettings = {
  enabled: true,
  showReading: true,
  showTranslation: true,
  showNextLine: true,
  originalFontSize: 24,
  readingFontSize: 18,
  translationFontSize: 17,
  overlayOpacity: 0.74,
  themeMode: "system",
  bottomOffset: 120,
  previewLeadTime: 0.3,
};

function normalizeSettings(value: unknown): LyriKanaSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_SETTINGS };
  }

  const candidate = value as Partial<LyriKanaSettings>;

  return {
    enabled: candidate.enabled ?? DEFAULT_SETTINGS.enabled,
    showReading: candidate.showReading ?? DEFAULT_SETTINGS.showReading,
    showTranslation: candidate.showTranslation ?? DEFAULT_SETTINGS.showTranslation,
    showNextLine: candidate.showNextLine ?? DEFAULT_SETTINGS.showNextLine,
    originalFontSize:
      candidate.originalFontSize ?? DEFAULT_SETTINGS.originalFontSize,
    readingFontSize: candidate.readingFontSize ?? DEFAULT_SETTINGS.readingFontSize,
    translationFontSize:
      candidate.translationFontSize ?? DEFAULT_SETTINGS.translationFontSize,
    overlayOpacity: candidate.overlayOpacity ?? DEFAULT_SETTINGS.overlayOpacity,
    themeMode: candidate.themeMode ?? DEFAULT_SETTINGS.themeMode,
    bottomOffset: candidate.bottomOffset ?? DEFAULT_SETTINGS.bottomOffset,
    previewLeadTime: candidate.previewLeadTime ?? DEFAULT_SETTINGS.previewLeadTime,
  };
}

export async function loadSettings(): Promise<LyriKanaSettings> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(result[SETTINGS_KEY]);
}

export async function saveSettings(settings: LyriKanaSettings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

export async function resetSettings(): Promise<LyriKanaSettings> {
  const settings = { ...DEFAULT_SETTINGS };
  await saveSettings(settings);
  return settings;
}

export function watchSettings(
  onChange: (settings: LyriKanaSettings) => void
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName !== "sync") return;
    const change = changes[SETTINGS_KEY];
    if (!change) return;
    onChange(normalizeSettings(change.newValue));
  };

  chrome.storage.onChanged.addListener(listener);

  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

import "./popup.css";
import type { LyriKanaSettings } from "../src/settings";
import {
  loadPopupSettings,
  resetPopupSettings,
  savePopupSettings,
} from "./popupSettings";

const fields = {
  enabled: document.querySelector<HTMLInputElement>("#enabled"),
  showReading: document.querySelector<HTMLInputElement>("#showReading"),
  showTranslation: document.querySelector<HTMLInputElement>("#showTranslation"),
  showNextLine: document.querySelector<HTMLInputElement>("#showNextLine"),
  originalFontSize: document.querySelector<HTMLInputElement>("#originalFontSize"),
  readingFontSize: document.querySelector<HTMLInputElement>("#readingFontSize"),
  translationFontSize:
    document.querySelector<HTMLInputElement>("#translationFontSize"),
  themeMode: document.querySelector<HTMLSelectElement>("#themeMode"),
  overlayOpacity: document.querySelector<HTMLInputElement>("#overlayOpacity"),
  bottomOffset: document.querySelector<HTMLInputElement>("#bottomOffset"),
  previewLeadTime: document.querySelector<HTMLInputElement>("#previewLeadTime"),
  overlayOpacityValue:
    document.querySelector<HTMLOutputElement>("#overlayOpacityValue"),
  previewLeadTimeValue:
    document.querySelector<HTMLOutputElement>("#previewLeadTimeValue"),
  reset: document.querySelector<HTMLButtonElement>("#reset"),
  status: document.querySelector<HTMLSpanElement>("#status"),
};

let settings: LyriKanaSettings;
let statusTimer: number | undefined;

function requireField<T extends Element>(field: T | null, name: string): T {
  if (!field) {
    throw new Error(`Missing popup field: ${name}`);
  }

  return field;
}

function updateStatus(text: string): void {
  const status = requireField(fields.status, "status");
  status.textContent = text;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    status.textContent = "";
  }, 1200);
}

function render(nextSettings: LyriKanaSettings): void {
  settings = nextSettings;

  requireField(fields.enabled, "enabled").checked = settings.enabled;
  requireField(fields.showReading, "showReading").checked = settings.showReading;
  requireField(fields.showTranslation, "showTranslation").checked =
    settings.showTranslation;
  requireField(fields.showNextLine, "showNextLine").checked =
    settings.showNextLine;
  requireField(fields.originalFontSize, "originalFontSize").value = String(
    settings.originalFontSize
  );
  requireField(fields.readingFontSize, "readingFontSize").value = String(
    settings.readingFontSize
  );
  requireField(fields.translationFontSize, "translationFontSize").value = String(
    settings.translationFontSize
  );
  requireField(fields.themeMode, "themeMode").value = settings.themeMode;
  requireField(fields.overlayOpacity, "overlayOpacity").value = String(
    settings.overlayOpacity
  );
  requireField(fields.bottomOffset, "bottomOffset").value = String(
    settings.bottomOffset
  );
  requireField(fields.previewLeadTime, "previewLeadTime").value = String(
    settings.previewLeadTime
  );
  requireField(fields.overlayOpacityValue, "overlayOpacityValue").textContent =
    `${Math.round(settings.overlayOpacity * 100)}%`;
  requireField(fields.previewLeadTimeValue, "previewLeadTimeValue").textContent =
    `${settings.previewLeadTime.toFixed(1)}s`;
}

async function updateSettings(patch: Partial<LyriKanaSettings>): Promise<void> {
  const nextSettings = { ...settings, ...patch };
  render(nextSettings);
  await savePopupSettings(nextSettings);
  updateStatus("Saved");
}

function bindCheckbox(
  field: HTMLInputElement | null,
  key: keyof Pick<
    LyriKanaSettings,
    "enabled" | "showReading" | "showTranslation" | "showNextLine"
  >
): void {
  requireField(field, key).addEventListener("change", (event) => {
    const target = event.currentTarget as HTMLInputElement;
    void updateSettings({ [key]: target.checked });
  });
}

function bindNumber(
  field: HTMLInputElement | null,
  key: keyof Pick<
    LyriKanaSettings,
    "originalFontSize" | "readingFontSize" | "translationFontSize" | "bottomOffset"
  >
): void {
  requireField(field, key).addEventListener("change", (event) => {
    const target = event.currentTarget as HTMLInputElement;
    void updateSettings({ [key]: Number(target.value) });
  });
}

function bindRange(
  field: HTMLInputElement | null,
  key: keyof Pick<LyriKanaSettings, "overlayOpacity" | "previewLeadTime">
): void {
  requireField(field, key).addEventListener("input", (event) => {
    const target = event.currentTarget as HTMLInputElement;
    void updateSettings({ [key]: Number(target.value) });
  });
}

function bindSelect(
  field: HTMLSelectElement | null,
  key: keyof Pick<LyriKanaSettings, "themeMode">
): void {
  requireField(field, key).addEventListener("change", (event) => {
    const target = event.currentTarget as HTMLSelectElement;
    void updateSettings({ [key]: target.value as LyriKanaSettings[typeof key] });
  });
}

async function init(): Promise<void> {
  render(await loadPopupSettings());

  bindCheckbox(fields.enabled, "enabled");
  bindCheckbox(fields.showReading, "showReading");
  bindCheckbox(fields.showTranslation, "showTranslation");
  bindCheckbox(fields.showNextLine, "showNextLine");
  bindNumber(fields.originalFontSize, "originalFontSize");
  bindNumber(fields.readingFontSize, "readingFontSize");
  bindNumber(fields.translationFontSize, "translationFontSize");
  bindSelect(fields.themeMode, "themeMode");
  bindNumber(fields.bottomOffset, "bottomOffset");
  bindRange(fields.overlayOpacity, "overlayOpacity");
  bindRange(fields.previewLeadTime, "previewLeadTime");

  requireField(fields.reset, "reset").addEventListener("click", async () => {
    render(await resetPopupSettings());
    updateStatus("Reset");
  });
}

void init();

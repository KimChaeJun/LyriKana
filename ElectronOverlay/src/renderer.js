const shell = document.querySelector("#shell");
const song = document.querySelector("#song");
const original = document.querySelector("#original");
const reading = document.querySelector("#reading");
const translation = document.querySelector("#translation");
const next = document.querySelector("#next");
const closeButton = document.querySelector("#close");
const minimizeButton = document.querySelector("#minimize");
const modeHint = document.querySelector("#mode-hint");

let settings = {
  enabled: true,
  showReading: true,
  showTranslation: true,
  showNextLine: true,
  originalFontSize: 24,
  readingFontSize: 18,
  translationFontSize: 17,
  overlayOpacity: 0.74,
  themeMode: "system",
};
let clickThrough = false;

const systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function getEffectiveTheme() {
  if (settings.themeMode === "dark" || settings.themeMode === "light") {
    return settings.themeMode;
  }

  return systemDarkQuery.matches ? "dark" : "light";
}

function applyTheme() {
  document.body.dataset.theme = getEffectiveTheme();
  document.documentElement.style.setProperty(
    "--overlay-opacity",
    String(settings.overlayOpacity)
  );
}

function setClickThroughState(enabled) {
  clickThrough = Boolean(enabled);
  document.body.classList.toggle("click-through", clickThrough);
  modeHint.textContent = clickThrough
    ? "Click-through ON"
    : "Click-through OFF";
  modeHint.title = clickThrough
    ? "Press Ctrl+Alt+L to turn click-through off"
    : "Press Ctrl+Alt+L to turn click-through on";
}

function applySettings(nextSettings = {}) {
  settings = { ...settings, ...nextSettings };

  shell.style.display = settings.enabled ? "block" : "none";
  applyTheme();

  document.documentElement.style.setProperty(
    "--original-min-size",
    `${settings.originalFontSize}px`
  );
  document.documentElement.style.setProperty(
    "--reading-min-size",
    `${settings.readingFontSize}px`
  );
  document.documentElement.style.setProperty(
    "--translation-min-size",
    `${settings.translationFontSize}px`
  );

  reading.style.display = settings.showReading ? "block" : "none";
  translation.style.display = settings.showTranslation ? "block" : "none";
  next.style.display = settings.showNextLine ? "inline-block" : "none";
}

function render(payload) {
  applySettings(payload.settings);

  song.textContent = payload.songLabel || "LyriKana";
  original.textContent = payload.original || "";
  reading.textContent = payload.reading || "";
  translation.textContent = payload.translation || "";
  next.textContent = payload.next || "";
}

closeButton.addEventListener("click", () => {
  window.lyrikana.close();
});

minimizeButton.addEventListener("click", () => {
  window.lyrikana.minimize();
});

window.lyrikana.onOverlayUpdate(render);
window.lyrikana.onSettingsUpdate(applySettings);
window.lyrikana.onClickThroughUpdate(setClickThroughState);
systemDarkQuery.addEventListener("change", applyTheme);
applySettings();
setClickThroughState(false);

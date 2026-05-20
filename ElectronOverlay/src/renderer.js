const shell = document.querySelector("#shell");
const song = document.querySelector("#song");
const original = document.querySelector("#original");
const reading = document.querySelector("#reading");
const translation = document.querySelector("#translation");
const next = document.querySelector("#next");
const closeButton = document.querySelector("#close");
const minimizeButton = document.querySelector("#minimize");
const modeHint = document.querySelector("#mode-hint");
const previousTrackButton = document.querySelector("#previous-track");
const playPauseButton = document.querySelector("#play-pause");
const nextTrackButton = document.querySelector("#next-track");

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
let isPlaying = false;

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

  shell.style.display = settings.enabled ? "grid" : "none";
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

function updatePlayPauseButton(nextIsPlaying) {
  isPlaying = Boolean(nextIsPlaying);
  playPauseButton.textContent = isPlaying ? "Ⅱ" : "▶";
  playPauseButton.title = isPlaying ? "Pause" : "Play";
  playPauseButton.setAttribute(
    "aria-label",
    isPlaying ? "Pause track" : "Play track"
  );
  document.body.classList.toggle("is-playing", isPlaying);
}

function render(payload) {
  applySettings(payload.settings);
  if (typeof payload.isPlaying === "boolean") {
    updatePlayPauseButton(payload.isPlaying);
  }

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

previousTrackButton.addEventListener("click", () => {
  window.lyrikana.playerCommand("previous");
});

playPauseButton.addEventListener("click", () => {
  window.lyrikana.playerCommand("play-pause");
});

nextTrackButton.addEventListener("click", () => {
  window.lyrikana.playerCommand("next");
});

window.lyrikana.onOverlayUpdate(render);
window.lyrikana.onSettingsUpdate(applySettings);
window.lyrikana.onClickThroughUpdate(setClickThroughState);
window.lyrikana.onPlaybackUpdate((payload) => {
  updatePlayPauseButton(payload?.isPlaying);
});
systemDarkQuery.addEventListener("change", applyTheme);
applySettings();
setClickThroughState(false);
updatePlayPauseButton(false);

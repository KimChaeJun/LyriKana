let overlayWindowId = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "LYRIKANA_OPEN_OVERLAY") return;

  const url = chrome.runtime.getURL("overlay/index.html");

  if (overlayWindowId !== null) {
    chrome.windows.get(overlayWindowId, (existingWindow) => {
      if (chrome.runtime.lastError || !existingWindow) {
        overlayWindowId = null;
        openOverlayWindow(url);
      }
    });
    return;
  }

  openOverlayWindow(url);
});

function openOverlayWindow(url) {
  chrome.windows.create(
    {
      url,
      type: "popup",
      width: 920,
      height: 260,
      left: 180,
      top: 120,
      focused: true,
    },
    (createdWindow) => {
      overlayWindowId = createdWindow?.id ?? null;
    }
  );
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === overlayWindowId) {
    overlayWindowId = null;
  }
});

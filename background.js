chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "grab-scribd-doc",
    title: "Grab Scribd Doc",
    documentUrlPatterns: ["https://*.scribd.com/*"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "grab-scribd-doc") {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.triggerScribdDownload === 'function') {
          window.triggerScribdDownload(150);
        }
      }
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "NAVIGATE_EMBED" && sender.tab) {
    chrome.tabs.update(sender.tab.id, { url: request.url });
    sendResponse({ success: true });
  }
  return true;
});

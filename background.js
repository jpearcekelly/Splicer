// Background service worker — orchestrates scrolling + screen capture

let cancelCapture = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "captureFullPage") {
    cancelCapture = false;
    captureFullPage().then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (msg.action === "cancelCapture") {
    cancelCapture = true;
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === "getPageInfo") {
    getPageInfoFromTab().then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function getPageInfoFromTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { error: "No active tab found" };

  const [{ result: info }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: getPageInfo,
  });

  const total = Math.ceil(info.scrollHeight / info.viewportHeight);
  return { total, pageUrl: tab.url };
}

async function captureFullPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { error: "No active tab found" };
  }

  // Inject content script to get page dimensions and handle scrolling
  const [{ result: pageInfo }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: getPageInfo,
  });

  const { scrollHeight, viewportHeight, viewportWidth, originalScrollY, pageTitle } = pageInfo;
  const totalScreenshots = Math.ceil(scrollHeight / viewportHeight);
  const screenshots = [];

  for (let i = 0; i < totalScreenshots; i++) {
    if (cancelCapture) {
      // Restore scroll and return what we have so far as cancelled
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrollTo,
        args: [originalScrollY],
      });
      return { error: "Cancelled" };
    }

    const scrollY = i * viewportHeight;

    // Scroll to position
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrollTo,
      args: [scrollY],
    });

    // Wait for rendering to settle (must stay under 2 captures/sec to avoid rate limit)
    await sleep(600);

    // Notify popup of progress
    chrome.runtime.sendMessage({
      type: "capture-progress",
      current: i + 1,
      total: totalScreenshots,
    }).catch(() => {});

    // Capture the visible tab, with retry on rate limit
    let dataUrl;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png",
        });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        // Back off and retry
        await sleep(1000);
      }
    }

    screenshots.push(dataUrl);
  }

  // Restore original scroll position
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrollTo,
    args: [originalScrollY],
  });

  return { screenshots, pageTitle: pageInfo.pageTitle, pageUrl: tab.url };
}

// These functions run in the page context
function getPageInfo() {
  return {
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    originalScrollY: window.scrollY,
    pageTitle: document.title,
  };
}

function scrollTo(y) {
  window.scrollTo({ top: y, behavior: "instant" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

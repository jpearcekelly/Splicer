// Background service worker — orchestrates scrolling + screen capture

let cancelCapture = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "captureFullPage") {
    cancelCapture = false;
    captureFullPage(msg.options || {}).then(sendResponse).catch((err) => {
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

async function captureFullPage(options = {}) {
  const dpr = options.dpi === "1x" ? 1 : 0; // 0 = native (keep retina)

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { error: "No active tab found" };

  const [{ result: pageInfo }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: getPageInfo,
  });

  const { scrollHeight, viewportHeight, viewportWidth, originalScrollY } = pageInfo;
  const totalScreenshots = Math.ceil(scrollHeight / viewportHeight);
  const limit = options.maxScreenshots
    ? Math.min(options.maxScreenshots, totalScreenshots)
    : totalScreenshots;
  const screenshots = [];

  for (let i = 0; i < limit; i++) {
    if (cancelCapture) {
      await restorePageState(tab.id, originalScrollY);
      return { error: "Cancelled" };
    }

    const scrollY = i * viewportHeight;
    const isFirst = i === 0;
    const isLast = i === limit - 1;

    // Scroll to position
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrollToPosition,
      args: [scrollY],
    });

    // Hide sticky/fixed elements (except on first screenshot)
    if (!isFirst) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: hideStickyElements,
      });
    }

    // Wait for lazy-loaded images to finish loading
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: waitForImages,
    });

    // Small settle time for paint
    await sleep(200);

    // Notify popup of progress
    chrome.runtime.sendMessage({
      type: "capture-progress",
      current: i + 1,
      total: limit,
    }).catch(() => {});

    // Capture with retry on rate limit
    let dataUrl;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png",
        });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await sleep(1000);
      }
    }

    // Restore sticky elements after capture
    if (!isFirst) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: restoreStickyElements,
      });
    }

    // Trim the last screenshot if it overlaps with the previous one
    if (isLast && limit === totalScreenshots && totalScreenshots > 1) {
      const remainder = scrollHeight % viewportHeight;
      if (remainder > 0) {
        dataUrl = await trimScreenshot(dataUrl, remainder, viewportWidth, dpr);
      }
    }

    // Downscale to 1x if requested
    if (dpr === 1) {
      dataUrl = await downscaleTo1x(dataUrl);
    }

    screenshots.push(dataUrl);
  }

  // Restore original state
  await restorePageState(tab.id, originalScrollY);

  return { screenshots, pageTitle: pageInfo.pageTitle, pageUrl: tab.url };
}

async function restorePageState(tabId, scrollY) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: restoreStickyElements,
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: scrollToPosition,
    args: [scrollY],
  });
}

// --- OffscreenCanvas image processing (runs in service worker) ---

async function trimScreenshot(dataUrl, remainderPx, viewportWidth, dpr) {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);

  // The actual pixel dimensions (may be 2x on retina)
  const imgW = bitmap.width;
  const imgH = bitmap.height;

  // Calculate the scale factor from the captured image
  const scale = imgW / viewportWidth;
  const cropHeight = Math.round(remainderPx * scale);
  const cropY = imgH - cropHeight;

  const canvas = new OffscreenCanvas(imgW, cropHeight);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, cropY, imgW, cropHeight, 0, 0, imgW, cropHeight);
  bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(outBlob);
}

async function downscaleTo1x(dataUrl) {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);

  const halfW = Math.round(bitmap.width / 2);
  const halfH = Math.round(bitmap.height / 2);

  // If already roughly 1x, skip
  if (bitmap.width <= 800) {
    bitmap.close();
    return dataUrl;
  }

  const canvas = new OffscreenCanvas(halfW, halfH);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, halfW, halfH);
  bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(outBlob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// --- Functions injected into the page context ---

function getPageInfo() {
  return {
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    originalScrollY: window.scrollY,
    pageTitle: document.title,
    devicePixelRatio: window.devicePixelRatio,
  };
}

function scrollToPosition(y) {
  window.scrollTo({ top: y, behavior: "instant" });
}

function hideStickyElements() {
  // Tag and hide all fixed/sticky elements
  const allElements = document.querySelectorAll("*");
  for (const el of allElements) {
    const style = getComputedStyle(el);
    if (style.position === "fixed" || style.position === "sticky") {
      el.dataset.splicerHidden = el.style.visibility || "";
      el.style.setProperty("visibility", "hidden", "important");
    }
  }
}

function restoreStickyElements() {
  const hidden = document.querySelectorAll("[data-splicer-hidden]");
  for (const el of hidden) {
    const prev = el.dataset.splicerHidden;
    if (prev) {
      el.style.visibility = prev;
    } else {
      el.style.removeProperty("visibility");
    }
    delete el.dataset.splicerHidden;
  }
}

function waitForImages() {
  return new Promise((resolve) => {
    const check = (attempts = 0) => {
      const images = document.querySelectorAll("img");
      const loading = [...images].filter(
        (img) => img.getBoundingClientRect().top < window.innerHeight * 2 &&
                 !img.complete
      );

      if (loading.length === 0 || attempts > 20) {
        resolve();
        return;
      }

      // Wait a bit and check again
      setTimeout(() => check(attempts + 1), 100);
    };
    check();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

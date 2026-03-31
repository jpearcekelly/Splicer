const statusEl = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const saveDesktopBtn = document.getElementById("saveDesktop");
const copyClipboardBtn = document.getElementById("copyClipboard");
const sendFigmaBtn = document.getElementById("sendFigma");
const figmaSettings = document.getElementById("figmaSettings");
const figmaGoBtn = document.getElementById("figmaGo");
const figmaTokenInput = document.getElementById("figmaToken");
const figmaFileKeyInput = document.getElementById("figmaFileKey");
const previewEl = document.getElementById("preview");
const cancelBtn = document.getElementById("cancelBtn");

// Cancel button
cancelBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ action: "cancelCapture" });
});

// Load saved Figma settings
chrome.storage?.local?.get(["figmaToken", "figmaFileKey"], (data) => {
  if (data?.figmaToken) figmaTokenInput.value = data.figmaToken;
  if (data?.figmaFileKey) figmaFileKeyInput.value = data.figmaFileKey;
});

// On open, immediately ask how many screenshots this page will produce
chrome.runtime.sendMessage({ action: "getPageInfo" }).then((info) => {
  if (info && !info.error && info.total) {
    previewEl.textContent = `This page will be ${info.total} screenshot${info.total > 1 ? "s" : ""}.`;
    previewEl.style.display = "block";
  }
}).catch(() => {});

function getSelectedDpi() {
  return document.querySelector('input[name="dpi"]:checked')?.value || "2x";
}

function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function setProgress(pct) {
  progressBar.classList.toggle("visible", pct >= 0);
  progressFill.style.width = `${pct}%`;
}

function setCapturing(capturing) {
  saveDesktopBtn.disabled = capturing;
  copyClipboardBtn.disabled = capturing;
  sendFigmaBtn.disabled = capturing;
  figmaGoBtn.disabled = capturing;
  cancelBtn.classList.toggle("visible", capturing);
}

// Listen for progress updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "capture-progress") {
    setProgress((msg.current / msg.total) * 100);
    setStatus(`Capturing screenshot ${msg.current} of ${msg.total}...`);
  }
});

// Helper: capture with current options
async function captureScreenshots(opts = {}) {
  return chrome.runtime.sendMessage({
    action: "captureFullPage",
    options: { dpi: getSelectedDpi(), ...opts },
  });
}

// Save to Downloads
saveDesktopBtn.addEventListener("click", async () => {
  setCapturing(true);
  previewEl.style.display = "none";
  setStatus("Starting capture...");
  setProgress(0);

  try {
    const response = await captureScreenshots();

    if (response.error) {
      setStatus(response.error, "error");
      setCapturing(false);
      return;
    }

    const { screenshots, pageUrl } = response;

    let urlSlug;
    try {
      const u = new URL(pageUrl);
      urlSlug = (u.host + u.pathname)
        .replace(/\/+$/, "")
        .replace(/[^a-zA-Z0-9.-]/g, "-")
        .replace(/-+/g, "-");
    } catch {
      urlSlug = "screenshot";
    }

    const total = screenshots.length;

    for (let i = 0; i < total; i++) {
      const filename =
        total === 1
          ? `${urlSlug}.png`
          : `${urlSlug} (${i + 1} of ${total}).png`;

      await chrome.downloads.download({
        url: screenshots[i],
        filename: filename,
        saveAs: false,
      });
    }

    setProgress(100);
    setStatus(`Saved ${total} screenshot${total > 1 ? "s" : ""} to Downloads`, "success");
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  }

  setCapturing(false);
});

// Copy to clipboard
copyClipboardBtn.addEventListener("click", async () => {
  setCapturing(true);
  setStatus("Capturing first screenshot...");
  setProgress(0);

  try {
    const response = await captureScreenshots({ maxScreenshots: 1 });

    if (response.error) {
      setStatus(response.error, "error");
      setCapturing(false);
      return;
    }

    const { screenshots } = response;
    setStatus("Copying to clipboard...");

    const resp = await fetch(screenshots[0]);
    const blob = await resp.blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);

    setProgress(100);
    setStatus("Copied to clipboard", "success");
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  }

  setCapturing(false);
});

// Toggle Figma settings
sendFigmaBtn.addEventListener("click", () => {
  figmaSettings.classList.toggle("visible");
});

// Send to Figma
figmaGoBtn.addEventListener("click", async () => {
  const token = figmaTokenInput.value.trim();
  const fileKey = figmaFileKeyInput.value.trim();

  if (!token || !fileKey) {
    setStatus("Please enter both Figma token and file key", "error");
    return;
  }

  chrome.storage?.local?.set({ figmaToken: token, figmaFileKey: fileKey });

  setCapturing(true);
  previewEl.style.display = "none";
  setStatus("Starting capture...");
  setProgress(0);

  try {
    const response = await captureScreenshots();

    if (response.error) {
      setStatus(response.error, "error");
      setCapturing(false);
      return;
    }

    const { screenshots, pageTitle } = response;
    setStatus("Uploading to Figma...");

    const imageBlobs = [];
    for (const dataUrl of screenshots) {
      const resp = await fetch(dataUrl);
      imageBlobs.push(await resp.blob());
    }

    const uploadedImages = [];
    for (let i = 0; i < imageBlobs.length; i++) {
      setStatus(`Uploading image ${i + 1} of ${imageBlobs.length} to Figma...`);
      setProgress(((i + 1) / imageBlobs.length) * 100);

      const formData = new FormData();
      const fileName = `${pageTitle || "Screenshot"}_${i + 1}.png`;
      formData.append("file", imageBlobs[i], fileName);

      const uploadResp = await fetch(
        `https://api.figma.com/v1/images/${fileKey}`,
        {
          method: "POST",
          headers: { "X-Figma-Token": token },
          body: formData,
        }
      );

      if (!uploadResp.ok) {
        const errBody = await uploadResp.text();
        throw new Error(`Figma upload failed (${uploadResp.status}): ${errBody}`);
      }

      const result = await uploadResp.json();
      uploadedImages.push(result);
    }

    setProgress(100);
    setStatus(
      `Uploaded ${screenshots.length} image${screenshots.length > 1 ? "s" : ""} to Figma`,
      "success"
    );
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  }

  setCapturing(false);
});

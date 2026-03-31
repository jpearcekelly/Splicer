# Splicer

A Chrome extension that captures full web pages as a series of viewport-sized screenshots — not one giant stitched image, but individual frames you can drop straight into Figma or any design tool.

## The problem

If you've ever tried to get a full web page into Figma, you know the pain:

1. **Figma has a maximum image size** — large full-page screenshots get downscaled on import, so you lose detail exactly where you need it. A 15,000px tall PNG doesn't survive the drag-and-drop.
2. **Even when they do import, giant images are unwieldy** — hard to annotate, slow to render, and awkward to lay out on a canvas.
3. **Manual screenshotting is tedious** — scrolling, capturing, scrolling, capturing, renaming files, dragging them in one by one.

Splicer fixes this by splitting the page into viewport-sized chunks that each stay well within Figma's limits — full quality, no downscaling, ready to lay out on a frame.

## What it does

- Scrolls through the page automatically, capturing a screenshot at each viewport height
- **Save to Downloads** — files named after the page URL (e.g. `example.com-pricing (1 of 6).png`)
- **Send to Figma** — uploads directly to a Figma file via the API
- Shows a preview count before you capture ("This page will be 4 screenshots")
- Cancel mid-capture if needed
- Handles Chrome's rate limits gracefully with automatic retry

## Install

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select this folder
5. Click the Splicer icon in your toolbar

## Roadmap

- [ ] **Hide sticky/fixed elements** — automatically hide headers, nav bars, and cookie banners that repeat in every screenshot
- [ ] **Copy to clipboard** — paste screenshots directly into Figma or Slack without saving files
- [ ] **DPI control** — toggle between 1x and 2x (Retina) capture to manage file size
- [ ] **Trim last screenshot** — crop the final image to avoid overlap with the previous one
- [ ] **Smart lazy-load detection** — wait for images to finish loading after each scroll instead of using a fixed delay
- [ ] **Figma auto-layout** — place screenshots sequentially on a Figma canvas, not just upload as fills

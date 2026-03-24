# kingnwaf Chrome Extension — Install & Test Guide

## File Structure

```
kingnwaf-extension/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker: alarms, notifications, routing
├── content.js             # Injected into pages: translation popup, OCR mode, word coloring
├── content.css            # Styles for the in-page popup and OCR overlay
├── popup.html             # Extension popup (toolbar icon click)
├── popup.css              # Popup styles
├── popup.js               # Popup logic: settings, stats, toggles
├── dashboard.html         # Full vocabulary review dashboard
├── dashboard.css          # Dashboard styles
├── dashboard.js           # Dashboard logic: filter, search, SRS actions
├── storage.js             # Storage manager (chrome.storage.local)
├── translation.js         # Translation module (MyMemory API)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── INSTALL.md             # This file
```

## How Each Part Works

| File | Role |
|---|---|
| `manifest.json` | Declares permissions, registers background/content scripts |
| `background.js` | Handles alarms for reminders, shows Chrome notifications, routes messages |
| `content.js` | Watches text selections → shows popup → fetches translation; handles Alt+S OCR |
| `content.css` | Dark-themed popup + OCR overlay styles injected into every page |
| `popup.html/css/js` | Toolbar icon popup: stats, toggles, reminder selector, dashboard link |
| `dashboard.html/css/js` | Full review page: word list, search, filter, SRS status buttons, delete |
| `storage.js` | All chrome.storage reads/writes; recalculates stats on every change |
| `translation.js` | translateText() wraps MyMemory API; isLikelyEnglish() filters selections |

## Install in Chrome

1. Open Chrome and go to: `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `kingnwaf-extension/` folder
5. The **K** icon will appear in your Chrome toolbar

## Testing Each Feature

### 1. Text Translation
1. Open any English webpage (e.g. https://en.wikipedia.org)
2. Select any English word or short phrase
3. A dark popup appears near the selection showing:
   - Arabic translation
   - Alternative meaning (if available)
   - **Save** and **Cancel** buttons
4. Click **Save** → word is stored, popup closes

### 2. OCR Mode (Alt+S)
1. On any webpage, press **Alt+S**
2. A crosshair overlay appears with a hint message
3. Click and drag to select a region containing English text (e.g. a heading or paragraph)
4. Release the mouse — a modal appears showing:
   - Extracted text (via Tesseract.js OCR)
   - Arabic translation
   - Save option
5. Press **Esc** to cancel OCR mode at any time
> Note: OCR loads Tesseract.js from CDN on first use (~2MB, takes a few seconds). It works best on high-contrast text.

### 3. Vocabulary Dashboard
1. Click the **K** toolbar icon to open the popup
2. Click **Open Review Dashboard →**
3. Dashboard shows all saved words with:
   - Arabic translation + meaning
   - Status badge (New / Learning / Review / Mastered)
   - Date saved and source website
   - Context snippet (if available)
4. Click status buttons (New, Learning, Review, Mastered) to advance a word
5. Use the left sidebar to filter by status
6. Use the search bar to find words
7. Click **Delete** to remove a word

### 4. Reminders
1. Open the popup → select a reminder interval (15 min / 30 min / 1 hour)
2. Chrome will show a notification with a saved word and its Arabic meaning
3. Click the notification to open the Review Dashboard
> Note: Notifications require Chrome notification permission. Chrome may prompt you.

### 5. Word Coloring
1. Save a few words first
2. Open popup → enable **Word Coloring**
3. Reload any page where those words appear
4. Saved words are highlighted in indigo on the page

### 6. ON/OFF Toggle
- The toggle in the popup header enables/disables the extension
- When disabled, no popups appear on text selection

## Permissions Explained

| Permission | Reason |
|---|---|
| `storage` | Saves vocabulary and settings |
| `alarms` | Schedules periodic review reminders |
| `notifications` | Shows word reminder notifications |
| `activeTab` | Needed for context menu translation |
| `scripting` | Allows injecting helpers if needed |
| `contextMenus` | Right-click → Translate with kingnwaf |
| `<all_urls>` | Content script runs on all pages for translation |

## Translation API

Uses **MyMemory** (https://mymemory.translated.net) — free, no API key required.
- Limit: 5,000 words/day per IP (generous for personal use)
- To switch providers: replace `fetchTranslation()` in `content.js` and `translateText()` in `translation.js`

## Troubleshooting

| Issue | Fix |
|---|---|
| Popup doesn't appear | Check extension is ON in popup toggle; reload the page |
| Translation fails | Check internet connection; MyMemory may have rate-limited your IP |
| OCR finds no text | Try selecting a larger region with high-contrast text |
| Notifications not showing | Allow notifications for extensions in Chrome settings |
| Words not highlighting | Reload the page after enabling Word Coloring |

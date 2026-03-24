/**
 * kingnwaf — Background Service Worker v3
 * =========================================
 * الإصلاحات:
 * 1. Google Translate كـ API ثالث (الأكثر موثوقية)
 * 2. captureVisibleTab يستخدم windowId من الـ sender
 * 3. تطبيع النص قبل الترجمة
 * 4. ذاكرة تخزين مؤقت
 * 5. معالجة شاملة للأخطاء
 */

import { getSettings, saveSettings, getRandomWord } from './storage.js';

const ALARM_NAME = 'kingnwaf_reminder';
const NOTIF_PREFIX = 'kingnwaf_word_';

// ذاكرة تخزين مؤقت
const translationCache = new Map();

// ---- تهيئة ----
chrome.runtime.onInstalled.addListener(async () => {
  try {
    chrome.contextMenus.create({
      id: 'kingnwaf_translate',
      title: 'ترجمة مع kingnwaf',
      contexts: ['selection'],
    });
  } catch (_) {}

  try {
    const settings = await getSettings();
    if (settings.reminderInterval > 0) scheduleAlarm(settings.reminderInterval);
  } catch (_) {}
});

// ---- التنبيهات ----
function scheduleAlarm(intervalMinutes) {
  chrome.alarms.clear(ALARM_NAME, () => {
    if (intervalMinutes > 0) {
      chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: intervalMinutes,
        periodInMinutes: intervalMinutes,
      });
    }
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  try {
    const settings = await getSettings();
    if (!settings.enabled || settings.reminderInterval <= 0) return;
    const word = await getRandomWord();
    if (!word) return;
    chrome.notifications.create(NOTIF_PREFIX + word.id, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'kingnwaf: ' + word.english,
      message:
        word.arabic +
        (word.meaning && word.meaning !== word.arabic ? '\n' + word.meaning : ''),
      priority: 1,
    });
  } catch (_) {}
});

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith(NOTIF_PREFIX)) {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    chrome.notifications.clear(id);
  }
});

// ---- قائمة السياق ----
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'kingnwaf_translate' && info.selectionText && tab && tab.id) {
    chrome.tabs
      .sendMessage(tab.id, { type: 'TRANSLATE_SELECTION', text: info.selectionText })
      .catch(() => {});
  }
});

// ============================================================
// تطبيع النص — إزالة الحروف المخفية والمسافات الزائدة
// ============================================================
function normalizeText(raw) {
  return raw
    .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\uFEFF]/g, '') // حروف تحكم مخفية
    .replace(/\r\n|\r/g, '\n')
    .replace(/[^\S\n]+/g, ' ')  // مسافات متعددة → واحدة
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================================
// APIs الترجمة
// ============================================================

function fetchTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// 1. Google Translate (غير رسمي — لكن الأكثر موثوقية)
async function translateGoogle(text) {
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    '?client=gtx&sl=en&tl=ar&dt=t&q=' +
    encodeURIComponent(text);

  const res = await fetchTimeout(url, 7000);
  if (!res.ok) throw new Error('Google HTTP ' + res.status);

  const data = await res.json();
  // الرد: [[[trans, orig, ...],...], ...]
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('Google: تنسيق غير متوقع');
  }

  const arabic = data[0]
    .filter((chunk) => chunk && chunk[0])
    .map((chunk) => chunk[0])
    .join('')
    .trim();

  if (!arabic || arabic === text) throw new Error('Google: لا ترجمة');
  return { arabic, meaning: arabic };
}

// 2. MyMemory (5000 كلمة/يوم)
async function translateMyMemory(text) {
  const url =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text) +
    '&langpair=en|ar';

  const res = await fetchTimeout(url, 8000);
  if (!res.ok) throw new Error('MyMemory HTTP ' + res.status);

  const data = await res.json();
  const status = String(data.responseStatus);
  if (status !== '200') throw new Error('MyMemory: ' + (data.responseMessage || status));

  const arabic = (data.responseData && data.responseData.translatedText) || '';
  if (!arabic || arabic === text) throw new Error('MyMemory: لا ترجمة');

  const matches = data.matches || [];
  const alt = matches.find(
    (m) => m.translation && m.translation !== arabic && m.translation !== text
  );
  return { arabic, meaning: alt ? alt.translation : arabic };
}

// 3. Lingva (مفتوح المصدر)
async function translateLingva(text) {
  const url = 'https://lingva.ml/api/v1/en/ar/' + encodeURIComponent(text);
  const res = await fetchTimeout(url, 8000);
  if (!res.ok) throw new Error('Lingva HTTP ' + res.status);

  const data = await res.json();
  const arabic = data.translation || '';
  if (!arabic || arabic === text) throw new Error('Lingva: لا ترجمة');
  return { arabic, meaning: arabic };
}

// الترجمة مع Fallback تلقائي: Google → MyMemory → Lingva
async function translateWithFallback(rawText) {
  const text = normalizeText(rawText);
  if (!text) throw new Error('النص فارغ بعد التطبيع');

  const cacheKey = text.toLowerCase().slice(0, 200);
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);

  const providers = [translateGoogle, translateMyMemory, translateLingva];
  let lastErr = null;

  for (const provider of providers) {
    try {
      const result = await provider(text);
      if (result && result.arabic) {
        if (translationCache.size >= 500) {
          translationCache.delete(translationCache.keys().next().value);
        }
        translationCache.set(cacheKey, result);
        return result;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error('فشلت جميع محاولات الترجمة — ' + (lastErr ? lastErr.message : 'خطأ'));
}

// ============================================================
// لقطة الشاشة — مع windowId من الـ sender
// ============================================================
function captureTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(
      windowId || null,
      { format: 'png', quality: 95 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!dataUrl) {
          reject(new Error('captureVisibleTab أرجعت فارغاً'));
        } else {
          resolve(dataUrl);
        }
      }
    );
  });
}

// ============================================================
// معالجة الرسائل
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'TRANSLATE') {
    const text = (message.text || '').trim();
    if (!text) {
      sendResponse({ success: false, error: 'نص فارغ' });
      return false;
    }
    translateWithFallback(text)
      .then((r) => sendResponse({ success: true, arabic: r.arabic, meaning: r.meaning }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'CAPTURE_TAB') {
    // استخدام windowId من الـ sender لضمان التقاط النافذة الصحيحة
    const windowId = sender && sender.tab ? sender.tab.windowId : null;
    captureTab(windowId)
      .then((dataUrl) => sendResponse({ success: true, dataUrl }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    getSettings()
      .then((s) => sendResponse(s))
      .catch(() => sendResponse({ enabled: true, wordColoring: false, forceAllText: false }));
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    saveSettings(message.settings)
      .then((updated) => {
        scheduleAlarm(updated.reminderInterval || 0);
        sendResponse({ success: true, settings: updated });
      })
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'OPEN_DASHBOARD') {
    chrome.tabs
      .create({ url: chrome.runtime.getURL('dashboard.html') })
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.type === 'WORD_COLORING_CHANGED') {
    chrome.tabs.query({}).then((tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs
            .sendMessage(tab.id, {
              type: 'UPDATE_WORD_COLORING',
              wordColoring: message.wordColoring,
              forceAllText: message.forceAllText,
            })
            .catch(() => {});
        }
      });
    }).catch(() => {});
    sendResponse({ success: true });
    return false;
  }
});

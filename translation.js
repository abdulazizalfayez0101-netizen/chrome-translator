/**
 * Translation Module for kingnwaf
 * Handles English → Arabic translation.
 * Uses the MyMemory free translation API (no key required, generous limits).
 * Abstract interface: swap `translateText` implementation to change providers.
 */

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

/**
 * Translate text from English to Arabic.
 * @param {string} text - English text to translate
 * @returns {Promise<{arabic: string, meaning: string}>}
 */
export async function translateText(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Empty text');

  const url = `${MYMEMORY_URL}?q=${encodeURIComponent(trimmed)}&langpair=en|ar`;

  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Translation request failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.responseStatus !== 200 && data.responseStatus !== '200') {
    throw new Error(`Translation error: ${data.responseMessage || 'Unknown error'}`);
  }

  const arabic = data.responseData?.translatedText || '';
  if (!arabic) throw new Error('No translation returned');

  // MyMemory sometimes returns matches with alternative translations
  const matches = data.matches || [];
  let meaning = '';
  if (matches.length > 1) {
    // Use the second match as an alternative meaning if different
    const alt = matches.find(
      (m) => m.translation && m.translation !== arabic
    );
    if (alt) meaning = alt.translation;
  }

  return {
    arabic,
    meaning: meaning || arabic,
  };
}

/**
 * Check if text is likely English (basic heuristic).
 * Rejects text that contains Arabic/CJK characters or is too short.
 * @param {string} text
 * @returns {boolean}
 */
export function isLikelyEnglish(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 1) return false;

  // Reject if mostly non-Latin characters
  const arabicPattern = /[\u0600-\u06FF]/;
  const cjkPattern = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

  if (arabicPattern.test(trimmed) || cjkPattern.test(trimmed)) return false;

  // Must contain at least one ASCII letter
  if (!/[a-zA-Z]/.test(trimmed)) return false;

  return true;
}

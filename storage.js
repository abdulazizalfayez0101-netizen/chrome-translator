/**
 * Storage Manager for kingnwaf
 * Handles all vocabulary data using chrome.storage.local.
 * Structured so cloud sync can be added later by swapping the storage backend.
 */

const STORAGE_KEYS = {
  VOCABULARY: 'kw_vocabulary',
  SETTINGS: 'kw_settings',
  STATS: 'kw_stats',
};

const DEFAULT_SETTINGS = {
  enabled: true,
  wordColoring: false,
  forceAllText: false,
  reminderInterval: 0, // 0 = disabled, in minutes
};

const DEFAULT_STATS = {
  totalCards: 0,
  mastered: 0,
  cardsdue: 0,
  wordsKnown: 0,
};

// ---- Vocabulary CRUD ----

export async function getAllWords() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.VOCABULARY);
  return result[STORAGE_KEYS.VOCABULARY] || [];
}

export async function saveWord(entry) {
  const words = await getAllWords();

  // Avoid duplicates: check by english word (case-insensitive)
  const duplicate = words.find(
    (w) => w.english.toLowerCase() === entry.english.toLowerCase()
  );
  if (duplicate) {
    // Update existing entry
    const updated = words.map((w) =>
      w.english.toLowerCase() === entry.english.toLowerCase()
        ? { ...w, ...entry, updatedAt: Date.now() }
        : w
    );
    await chrome.storage.local.set({ [STORAGE_KEYS.VOCABULARY]: updated });
    await recalcStats(updated);
    return updated.find((w) => w.english.toLowerCase() === entry.english.toLowerCase());
  }

  const newEntry = {
    id: Date.now().toString(),
    english: entry.english,
    arabic: entry.arabic,
    meaning: entry.meaning || '',
    context: entry.context || '',
    sourceUrl: entry.sourceUrl || '',
    timestamp: Date.now(),
    updatedAt: Date.now(),
    mastered: false,
    status: 'new', // new | learning | review | mastered
    reviewCount: 0,
    nextReview: Date.now(),
  };

  const updated = [newEntry, ...words];
  await chrome.storage.local.set({ [STORAGE_KEYS.VOCABULARY]: updated });
  await recalcStats(updated);
  return newEntry;
}

export async function deleteWord(id) {
  const words = await getAllWords();
  const updated = words.filter((w) => w.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.VOCABULARY]: updated });
  await recalcStats(updated);
}

export async function markMastered(id, mastered) {
  const words = await getAllWords();
  const updated = words.map((w) => {
    if (w.id === id) {
      return {
        ...w,
        mastered,
        status: mastered ? 'mastered' : 'review',
        updatedAt: Date.now(),
      };
    }
    return w;
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.VOCABULARY]: updated });
  await recalcStats(updated);
}

export async function updateWordStatus(id, status) {
  const words = await getAllWords();
  const updated = words.map((w) => {
    if (w.id === id) {
      const mastered = status === 'mastered';
      // Simple SRS: schedule next review
      const intervals = { new: 1, learning: 3, review: 7, mastered: 30 };
      const days = intervals[status] || 1;
      return {
        ...w,
        status,
        mastered,
        reviewCount: w.reviewCount + 1,
        nextReview: Date.now() + days * 24 * 60 * 60 * 1000,
        updatedAt: Date.now(),
      };
    }
    return w;
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.VOCABULARY]: updated });
  await recalcStats(updated);
}

// ---- Settings ----

export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
}

export async function saveSettings(settings) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

// ---- Stats ----

export async function getStats() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  return { ...DEFAULT_STATS, ...(result[STORAGE_KEYS.STATS] || {}) };
}

async function recalcStats(words) {
  const now = Date.now();
  const stats = {
    totalCards: words.length,
    mastered: words.filter((w) => w.mastered).length,
    cardsdue: words.filter((w) => !w.mastered && w.nextReview <= now).length,
    wordsKnown: words.filter((w) => w.status !== 'new').length,
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
  return stats;
}

// ---- Get a random word for notifications ----

export async function getRandomWord() {
  const words = await getAllWords();
  if (!words.length) return null;
  const notMastered = words.filter((w) => !w.mastered);
  const pool = notMastered.length ? notMastered : words;
  return pool[Math.floor(Math.random() * pool.length)];
}

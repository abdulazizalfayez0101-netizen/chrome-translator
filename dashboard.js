/**
 * Dashboard Script for kingnwaf
 * Loads vocabulary, renders word cards, handles filtering/search/actions.
 */

(async function () {
  'use strict';

  // ---- State ----
  let allWords = [];
  let currentFilter = 'all';
  let searchQuery = '';

  const wordList = document.getElementById('word-list');
  const emptyState = document.getElementById('empty-state');
  const searchInput = document.getElementById('search-input');
  const navItems = document.querySelectorAll('.nav-item');

  const ssTotalEl = document.getElementById('ss-total');
  const ssMasteredEl = document.getElementById('ss-mastered');
  const ssDueEl = document.getElementById('ss-due');

  // ---- Load ----
  async function loadWords() {
    const stored = await chrome.storage.local.get('kw_vocabulary');
    allWords = stored.kw_vocabulary || [];
    render();
    updateSidebarStats();
  }

  // ---- Sidebar Stats ----
  function updateSidebarStats() {
    const now = Date.now();
    ssTotalEl.textContent = allWords.length;
    ssMasteredEl.textContent = allWords.filter((w) => w.mastered).length;
    ssDueEl.textContent = allWords.filter((w) => !w.mastered && w.nextReview <= now).length;
  }

  // ---- Filter + Search ----
  function getFiltered() {
    let words = allWords;

    if (currentFilter !== 'all') {
      words = words.filter((w) => w.status === currentFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      words = words.filter(
        (w) =>
          w.english.toLowerCase().includes(q) ||
          w.arabic.includes(q) ||
          (w.meaning || '').toLowerCase().includes(q)
      );
    }

    return words;
  }

  // ---- Render ----
  function render() {
    const words = getFiltered();
    const tmpl = document.getElementById('word-card-tmpl');

    // Remove existing cards (keep empty state)
    wordList.querySelectorAll('.word-card').forEach((el) => el.remove());

    if (!words.length) {
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    words.forEach((word) => {
      const card = tmpl.content.cloneNode(true).querySelector('.word-card');
      card.dataset.id = word.id;

      card.querySelector('.card-english').textContent = word.english;
      card.querySelector('.card-arabic').textContent = word.arabic;

      const meaningEl = card.querySelector('.card-meaning');
      if (word.meaning && word.meaning !== word.arabic) {
        meaningEl.textContent = word.meaning;
      } else {
        meaningEl.style.display = 'none';
      }

      // Badge
      const badge = card.querySelector('.card-badge');
      const status = word.status || 'new';
      badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      badge.className = `card-badge badge-${status}`;

      // Date
      const date = new Date(word.timestamp);
      card.querySelector('.card-date').textContent = date.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });

      // Source URL
      const sourceEl = card.querySelector('.card-source');
      if (word.sourceUrl) {
        try {
          const url = new URL(word.sourceUrl);
          sourceEl.textContent = url.hostname;
          sourceEl.title = word.sourceUrl;
        } catch {
          sourceEl.textContent = '';
        }
      }

      // Context
      const ctxEl = card.querySelector('.card-context');
      if (word.context && word.context !== word.english) {
        ctxEl.textContent = `"${word.context}"`;
        ctxEl.classList.add('visible');
      }

      // Highlight active status button
      const statusBtns = card.querySelectorAll('.ca-btn[data-action]');
      statusBtns.forEach((btn) => {
        const action = btn.dataset.action;
        if (action === status) {
          btn.classList.add('active');
        }
      });

      // Action handlers
      card.querySelectorAll('.ca-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          if (action === 'delete') {
            await deleteWord(word.id);
          } else {
            await updateStatus(word.id, action);
          }
        });
      });

      wordList.appendChild(card);
    });
  }

  // ---- Actions ----

  async function deleteWord(id) {
    if (!confirm('Delete this word from your vocabulary?')) return;

    const updated = allWords.filter((w) => w.id !== id);
    await chrome.storage.local.set({ kw_vocabulary: updated });
    allWords = updated;
    await recalcStats(updated);
    render();
    updateSidebarStats();
  }

  async function updateStatus(id, status) {
    const mastered = status === 'mastered';
    const intervals = { new: 1, learning: 3, review: 7, mastered: 30 };
    const days = intervals[status] || 1;

    const updated = allWords.map((w) => {
      if (w.id === id) {
        return {
          ...w,
          status,
          mastered,
          reviewCount: (w.reviewCount || 0) + 1,
          nextReview: Date.now() + days * 24 * 60 * 60 * 1000,
          updatedAt: Date.now(),
        };
      }
      return w;
    });

    await chrome.storage.local.set({ kw_vocabulary: updated });
    allWords = updated;
    await recalcStats(updated);
    render();
    updateSidebarStats();
  }

  async function recalcStats(words) {
    const now = Date.now();
    const stats = {
      totalCards: words.length,
      mastered: words.filter((w) => w.mastered).length,
      cardsdue: words.filter((w) => !w.mastered && w.nextReview <= now).length,
      wordsKnown: words.filter((w) => w.status !== 'new').length,
    };
    await chrome.storage.local.set({ kw_stats: stats });
  }

  // ---- Nav Filters ----
  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      navItems.forEach((n) => n.classList.remove('active'));
      item.classList.add('active');
      currentFilter = item.dataset.filter;
      render();
    });
  });

  // ---- Search ----
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    render();
  });

  // ---- Init ----
  await loadWords();

  // Listen for storage changes (e.g. word saved from content script)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.kw_vocabulary) {
      allWords = changes.kw_vocabulary.newValue || [];
      render();
      updateSidebarStats();
    }
  });

})();

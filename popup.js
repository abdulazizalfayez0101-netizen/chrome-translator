/**
 * Popup Script for kingnwaf
 * Loads settings and stats, handles toggle/reminder changes.
 */

(async function () {
  // ---- Element refs ----
  const app = document.querySelector('.app');
  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleColoring = document.getElementById('toggle-coloring');
  const toggleForce = document.getElementById('toggle-force');
  const reminderSelect = document.getElementById('reminder-select');
  const btnDashboard = document.getElementById('btn-dashboard');

  const statKnown = document.getElementById('stat-known');
  const statMastered = document.getElementById('stat-mastered');
  const statDue = document.getElementById('stat-due');
  const statTotal = document.getElementById('stat-total');

  // ---- Load settings ----
  const settings = await sendMessage({ type: 'GET_SETTINGS' });
  const stored = await chrome.storage.local.get(['kw_stats']);
  const stats = stored.kw_stats || { totalCards: 0, mastered: 0, cardsdue: 0, wordsKnown: 0 };

  // Apply settings to UI
  toggleEnabled.checked = settings.enabled !== false;
  toggleColoring.checked = !!settings.wordColoring;
  toggleForce.checked = !!settings.forceAllText;
  reminderSelect.value = String(settings.reminderInterval || 0);

  updateDisabledState(settings.enabled !== false);

  // Apply stats
  statKnown.textContent = stats.wordsKnown || 0;
  statMastered.textContent = stats.mastered || 0;
  statDue.textContent = stats.cardsdue || 0;
  statTotal.textContent = stats.totalCards || 0;

  // ---- Event Listeners ----

  toggleEnabled.addEventListener('change', async () => {
    const enabled = toggleEnabled.checked;
    await saveSettings({ enabled });
    updateDisabledState(enabled);
  });

  toggleColoring.addEventListener('change', async () => {
    const wordColoring = toggleColoring.checked;
    await saveSettings({ wordColoring });
    // Notify content scripts
    sendMessage({
      type: 'WORD_COLORING_CHANGED',
      wordColoring,
      forceAllText: toggleForce.checked,
    });
  });

  toggleForce.addEventListener('change', async () => {
    const forceAllText = toggleForce.checked;
    await saveSettings({ forceAllText });
    if (toggleColoring.checked) {
      sendMessage({
        type: 'WORD_COLORING_CHANGED',
        wordColoring: true,
        forceAllText,
      });
    }
  });

  reminderSelect.addEventListener('change', async () => {
    const reminderInterval = parseInt(reminderSelect.value, 10);
    await saveSettings({ reminderInterval });
  });

  btnDashboard.addEventListener('click', () => {
    sendMessage({ type: 'OPEN_DASHBOARD' });
    window.close();
  });

  // ---- Helpers ----

  function updateDisabledState(enabled) {
    if (enabled) {
      app.classList.remove('disabled');
    } else {
      app.classList.add('disabled');
    }
    // Re-enable the main toggle itself regardless
    toggleEnabled.closest('.toggle').style.pointerEvents = 'auto';
    toggleEnabled.closest('.toggle').style.opacity = '1';
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({});
        } else {
          resolve(resp || {});
        }
      });
    });
  }

  async function saveSettings(partial) {
    const current = settings;
    const merged = { ...current, ...partial };
    Object.assign(settings, partial);
    await sendMessage({ type: 'SAVE_SETTINGS', settings: merged });
  }
})();

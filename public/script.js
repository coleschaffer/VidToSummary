const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const queueSection = document.getElementById('queueSection');
const queueList = document.getElementById('queueList');
const transcribeAllBtn = document.getElementById('transcribeAll');
const resultsSection = document.getElementById('resultsSection');
const resultsList = document.getElementById('resultsList');
const promptSection = document.getElementById('promptSection');
const promptInput = document.getElementById('promptInput');
const runPromptBtn = document.getElementById('runPrompt');
const summarySection = document.getElementById('summarySection');
const summaryContent = document.getElementById('summaryContent');
const presetBtns = document.querySelectorAll('.preset-btn');
const historySidebar = document.getElementById('historySidebar');
const historyToggle = document.getElementById('historyToggle');
const closeSidebar = document.getElementById('closeSidebar');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistory');
const youtubeUrlsList = document.getElementById('youtubeUrlsList');
const fetchYoutubeBtn = document.getElementById('fetchYoutubeBtn');
const metaadsUrlsList = document.getElementById('metaadsUrlsList');
const fetchMetaAdsBtn = document.getElementById('fetchMetaAdsBtn');
const tabBtns = document.querySelectorAll('.tab-btn');
const settingsSidebar = document.getElementById('settingsSidebar');
const settingsToggle = document.getElementById('settingsToggle');
const closeSettings = document.getElementById('closeSettings');
const timestampsToggle = document.getElementById('timestampsToggle');

let uploadQueue = [];
let transcriptions = [];
let summaries = [];

// ==================== SETTINGS MANAGEMENT ====================
const SETTINGS_KEY = 'vt_settings';

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { timestamps: false };
  } catch {
    return { timestamps: false };
  }
}

function updateSetting(key, value) {
  const settings = getSettings();
  settings[key] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Initialize settings UI
timestampsToggle.checked = getSettings().timestamps;
timestampsToggle.addEventListener('change', () => {
  updateSetting('timestamps', timestampsToggle.checked);
});

// Settings sidebar toggle
settingsToggle.addEventListener('click', () => settingsSidebar.classList.add('open'));
closeSettings.addEventListener('click', () => settingsSidebar.classList.remove('open'));

// ==================== HISTORY MANAGEMENT ====================
const HISTORY_KEY = 'vt_history';
const MAX_HISTORY_ITEMS = 20;

// ==================== SAVED PROMPTS ====================
const SAVED_PROMPTS_KEY = 'vt_saved_prompts';

function getSavedPrompts() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_PROMPTS_KEY)) || [];
  } catch {
    return [];
  }
}

function generatePromptName(promptText) {
  // Extract key words from the prompt to generate a 1-3 word name
  const stopWords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'it', 'its', 'my', 'your', 'his', 'her', 'their', 'our', 'me', 'you', 'him', 'them', 'us', 'i'];

  const words = promptText.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word));

  // Get first 2-3 meaningful words
  const nameWords = words.slice(0, 3);
  if (nameWords.length === 0) return 'Custom Prompt';

  return nameWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function savePrompt(promptText, customName = null) {
  const prompts = getSavedPrompts();
  const name = customName || generatePromptName(promptText);

  prompts.push({
    id: Date.now().toString(),
    name: name,
    prompt: promptText,
    createdAt: new Date().toISOString()
  });

  localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(prompts));
  renderSavedPrompts();
}

function deletePrompt(id) {
  const prompts = getSavedPrompts();
  const index = prompts.findIndex(p => p.id === id);
  if (index > -1) {
    prompts.splice(index, 1);
    localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(prompts));
    renderSavedPrompts();
  }
}

function renamePrompt(id, newName) {
  const prompts = getSavedPrompts();
  const prompt = prompts.find(p => p.id === id);
  if (prompt && newName && newName.trim()) {
    prompt.name = newName.trim();
    localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(prompts));
    renderSavedPrompts();
  }
}

function renderSavedPrompts() {
  const container = document.getElementById('savedPromptsContainer');
  if (!container) return;

  const prompts = getSavedPrompts();

  container.innerHTML = prompts.map(p => `
    <div class="saved-prompt-btn" data-id="${p.id}" data-prompt="${p.prompt.replace(/"/g, '&quot;')}" title="Double-click to edit">
      <span class="prompt-name">${p.name}</span>
    </div>
  `).join('');

  // Add click and double-click listeners for saved prompts
  container.querySelectorAll('.saved-prompt-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Remove active from all preset and saved buttons
      document.querySelectorAll('.preset-btn, .saved-prompt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePromptId = btn.dataset.id;

      // Load prompt content (might be empty for new prompts)
      const promptContent = btn.dataset.prompt;
      if (promptContent) {
        promptInput.value = promptContent;
      } else {
        promptInput.value = '';
        promptInput.placeholder = 'Your prompt goes here...';
      }
    });

    btn.addEventListener('dblclick', (e) => {
      e.preventDefault();
      openPromptEditModal(btn.dataset.id);
    });
  });
}

// Prompt edit modal
const promptEditModalHTML = `
<div id="promptEditModal" class="modal-overlay" style="display: none;">
  <div class="modal-content" style="max-width: 360px;">
    <div class="modal-header">
      <h3>Edit Prompt</h3>
      <button class="modal-close" onclick="closePromptEditModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div class="time-input-group" style="width: 100%;">
        <label>Name</label>
        <input type="text" id="promptEditName" style="width: 100%; padding: 8px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 0.875rem; font-family: inherit;">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="promptEditDelete" style="margin-right: auto; color: var(--error);">Delete</button>
      <button class="btn-secondary" onclick="closePromptEditModal()">Cancel</button>
      <button class="btn-primary" id="promptEditSave">Save</button>
    </div>
  </div>
</div>
`;
document.body.insertAdjacentHTML('beforeend', promptEditModalHTML);

let promptEditId = null;

function openPromptEditModal(id) {
  const prompts = getSavedPrompts();
  const prompt = prompts.find(p => p.id === id);
  if (!prompt) return;

  promptEditId = id;
  document.getElementById('promptEditName').value = prompt.name;
  document.getElementById('promptEditModal').style.display = 'flex';
  document.getElementById('promptEditName').focus();
}

window.closePromptEditModal = function() {
  document.getElementById('promptEditModal').style.display = 'none';
  promptEditId = null;
};

document.getElementById('promptEditSave').addEventListener('click', () => {
  if (!promptEditId) return;
  const newName = document.getElementById('promptEditName').value.trim();
  if (newName) {
    renamePrompt(promptEditId, newName);
  }
  closePromptEditModal();
});

document.getElementById('promptEditDelete').addEventListener('click', () => {
  if (!promptEditId) return;
  deletePrompt(promptEditId);
  if (activePromptId === promptEditId) activePromptId = null;
  closePromptEditModal();
});

document.getElementById('promptEditName').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('promptEditSave').click();
  }
});

// Track currently active saved prompt ID (for updating on run)
let activePromptId = null;

// Initialize saved prompts on load
document.addEventListener('DOMContentLoaded', () => {
  renderSavedPrompts();

  // Add listener for New Prompt button - creates a new saved prompt tag
  const newPromptBtn = document.getElementById('newPromptBtn');
  if (newPromptBtn) {
    newPromptBtn.addEventListener('click', (e) => {
      e.preventDefault();

      // Remove focus from the New button immediately
      newPromptBtn.blur();

      // Create a new saved prompt with placeholder name
      const newId = Date.now().toString();
      const prompts = getSavedPrompts();

      prompts.push({
        id: newId,
        name: 'New Prompt',
        prompt: '',
        createdAt: new Date().toISOString()
      });

      localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(prompts));

      // Re-render saved prompts
      renderSavedPrompts();

      // Deselect all buttons first
      document.querySelectorAll('.preset-btn, .saved-prompt-btn').forEach(b => b.classList.remove('active'));

      // Select the newly created prompt (use setTimeout to ensure DOM is updated)
      setTimeout(() => {
        const newBtn = document.querySelector(`.saved-prompt-btn[data-id="${newId}"]`);
        if (newBtn) {
          newBtn.classList.add('active');
          activePromptId = newId;

          // Clear the textarea and focus
          promptInput.value = '';
          promptInput.placeholder = 'Your prompt goes here...';
          promptInput.focus();
        }
      }, 10);
    });
  }
});

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveToHistory(session) {
  const history = getHistory();
  history.unshift(session);
  // Keep only last MAX_HISTORY_ITEMS
  if (history.length > MAX_HISTORY_ITEMS) {
    history.splice(MAX_HISTORY_ITEMS);
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function getSourceIcon(source) {
  switch (source) {
    case 'youtube':
      return `<svg class="source-icon youtube" viewBox="0 0 24 24" fill="currentColor" title="YouTube">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>`;
    case 'metaads':
      return `<svg class="source-icon meta" viewBox="0 0 24 24" fill="currentColor" title="Meta Ads">
        <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02z"/>
      </svg>`;
    default:
      return `<svg class="source-icon file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" title="Uploaded File">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>`;
  }
}

function getSessionSources(session) {
  // Get unique sources from session videos
  const sources = new Set();
  if (session.videos) {
    session.videos.forEach(v => {
      sources.add(v.source || 'file');
    });
  }
  return Array.from(sources);
}

function renderHistory() {
  const history = getHistory();
  if (history.length === 0) {
    historyList.innerHTML = '<p class="empty-history">No history yet. Complete a transcription to see it here.</p>';
    return;
  }

  historyList.innerHTML = history.map((session, idx) => {
    const date = new Date(session.date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const displayName = session.name || session.videos.map(v => v.filename).join(', ');
    const truncated = displayName.length > 40 ? displayName.substring(0, 40) + '...' : displayName;
    const sources = getSessionSources(session);
    const sourceIcons = sources.map(s => getSourceIcon(s)).join('');

    return `
      <div class="history-item">
        <div class="history-item-header" onclick="loadHistorySession(${idx})">
          <div class="history-item-meta">
            <div class="history-item-date">${date}</div>
            <div class="history-source-icons">${sourceIcons}</div>
          </div>
          <div class="history-item-videos">${truncated}</div>
        </div>
        <div class="history-item-actions">
          <button class="btn-icon" onclick="renameHistorySession(${idx}); event.stopPropagation();" title="Rename">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
            </svg>
          </button>
          <button class="btn-icon" onclick="deleteHistorySession(${idx}); event.stopPropagation();" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

window.loadHistorySession = function(idx) {
  const history = getHistory();
  const session = history[idx];
  if (!session) return;

  transcriptions = session.videos.map(v => ({
    filename: v.filename,
    transcription: v.transcription,
    videoId: v.videoId,
    source: v.source,
    isLive: v.isLive
  }));
  summaries = session.summaries || [];

  // Hide upload section and queue when loading previous session
  document.querySelector('.upload-section').style.display = 'none';
  queueSection.classList.remove('visible');

  renderResults();
  if (summaries.length > 0) {
    renderSummaries();
    summarySection.classList.add('visible');
  }

  historySidebar.classList.remove('open');
};

window.deleteHistorySession = function(idx) {
  if (!confirm('Delete this session from history?')) return;
  const history = getHistory();
  history.splice(idx, 1);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
};

window.renameHistorySession = function(idx) {
  const history = getHistory();
  const session = history[idx];
  if (!session) return;
  const currentName = session.name || session.videos.map(v => v.filename).join(', ');
  const newName = prompt('Rename session:', currentName);
  if (newName && newName.trim()) {
    session.name = newName.trim();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
  }
};

// Sidebar toggle
historyToggle.addEventListener('click', () => historySidebar.classList.add('open'));
closeSidebar.addEventListener('click', () => historySidebar.classList.remove('open'));
clearHistoryBtn.addEventListener('click', () => {
  if (confirm('Clear all history?')) clearHistory();
});

// Initialize history on load
renderHistory();

// ==================== TAB SWITCHING ====================
let currentTab = 'upload'; // Track current tab

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab;

    // If switching to a different tab and we have transcriptions, save to history and clear
    if (tabName !== currentTab && transcriptions.length > 0) {
      // Save current session to history
      saveToHistory({
        id: Date.now(),
        date: new Date().toISOString(),
        videos: transcriptions.map(t => ({
          filename: t.filename,
          transcription: t.transcription,
          videoId: t.videoId,
          source: t.source || 'file',
          isLive: t.isLive || false
        })),
        summaries: summaries.map(s => ({
          filename: s.filename,
          prompt: s.prompt || '',
          summary: s.summary
        }))
      });

      // Clear current session
      transcriptions = [];
      summaries = [];
      uploadQueue = [];

      // Hide results and summary sections
      resultsSection.classList.remove('visible');
      summarySection.classList.remove('visible');
      queueSection.classList.remove('visible');

      // Clear the queue list
      queueList.innerHTML = '';
    }

    currentTab = tabName;
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(tabName + 'Tab').classList.add('active');
  });
});

// ==================== YOUTUBE TRANSCRIPT ====================
let youtubeUrlIndex = 0;

function createYoutubeInputRow(index) {
  const row = document.createElement('div');
  row.className = 'youtube-input-row';
  row.dataset.index = index;
  row.innerHTML = `
    <div class="youtube-input-wrapper">
      <svg class="youtube-icon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
      <input type="text" class="youtube-url-input" placeholder="Paste YouTube URL here..." autocomplete="off">
      <button class="remove-url-btn" onclick="removeYoutubeUrl(${index})" title="Remove">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `;
  return row;
}

function setupYoutubeInputListeners() {
  youtubeUrlsList.addEventListener('input', (e) => {
    if (!e.target.classList.contains('youtube-url-input')) return;

    const rows = youtubeUrlsList.querySelectorAll('.youtube-input-row');
    const lastRow = rows[rows.length - 1];
    const lastInput = lastRow.querySelector('.youtube-url-input');

    // If the last input has a value, add a new row
    if (lastInput.value.trim() && e.target === lastInput) {
      youtubeUrlIndex++;
      const newRow = createYoutubeInputRow(youtubeUrlIndex);
      youtubeUrlsList.appendChild(newRow);
      updateRemoveButtons();
    }
  });

  youtubeUrlsList.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('youtube-url-input')) {
      e.preventDefault();
      fetchYoutubeTranscripts();
    }
  });
}

function updateRemoveButtons() {
  const rows = youtubeUrlsList.querySelectorAll('.youtube-input-row');
  rows.forEach((row, i) => {
    const removeBtn = row.querySelector('.remove-url-btn');
    if (removeBtn) {
      // Hide remove button if it's the only row or the last empty row
      removeBtn.style.display = rows.length <= 1 ? 'none' : 'flex';
    }
  });
}

window.removeYoutubeUrl = function(index) {
  const row = youtubeUrlsList.querySelector(`[data-index="${index}"]`);
  if (row) {
    row.remove();
    updateRemoveButtons();
  }
};

setupYoutubeInputListeners();
updateRemoveButtons();

fetchYoutubeBtn.addEventListener('click', fetchYoutubeTranscripts);

// ==================== META ADS TRANSCRIPT ====================
let metaadsUrlIndex = 0;

function createMetaAdsInputRow(index) {
  const row = document.createElement('div');
  row.className = 'metaads-input-row';
  row.dataset.index = index;
  row.innerHTML = `
    <div class="metaads-input-wrapper">
      <svg class="meta-icon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02z"/>
      </svg>
      <input type="text" class="metaads-url-input" placeholder="Paste Meta Ad Library URL here..." autocomplete="off">
      <button class="remove-url-btn" onclick="removeMetaAdsUrl(${index})" title="Remove">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `;
  return row;
}

function setupMetaAdsInputListeners() {
  metaadsUrlsList.addEventListener('input', (e) => {
    if (!e.target.classList.contains('metaads-url-input')) return;

    const rows = metaadsUrlsList.querySelectorAll('.metaads-input-row');
    const lastRow = rows[rows.length - 1];
    const lastInput = lastRow.querySelector('.metaads-url-input');

    // If the last input has a value, add a new row
    if (lastInput.value.trim() && e.target === lastInput) {
      metaadsUrlIndex++;
      const newRow = createMetaAdsInputRow(metaadsUrlIndex);
      metaadsUrlsList.appendChild(newRow);
      updateMetaAdsRemoveButtons();
    }
  });

  metaadsUrlsList.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('metaads-url-input')) {
      e.preventDefault();
      fetchMetaAdsTranscripts();
    }
  });
}

function updateMetaAdsRemoveButtons() {
  const rows = metaadsUrlsList.querySelectorAll('.metaads-input-row');
  rows.forEach((row) => {
    const removeBtn = row.querySelector('.remove-url-btn');
    if (removeBtn) {
      removeBtn.style.display = rows.length <= 1 ? 'none' : 'flex';
    }
  });
}

window.removeMetaAdsUrl = function(index) {
  const row = metaadsUrlsList.querySelector(`[data-index="${index}"]`);
  if (row) {
    row.remove();
    updateMetaAdsRemoveButtons();
  }
};

setupMetaAdsInputListeners();
updateMetaAdsRemoveButtons();

fetchMetaAdsBtn.addEventListener('click', fetchMetaAdsTranscripts);

async function fetchMetaAdsTranscripts() {
  const inputs = metaadsUrlsList.querySelectorAll('.metaads-url-input');
  const urls = Array.from(inputs)
    .map(input => input.value.trim())
    .filter(url => url.length > 0);

  if (urls.length === 0) return;

  // Validate all URLs - Meta Ad Library format
  const metaAdsRegex = /^(https?:\/\/)?(www\.)?facebook\.com\/ads\/library\/?\?.*id=\d+/;
  const invalidUrls = urls.filter(url => !metaAdsRegex.test(url));
  if (invalidUrls.length > 0) {
    alert(`Invalid Meta Ad Library URL(s):\n${invalidUrls.join('\n')}\n\nExpected format: https://www.facebook.com/ads/library/?id=XXXXXXXXX`);
    return;
  }

  fetchMetaAdsBtn.disabled = true;
  fetchMetaAdsBtn.innerHTML = `<span class="spinner"></span> Fetching ${urls.length} ad${urls.length > 1 ? 's' : ''}...`;

  let successCount = 0;
  let errors = [];

  for (const url of urls) {
    try {
      const response = await fetch('/api/metaads/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, timestamps: getSettings().timestamps })
      });

      if (!response.ok) {
        const error = await response.json();
        const errorMsg = error.suggestion ? `${error.error}\n\n${error.suggestion}` : error.error;
        throw new Error(errorMsg || 'Failed to fetch transcript');
      }

      const data = await response.json();

      // Use ad title, truncated if needed
      const displayTitle = truncateTitle(data.title || data.adId);

      // Add to transcriptions
      transcriptions.push({
        filename: displayTitle,
        transcription: data.transcript,
        videoId: data.adId,
        source: 'metaads',
        url: url
      });

      successCount++;
      renderResults();

    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }

  // Clear inputs and reset to single input
  metaadsUrlsList.innerHTML = '';
  metaadsUrlIndex = 0;
  metaadsUrlsList.appendChild(createMetaAdsInputRow(0));
  updateMetaAdsRemoveButtons();

  // Show results
  if (successCount > 0) {
    // Save to history
    saveToHistory({
      id: Date.now(),
      date: new Date().toISOString(),
      videos: transcriptions.map(t => ({
        filename: t.filename,
        transcription: t.transcription,
        videoId: t.videoId,
        source: t.source || 'file'
      })),
      summaries: []
    });
  }

  if (errors.length > 0) {
    alert(`Some ads failed:\n${errors.join('\n')}`);
  }

  fetchMetaAdsBtn.disabled = false;
  fetchMetaAdsBtn.innerHTML = '<span>Get Transcripts</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>';
}

function truncateTitle(title, maxLength = 50) {
  if (!title) return 'Untitled';
  if (title.length <= maxLength) return title;
  return title.substring(0, maxLength - 3) + '...';
}

// Poll a live stream transcription job for progress
async function pollLiveTranscription(jobId, updateButtonText) {
  let polls = 0;
  while (polls < 300) { // max ~10 minutes
    const response = await fetch(`/api/youtube/live-transcript-status/${jobId}`);
    if (!response.ok) throw new Error('Failed to check live transcription status');

    const data = await response.json();

    // Update button text with stage-specific messages
    if (updateButtonText) {
      updateButtonText(data.stageLabel || 'Processing...');
    }

    if (data.status === 'completed') {
      return data.result;
    }
    if (data.status === 'error') {
      throw new Error(data.error || 'Live transcription failed');
    }

    await new Promise(r => setTimeout(r, 2000));
    polls++;
  }
  throw new Error('Live transcription timed out');
}

async function fetchYoutubeTranscripts() {
  const inputs = youtubeUrlsList.querySelectorAll('.youtube-url-input');
  const urls = Array.from(inputs)
    .map(input => input.value.trim())
    .filter(url => url.length > 0);

  if (urls.length === 0) return;

  // Validate all URLs (supports watch, embed, v, live, and youtu.be formats)
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|live\/)|youtu\.be\/)[\w-]+/;
  const invalidUrls = urls.filter(url => !youtubeRegex.test(url));
  if (invalidUrls.length > 0) {
    alert(`Invalid YouTube URL(s):\n${invalidUrls.join('\n')}`);
    return;
  }

  fetchYoutubeBtn.disabled = true;
  fetchYoutubeBtn.innerHTML = `<span class="spinner"></span> Fetching ${urls.length} video${urls.length > 1 ? 's' : ''}...`;

  let successCount = 0;
  let errors = [];

  for (const url of urls) {
    try {
      const response = await fetch('/api/youtube/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, timestamps: getSettings().timestamps })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch transcript');
      }

      const data = await response.json();

      // Check if this is a live stream that needs async processing
      if (data.useAsyncJob) {
        // Start async live transcription job
        fetchYoutubeBtn.innerHTML = `<span class="spinner"></span> Detecting live stream...`;

        const startResponse = await fetch('/api/youtube/live-transcript-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, timestamps: getSettings().timestamps })
        });

        if (!startResponse.ok) {
          const error = await startResponse.json();
          throw new Error(error.error || 'Failed to start live transcription');
        }

        const { jobId } = await startResponse.json();

        // Poll for progress, updating button text
        const result = await pollLiveTranscription(jobId, (stageLabel) => {
          fetchYoutubeBtn.innerHTML = `<span class="spinner"></span> ${stageLabel}`;
        });

        const displayTitle = truncateTitle(result.title || result.videoId);

        transcriptions.push({
          filename: displayTitle,
          transcription: result.transcript,
          videoId: result.videoId,
          source: 'youtube',
          url: url,
          isLive: result.isLive
        });

        successCount++;
        renderResults();
        continue;
      }

      // Use video title, truncated if needed
      const displayTitle = truncateTitle(data.title || data.videoId);

      // Add to transcriptions
      transcriptions.push({
        filename: displayTitle,
        transcription: data.transcript,
        videoId: data.videoId,
        source: 'youtube',
        url: url
      });

      successCount++;
      renderResults();

    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }

  // Clear inputs and reset to single input
  youtubeUrlsList.innerHTML = '';
  youtubeUrlIndex = 0;
  youtubeUrlsList.appendChild(createYoutubeInputRow(0));
  updateRemoveButtons();

  // Show results
  if (successCount > 0) {
    // Save to history
    saveToHistory({
      id: Date.now(),
      date: new Date().toISOString(),
      videos: transcriptions.map(t => ({
        filename: t.filename,
        transcription: t.transcription,
        videoId: t.videoId,
        source: t.source || 'file'
      })),
      summaries: []
    });
  }

  if (errors.length > 0) {
    alert(`Some videos failed:\n${errors.join('\n')}`);
  }

  fetchYoutubeBtn.disabled = false;
  fetchYoutubeBtn.innerHTML = '<span>Get Transcripts</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>';
}

// ==================== FFMPEG ====================
let ffmpeg = null;
let ffmpegLoaded = false;
let ffmpegLoading = false;
let currentProgressCallback = null;

async function loadFFmpeg() {
  if (ffmpegLoaded) return true;
  if (ffmpegLoading) {
    while (ffmpegLoading) await new Promise(r => setTimeout(r, 100));
    return ffmpegLoaded;
  }
  ffmpegLoading = true;
  console.log('[FFmpeg] Loading...');
  try {
    const { FFmpeg } = FFmpegWASM;
    const { fetchFile } = FFmpegUtil;
    window.fetchFile = fetchFile;
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => console.log('[FFmpeg]', message));
    ffmpeg.on('progress', ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (currentProgressCallback) currentProgressCallback('extracting', pct);
    });
    await ffmpeg.load({ coreURL: '/ffmpeg/ffmpeg-core.js', wasmURL: '/ffmpeg/ffmpeg-core.wasm' });
    ffmpegLoaded = true;
    console.log('[FFmpeg] Loaded successfully');
    return true;
  } catch (err) {
    console.error('[FFmpeg] Failed to load:', err);
    return false;
  } finally {
    ffmpegLoading = false;
  }
}

let ffmpegQueue = Promise.resolve();

async function extractAudio(file, onProgress) {
  if (!file.type.startsWith('video/')) return file;
  const loaded = await loadFFmpeg();
  if (!loaded) return file;

  const extraction = ffmpegQueue.then(async () => {
    if (onProgress) onProgress('extracting', 0);
    currentProgressCallback = onProgress;
    const uniqueId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const inputName = `input_${uniqueId}.mp4`;
    const outputName = `output_${uniqueId}.mp3`;
    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', '-y', outputName]);
      const data = await ffmpeg.readFile(outputName);
      const audioFile = new File([new Blob([data.buffer], { type: 'audio/mpeg' })], file.name.replace(/\.[^/.]+$/, '.mp3'), { type: 'audio/mpeg' });
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
      console.log(`[FFmpeg] Extracted: ${formatSize(file.size)} → ${formatSize(audioFile.size)}`);
      currentProgressCallback = null;
      if (onProgress) onProgress('extracting', 100);
      return audioFile;
    } catch (err) {
      console.error('[FFmpeg] Extraction failed:', err);
      currentProgressCallback = null;
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
      return file;
    }
  });
  ffmpegQueue = extraction.catch(() => {});
  return extraction;
}

// ==================== DROPZONE ====================
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.size > 0);
  if (files.length > 0) await handleFiles(files);
});
fileInput.addEventListener('change', async (e) => {
  await handleFiles(Array.from(e.target.files));
  fileInput.value = '';
});

function generateThumbnail(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('video/') || file.size === 0) { resolve(null); return; }
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    video.preload = 'metadata'; video.muted = true; video.playsInline = true;
    const timeout = setTimeout(() => { URL.revokeObjectURL(video.src); resolve(null); }, 5000);
    video.onloadeddata = () => video.currentTime = Math.min(1, video.duration * 0.1);
    video.onseeked = () => {
      clearTimeout(timeout);
      canvas.width = 80; canvas.height = 45;
      canvas.getContext('2d').drawImage(video, 0, 0, 80, 45);
      URL.revokeObjectURL(video.src);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    video.onerror = () => { clearTimeout(timeout); URL.revokeObjectURL(video.src); resolve(null); };
    video.src = URL.createObjectURL(file);
  });
}

async function handleFiles(files) {
  for (const file of files) {
    if (file.size === 0) continue;
    const isMedia = file.type.startsWith('video/') || file.type.startsWith('audio/') || file.name.match(/\.(mp4|webm|mov|avi|mkv|mp3|wav|m4a|aac|ogg)$/i);
    if (isMedia) {
      const thumbnail = await generateThumbnail(file);
      uploadQueue.push({ id: Date.now() + Math.random(), file, thumbnail, status: 'pending', stage: null, progress: 0 });
    }
  }
  renderQueue();
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getStageLabel(stage) {
  return { extracting: 'Extracting audio', uploading: 'Uploading', queued: 'Queued', transcribing: 'Transcribing', done: 'Done' }[stage] || 'Processing';
}

function renderQueue() {
  if (uploadQueue.length === 0) { queueSection.classList.remove('visible'); return; }
  queueSection.classList.add('visible');
  queueList.innerHTML = uploadQueue.map(item => {
    const isProcessing = item.status === 'processing';
    const statusDisplay = isProcessing ? `<span class="status-stage">${getStageLabel(item.stage)}: ${item.progress}%</span>` : `<span class="status-badge ${item.status}">${item.status}</span>`;
    return `
      <div class="queue-item" data-id="${item.id}">
        <div class="queue-item-info">
          <div class="queue-item-thumbnail">${item.thumbnail ? `<img src="${item.thumbnail}">` : `<div class="audio-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`}</div>
          <div class="queue-item-details"><span class="queue-item-name">${item.file.name}</span><span class="queue-item-size">${formatSize(item.file.size)}</span></div>
        </div>
        <div class="queue-item-right">
          ${isProcessing ? `<div class="progress-container"><div class="progress-bar"><div class="progress-fill" style="width:${item.progress}%"></div></div></div>` : ''}
          <div class="queue-item-status">${statusDisplay}${item.status === 'pending' ? `<button class="remove-btn" onclick="removeFromQueue(${item.id})"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}</div>
        </div>
      </div>`;
  }).join('');
  transcribeAllBtn.disabled = !uploadQueue.some(i => i.status === 'pending') || uploadQueue.some(i => i.status === 'processing');
}

window.removeFromQueue = function(id) {
  uploadQueue = uploadQueue.filter(i => i.id !== id);
  renderQueue();
};

// ==================== TRANSCRIPTION ====================
function uploadWithProgress(item) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    const fileToUpload = item.fileToUpload || item.file;
    formData.append('video', fileToUpload, fileToUpload.name);
    formData.append('timestamps', getSettings().timestamps ? 'true' : 'false');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { item.stage = 'uploading'; item.progress = Math.round((e.loaded / e.total) * 100); renderQueue(); } };
    xhr.onload = () => xhr.status === 200 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(JSON.parse(xhr.responseText)?.error || 'Upload failed'));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.open('POST', '/api/transcribe/start');
    xhr.send(formData);
  });
}

async function pollTranscriptionStatus(item, jobId) {
  let polls = 0;
  while (polls < 600) {
    const response = await fetch(`/api/transcribe/status/${jobId}`);
    const data = await response.json();
    item.stage = data.stage; item.progress = data.progress; renderQueue();
    if (data.status === 'completed') return data;
    if (data.status === 'error') throw new Error(data.error || 'Transcription failed');
    await new Promise(r => setTimeout(r, 2000));
    polls++;
  }
  throw new Error('Transcription timed out');
}

async function transcribeVideo(item) {
  try {
    let fileToUpload = item.file;
    if (item.file.type.startsWith('video/')) {
      item.stage = 'extracting'; item.progress = 0; renderQueue();
      fileToUpload = await extractAudio(item.file, (stage, progress) => { item.stage = stage; item.progress = progress; renderQueue(); });
    }
    item.fileToUpload = fileToUpload;
    item.stage = 'uploading'; item.progress = 0; renderQueue();
    const uploadResult = await uploadWithProgress(item);
    item.stage = 'queued'; item.progress = 0; renderQueue();
    const result = await pollTranscriptionStatus(item, uploadResult.jobId);
    item.status = 'done'; item.videoId = result.videoId;
    transcriptions.push({ filename: result.filename, transcription: result.transcription, videoId: result.videoId });
    return { success: true };
  } catch (error) {
    item.status = 'error'; item.error = error.message;
    return { success: false, error };
  }
}

transcribeAllBtn.addEventListener('click', async () => {
  const pendingItems = uploadQueue.filter(i => i.status === 'pending');
  if (!pendingItems.length) return;
  transcribeAllBtn.disabled = true;
  transcribeAllBtn.innerHTML = '<span class="spinner"></span> Transcribing...';
  pendingItems.forEach(item => { item.status = 'processing'; item.stage = 'extracting'; item.progress = 0; });
  renderQueue();
  const promises = pendingItems.map(item => transcribeVideo(item));
  promises.forEach(p => p.then(() => { renderQueue(); renderResults(); }));
  await Promise.all(promises);

  // Save to history
  if (transcriptions.length > 0) {
    saveToHistory({
      id: Date.now(),
      date: new Date().toISOString(),
      videos: transcriptions.map(t => ({ filename: t.filename, transcription: t.transcription, videoId: t.videoId, source: t.source || 'file', isLive: t.isLive || false })),
      summaries: []
    });
  }

  transcribeAllBtn.disabled = false;
  transcribeAllBtn.innerHTML = '<span>Transcribe All</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
});

// ==================== RESULTS ====================
function renderResults() {
  if (!transcriptions.length) { resultsSection.classList.remove('visible'); return; }
  resultsSection.classList.add('visible');
  const hasMultiple = transcriptions.length > 1;
  const downloadableVideos = transcriptions.filter(t => (t.source === 'youtube' || t.source === 'metaads') && t.videoId);
  const downloadTranscriptsBtn = hasMultiple ? `<button class="btn-icon-text" onclick="downloadAllTranscriptsZip(event)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download Transcripts</button>` : '';
  const downloadVideosBtn = downloadableVideos.length > 0 ? `<button class="btn-icon-text" onclick="downloadAllVideos(event)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10 8 16 12 10 16 10 8"/></svg>Download Videos</button>` : '';
  resultsList.innerHTML = `
    <div class="results-header"><span class="results-count">${transcriptions.length} transcription${transcriptions.length > 1 ? 's' : ''}</span><div class="header-buttons">${downloadTranscriptsBtn}${downloadVideosBtn}</div></div>
    ${transcriptions.map((item, i) => `
    <div class="result-item ${i === 0 ? 'expanded' : ''}" data-index="${i}">
      <div class="result-header" onclick="toggleResult(${i})">
        <span class="result-title">${item.filename}</span>${item.isLive ? '<span class="live-badge">LIVE</span>' : ''}
        ${item.url ? `<a href="${item.url}" target="_blank" rel="noopener" class="result-url-btn" onclick="event.stopPropagation()" title="Open original"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : ''}
        <svg class="result-toggle" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="result-content">
        <div class="result-actions">
          <button class="btn-icon" onclick="copyText(${i}, 'transcript', event)" title="Copy"><svg class="icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg class="icon-success" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>
          <button class="btn-icon" onclick="downloadText(${i}, 'transcript', event)" title="Download Transcript"><svg class="icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><svg class="icon-success" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>
          ${item.source === 'youtube' && item.videoId ? `<button class="btn-icon" onclick="downloadVideo(${i}, event)" title="Download Video"><svg class="icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10 8 16 12 10 16 10 8"/></svg><svg class="icon-success" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button><button class="btn-icon" onclick="openClipModal(${i}, event)" title="Create Clips"><svg class="icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg><svg class="icon-success" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>` : ''}
          ${item.source === 'metaads' && item.videoId ? `<button class="btn-icon" onclick="downloadMetaAdVideo(${i}, event)" title="Download Video"><svg class="icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10 8 16 12 10 16 10 8"/></svg><svg class="icon-success" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button><button class="btn-icon" onclick="openClipModal(${i}, event)" title="Create Clips"><svg class="icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg><svg class="icon-success" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>` : ''}
        </div>
        <div class="transcription-text">${item.transcription}</div>
      </div>
    </div>`).join('')}`;
}

window.toggleResult = (i) => resultsList.querySelector(`[data-index="${i}"]`).classList.toggle('expanded');
window.toggleSummary = (i) => document.querySelector(`.summary-item[data-index="${i}"]`).classList.toggle('expanded');

// ==================== COPY & DOWNLOAD ====================
function showSuccess(btn) {
  btn.classList.add('success');
  setTimeout(() => btn.classList.remove('success'), 2000);
}

window.copyText = async function(index, type, event) {
  event.stopPropagation();
  const btn = event.currentTarget;
  const item = type === 'transcript' ? transcriptions[index] : summaries[index];
  if (!item) return;
  const text = type === 'transcript' ? item.transcription : item.summary;
  try {
    await navigator.clipboard.writeText(text);
    showSuccess(btn);
  } catch (err) {
    // Fallback for older browsers or permission issues
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showSuccess(btn);
  }
};

window.downloadText = function(index, type, event) {
  event.stopPropagation();
  const item = type === 'transcript' ? transcriptions[index] : summaries[index];
  if (!item) return;
  const text = type === 'transcript' ? item.transcription : item.summary;
  const suffix = type === 'transcript' ? '_transcript' : '_summary';
  downloadFile(text, item.filename.replace(/\.[^/.]+$/, '') + suffix + '.txt');
  showSuccess(event.currentTarget);
};

window.downloadVideo = async function(index, event) {
  event.stopPropagation();
  const item = transcriptions[index];
  if (!item || !item.videoId || item.source !== 'youtube') return;

  const btn = event.currentTarget;
  const originalHTML = btn.innerHTML;

  // Show spinner
  btn.innerHTML = '<svg class="spinner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg>';
  btn.disabled = true;

  try {
    // Start the download job
    const startResponse = await fetch(`/api/youtube/download-start/${item.videoId}`, { method: 'POST' });
    if (!startResponse.ok) {
      const error = await startResponse.json().catch(() => ({ error: 'Failed to start download' }));
      throw new Error(error.error);
    }
    const { jobId } = await startResponse.json();
    console.log('[Download] Job started:', jobId);

    // Poll for completion (works even when tab is in background)
    let elapsed = 0;
    while (true) {
      await new Promise(r => setTimeout(r, 2000)); // Poll every 2 seconds
      elapsed += 2;

      const statusResponse = await fetch(`/api/youtube/download-status/${jobId}`);
      if (!statusResponse.ok) {
        throw new Error('Failed to check download status');
      }

      const status = await statusResponse.json();

      if (status.status === 'ready') {
        console.log('[Download] Ready:', status.filename, `(${(status.fileSize / 1024 / 1024).toFixed(1)}MB)`);

        // Download the file
        const fileResponse = await fetch(`/api/youtube/download-file/${jobId}`);
        if (!fileResponse.ok) {
          throw new Error('Failed to download file');
        }

        const blob = await fileResponse.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = status.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        break;
      } else if (status.status === 'failed') {
        throw new Error(status.error || 'Download failed');
      }

      // Timeout after 10 minutes
      if (elapsed > 600) {
        throw new Error('Download timed out');
      }
    }

    btn.innerHTML = originalHTML;
    btn.disabled = false;
    showSuccess(btn);
  } catch (error) {
    console.error('[Download] Error:', error.message);
    btn.innerHTML = originalHTML;
    btn.disabled = false;
    alert('Download failed: ' + error.message);
  }
};

window.downloadMetaAdVideo = async function(index, event) {
  event.stopPropagation();
  const item = transcriptions[index];
  if (!item || !item.videoId || item.source !== 'metaads') return;

  const btn = event.currentTarget;
  const originalHTML = btn.innerHTML;

  // Show spinner
  btn.innerHTML = '<svg class="spinner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg>';
  btn.disabled = true;

  try {
    // Start the download job
    const startResponse = await fetch(`/api/metaads/download-start/${item.videoId}`, { method: 'POST' });
    if (!startResponse.ok) {
      const error = await startResponse.json().catch(() => ({ error: 'Failed to start download' }));
      throw new Error(error.error);
    }
    const { jobId } = await startResponse.json();
    console.log('[Download Meta Ad] Job started:', jobId);

    // Poll for completion (works even when tab is in background)
    let elapsed = 0;
    while (true) {
      await new Promise(r => setTimeout(r, 2000)); // Poll every 2 seconds
      elapsed += 2;

      const statusResponse = await fetch(`/api/metaads/download-status/${jobId}`);
      if (!statusResponse.ok) {
        throw new Error('Failed to check download status');
      }

      const status = await statusResponse.json();

      if (status.status === 'ready') {
        console.log('[Download Meta Ad] Ready:', status.filename, `(${(status.fileSize / 1024 / 1024).toFixed(1)}MB)`);

        // Download the file
        const fileResponse = await fetch(`/api/metaads/download-file/${jobId}`);
        if (!fileResponse.ok) {
          throw new Error('Failed to download file');
        }

        const blob = await fileResponse.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = status.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        break;
      } else if (status.status === 'failed') {
        throw new Error(status.error || 'Download failed');
      }

      // Timeout after 10 minutes
      if (elapsed > 600) {
        throw new Error('Download timed out');
      }
    }

    btn.innerHTML = originalHTML;
    btn.disabled = false;
    showSuccess(btn);
  } catch (error) {
    console.error('[Download Meta Ad] Error:', error.message);
    btn.innerHTML = originalHTML;
    btn.disabled = false;
    alert('Download failed: ' + error.message);
  }
};

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ZIP Downloads
window.downloadAllTranscriptsZip = async function(event) {
  event.stopPropagation();
  const btn = event.currentTarget;
  btn.disabled = true;
  const zip = new JSZip();
  const folder = zip.folder('transcripts');
  transcriptions.forEach(t => {
    const name = t.filename.replace(/\.[^/.]+$/, '') + '_transcript.txt';
    folder.file(name, t.transcription);
  });
  const content = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content);
  a.download = 'transcripts.zip';
  a.click();
  URL.revokeObjectURL(a.href);
  showSuccess(btn);
  btn.disabled = false;
};

window.downloadAllSummariesZip = async function(event) {
  event.stopPropagation();
  const btn = event.currentTarget;
  btn.disabled = true;
  const zip = new JSZip();
  const folder = zip.folder('summaries');
  summaries.forEach(s => {
    const name = s.filename.replace(/\.[^/.]+$/, '') + '_summary.txt';
    folder.file(name, s.summary);
  });
  const content = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content);
  a.download = 'summaries.zip';
  a.click();
  URL.revokeObjectURL(a.href);
  showSuccess(btn);
  btn.disabled = false;
};

window.downloadAllVideos = async function(event) {
  event.stopPropagation();
  const btn = event.currentTarget;
  const originalHTML = btn.innerHTML;
  btn.disabled = true;

  const downloadableVideos = transcriptions.filter(t => (t.source === 'youtube' || t.source === 'metaads') && t.videoId);
  let completed = 0;
  let failed = 0;

  // Show spinner with count
  const updateStatus = (current) => {
    btn.innerHTML = `<svg class="spinner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> ${current}/${downloadableVideos.length}`;
  };

  updateStatus(0);

  // Download videos sequentially using job queue
  for (let i = 0; i < downloadableVideos.length; i++) {
    const video = downloadableVideos[i];
    updateStatus(i + 1);

    // Determine API base path based on source
    const apiBase = video.source === 'metaads' ? '/api/metaads' : '/api/youtube';

    try {
      // Start download job
      const startResponse = await fetch(`${apiBase}/download-start/${video.videoId}`, { method: 'POST' });
      if (!startResponse.ok) throw new Error('Failed to start');
      const { jobId } = await startResponse.json();

      // Poll for completion
      let elapsed = 0;
      while (true) {
        await new Promise(r => setTimeout(r, 2000));
        elapsed += 2;

        const statusResponse = await fetch(`${apiBase}/download-status/${jobId}`);
        const status = await statusResponse.json();

        if (status.status === 'ready') {
          // Download the file
          const fileResponse = await fetch(`${apiBase}/download-file/${jobId}`);
          if (!fileResponse.ok) throw new Error('Failed to download');

          const blob = await fileResponse.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = status.filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          completed++;
          break;
        } else if (status.status === 'failed') {
          throw new Error(status.error);
        }

        if (elapsed > 600) throw new Error('Timeout');
      }
    } catch (e) {
      console.error(`[Download] Failed for ${video.videoId}:`, e.message);
      failed++;
    }
  }

  btn.innerHTML = originalHTML;
  btn.disabled = false;

  if (failed > 0) {
    alert(`Downloaded ${completed} videos. ${failed} failed.`);
  } else {
    showSuccess(btn);
  }
};

// ==================== PROMPTS ====================
presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active from all preset and saved buttons
    presetBtns.forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.saved-prompt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activePromptId = null; // Clear active saved prompt when selecting a preset
    if (btn.dataset.prompt === 'custom') { promptInput.value = ''; promptInput.focus(); }
    else promptInput.value = btn.dataset.prompt;
  });
});

runPromptBtn.addEventListener('click', async () => {
  if (!transcriptions.length) return;
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  // Update saved prompt if one is active and needs updating
  if (activePromptId) {
    const prompts = getSavedPrompts();
    const savedPrompt = prompts.find(p => p.id === activePromptId);
    if (savedPrompt) {
      // Update prompt content
      savedPrompt.prompt = prompt;

      // Auto-rename if still called "New Prompt"
      if (savedPrompt.name === 'New Prompt') {
        savedPrompt.name = generatePromptName(prompt);
      }

      localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(prompts));
      renderSavedPrompts();

      // Re-select the updated prompt
      setTimeout(() => {
        const updatedBtn = document.querySelector(`.saved-prompt-btn[data-id="${activePromptId}"]`);
        if (updatedBtn) {
          document.querySelectorAll('.preset-btn, .saved-prompt-btn').forEach(b => b.classList.remove('active'));
          updatedBtn.classList.add('active');
        }
      }, 0);
    }
  }

  runPromptBtn.disabled = true;
  runPromptBtn.innerHTML = '<span class="spinner"></span> Processing...';
  summaries = [];
  summarySection.classList.add('visible');
  summaryContent.innerHTML = '<div class="processing-message">Processing transcriptions...</div>';

  try {
    const promises = transcriptions.map(async (t, i) => {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcription: t.transcription, prompt, videoIds: [t.videoId] })
      });
      if (!response.ok) throw new Error('Summarization failed');
      const data = await response.json();
      return { filename: t.filename, summary: data.summary, index: i };
    });

    summaries = (await Promise.all(promises)).sort((a, b) => a.index - b.index);
    renderSummaries();

    // Update history with summaries
    const history = getHistory();
    if (history.length > 0) {
      history[0].summaries = summaries.map(s => ({ filename: s.filename, prompt, summary: s.summary }));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    summarySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    summaryContent.innerHTML = `<p style="color: var(--error);">Error: ${error.message}</p>`;
  } finally {
    runPromptBtn.disabled = false;
    runPromptBtn.innerHTML = '<span>Run Prompt</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  }
});

function renderSummaries() {
  const downloadAllBtn = summaries.length > 1 ? `<button class="btn-icon-text" onclick="downloadAllSummariesZip(event)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download All</button>` : '';
  summaryContent.innerHTML = `
    <div class="results-header"><span class="results-count">${summaries.length} result${summaries.length > 1 ? 's' : ''}</span>${downloadAllBtn}</div>
    ${summaries.map((item, i) => `
    <div class="summary-item ${i === 0 ? 'expanded' : ''}" data-index="${i}">
      <div class="summary-header" onclick="toggleSummary(${i})">
        <span class="summary-title">${item.filename}</span>
        <svg class="result-toggle" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="summary-body">
        <div class="result-actions">
          <button class="btn-icon" onclick="copyText(${i}, 'summary', event)" title="Copy"><svg class="icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg class="icon-success" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>
          <button class="btn-icon" onclick="downloadText(${i}, 'summary', event)" title="Download"><svg class="icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><svg class="icon-success" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>
        </div>
        <div class="summary-text">${marked.parse(item.summary)}</div>
      </div>
    </div>`).join('')}`;
}

// Markdown fallback
if (typeof marked === 'undefined') {
  window.marked = { parse: (t) => t.replace(/^### (.*$)/gim, '<h3>$1</h3>').replace(/^## (.*$)/gim, '<h2>$1</h2>').replace(/^# (.*$)/gim, '<h1>$1</h1>').replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>').replace(/\*(.*)\*/gim, '<em>$1</em>').replace(/^\- (.*$)/gim, '<li>$1</li>').replace(/\n\n/g, '</p><p>') };
}

// Pre-load FFmpeg
setTimeout(() => loadFFmpeg().then(loaded => { if (loaded) console.log('[FFmpeg] Pre-loaded'); }), 1000);

// ==================== CLIP MODAL ====================
let clipModalVideoId = null;
let clipModalVideoTitle = '';
let clipModalSource = null; // 'youtube' or 'metaads'

// Create modal HTML and append to body
const clipModalHTML = `
<div id="clipModal" class="modal-overlay" style="display: none;">
  <div class="modal-content">
    <div class="modal-header">
      <h3>Create Video Clips</h3>
      <button class="modal-close" onclick="closeClipModal()">&times;</button>
    </div>
    <div class="modal-body">
      <p class="modal-subtitle" id="clipModalTitle"></p>
      <div id="clipRanges">
        <div class="clip-range" data-index="0">
          <div class="clip-inputs">
            <div class="time-input-group">
              <label>Start</label>
              <input type="text" class="clip-start" placeholder="0:00" />
            </div>
            <span class="clip-separator">to</span>
            <div class="time-input-group">
              <label>End</label>
              <input type="text" class="clip-end" placeholder="1:30" />
            </div>
            <button class="btn-icon clip-remove" onclick="removeClipRange(0)" title="Remove" style="visibility: hidden;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>
      <button class="btn-secondary add-clip-btn" onclick="addClipRange()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Another Clip
      </button>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeClipModal()">Cancel</button>
      <button class="btn-primary" id="downloadClipsBtn" onclick="downloadClips()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download Clips
      </button>
    </div>
  </div>
</div>
`;
document.body.insertAdjacentHTML('beforeend', clipModalHTML);

window.openClipModal = function(index, event) {
  event.stopPropagation();
  const item = transcriptions[index];
  if (!item || !item.videoId) return;

  clipModalVideoId = item.videoId;
  clipModalVideoTitle = item.filename;
  clipModalSource = item.source || 'youtube';
  document.getElementById('clipModalTitle').textContent = item.filename;

  // Reset to single clip range
  const clipRanges = document.getElementById('clipRanges');
  clipRanges.innerHTML = `
    <div class="clip-range" data-index="0">
      <div class="clip-inputs">
        <div class="time-input-group">
          <label>Start</label>
          <input type="text" class="clip-start" placeholder="0:00" />
        </div>
        <span class="clip-separator">to</span>
        <div class="time-input-group">
          <label>End</label>
          <input type="text" class="clip-end" placeholder="1:30" />
        </div>
        <button class="btn-icon clip-remove" onclick="removeClipRange(0)" title="Remove" style="visibility: hidden;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `;

  document.getElementById('clipModal').style.display = 'flex';
};

window.closeClipModal = function() {
  document.getElementById('clipModal').style.display = 'none';
  clipModalVideoId = null;
  clipModalSource = null;
};

window.addClipRange = function() {
  const clipRanges = document.getElementById('clipRanges');
  const index = clipRanges.children.length;

  const newRange = document.createElement('div');
  newRange.className = 'clip-range';
  newRange.dataset.index = index;
  newRange.innerHTML = `
    <div class="clip-inputs">
      <div class="time-input-group">
        <label>Start</label>
        <input type="text" class="clip-start" placeholder="0:00" />
      </div>
      <span class="clip-separator">to</span>
      <div class="time-input-group">
        <label>End</label>
        <input type="text" class="clip-end" placeholder="1:30" />
      </div>
      <button class="btn-icon clip-remove" onclick="removeClipRange(${index})" title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;
  clipRanges.appendChild(newRange);

  // Show remove button on first clip if we have multiple
  if (clipRanges.children.length > 1) {
    clipRanges.querySelector('.clip-range[data-index="0"] .clip-remove').style.visibility = 'visible';
  }
};

window.removeClipRange = function(index) {
  const clipRanges = document.getElementById('clipRanges');
  const range = clipRanges.querySelector(`.clip-range[data-index="${index}"]`);
  if (range && clipRanges.children.length > 1) {
    range.remove();

    // Re-index remaining ranges
    Array.from(clipRanges.children).forEach((el, i) => {
      el.dataset.index = i;
      const removeBtn = el.querySelector('.clip-remove');
      removeBtn.setAttribute('onclick', `removeClipRange(${i})`);
    });

    // Hide remove button if only one left
    if (clipRanges.children.length === 1) {
      clipRanges.querySelector('.clip-remove').style.visibility = 'hidden';
    }
  }
};

window.downloadClips = async function() {
  if (!clipModalVideoId) return;

  const clipRanges = document.getElementById('clipRanges');
  const clips = [];

  // Validate and collect clip data
  const ranges = clipRanges.querySelectorAll('.clip-range');
  for (const range of ranges) {
    const start = range.querySelector('.clip-start').value.trim();
    const end = range.querySelector('.clip-end').value.trim();

    if (!start || !end) {
      alert('Please fill in all start and end times');
      return;
    }

    // Basic format validation
    const timeRegex = /^(\d+:)?(\d{1,2}):(\d{2})$|^(\d+)$/;
    if (!timeRegex.test(start) || !timeRegex.test(end)) {
      alert('Invalid time format. Use MM:SS or HH:MM:SS');
      return;
    }

    clips.push({ start, end });
  }

  const btn = document.getElementById('downloadClipsBtn');
  const originalHTML = btn.innerHTML;
  btn.disabled = true;

  const updateStatus = (msg) => {
    btn.innerHTML = `<svg class="spinner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> ${msg}`;
  };

  try {
    // Step 1: Download video through our server (bypasses CORS)
    updateStatus('Downloading video...');
    console.log('[Clips] Downloading video via server proxy...');

    // Use correct API based on source
    const apiBase = clipModalSource === 'metaads' ? '/api/metaads' : '/api/youtube';

    // Start download job
    const startResponse = await fetch(`${apiBase}/download-start/${clipModalVideoId}`, { method: 'POST' });
    if (!startResponse.ok) {
      throw new Error('Failed to start download');
    }
    const { jobId } = await startResponse.json();
    console.log('[Clips] Download job started:', jobId);

    // Poll for completion
    let videoBlob = null;
    let elapsed = 0;
    while (true) {
      await new Promise(r => setTimeout(r, 2000));
      elapsed += 2;

      const statusResponse = await fetch(`${apiBase}/download-status/${jobId}`);
      const status = await statusResponse.json();

      if (status.status === 'ready') {
        const fileResponse = await fetch(`${apiBase}/download-file/${jobId}`);
        if (!fileResponse.ok) throw new Error('Failed to download file');
        videoBlob = await fileResponse.blob();
        break;
      } else if (status.status === 'failed') {
        throw new Error(status.error || 'Download failed');
      }

      if (elapsed > 600) throw new Error('Download timed out');
    }

    console.log('[Clips] Video downloaded:', formatSize(videoBlob.size));

    // Step 3: Load FFmpeg
    updateStatus('Loading FFmpeg...');
    const loaded = await loadFFmpeg();
    if (!loaded) {
      throw new Error('Failed to load FFmpeg');
    }

    const { fetchFile } = FFmpegUtil;
    const inputName = 'input.mp4';
    const clipBlobs = [];

    // Write video to FFmpeg filesystem
    updateStatus('Processing video...');
    await ffmpeg.writeFile(inputName, await fetchFile(videoBlob));

    // Helper to convert time string to seconds
    const timeToSeconds = (time) => {
      const parts = time.split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0];
    };

    // Step 4: Create each clip
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const outputName = `clip_${i + 1}.mp4`;
      updateStatus(`Creating clip ${i + 1}/${clips.length}...`);

      // Calculate duration (end - start)
      const startSec = timeToSeconds(clip.start);
      const endSec = timeToSeconds(clip.end);
      const duration = endSec - startSec;

      console.log(`[Clips] Creating clip ${i + 1}: ${clip.start} to ${clip.end} (${duration}s)`);

      // FFmpeg command: -ss to seek, -t for duration, -map 0 to include all streams
      await ffmpeg.exec([
        '-ss', clip.start,
        '-i', inputName,
        '-t', duration.toString(),
        '-map', '0',
        '-c', 'copy',
        '-y', outputName
      ]);

      const clipData = await ffmpeg.readFile(outputName);
      const clipBlob = new Blob([clipData.buffer], { type: 'video/mp4' });
      clipBlobs.push({
        blob: clipBlob,
        start: clip.start.replace(/:/g, '-'),
        end: clip.end.replace(/:/g, '-')
      });

      // Clean up output file
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }

    // Clean up input file
    try { await ffmpeg.deleteFile(inputName); } catch {}

    // Step 5: Download clip(s)
    if (clipBlobs.length === 1) {
      // Single clip - download directly
      const url = URL.createObjectURL(clipBlobs[0].blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${clipModalVideoTitle}_${clipBlobs[0].start}_to_${clipBlobs[0].end}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      // Multiple clips - create zip
      updateStatus('Creating zip file...');
      const zip = new JSZip();
      for (let i = 0; i < clipBlobs.length; i++) {
        const { blob, start, end } = clipBlobs[i];
        const filename = `${clipModalVideoTitle}_clip${i + 1}_${start}_to_${end}.mp4`;
        zip.file(filename, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${clipModalVideoTitle}_clips.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    closeClipModal();
    console.log('[Clips] Done!');
  } catch (error) {
    console.error('[Clips] Error:', error);
    alert('Error: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
};

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

let uploadQueue = [];
let transcriptions = [];

// Dropzone handlers
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  fileInput.value = '';
});

function handleFiles(files) {
  for (const file of files) {
    if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
      uploadQueue.push({
        id: Date.now() + Math.random(),
        file,
        status: 'pending'
      });
    }
  }
  renderQueue();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderQueue() {
  if (uploadQueue.length === 0) {
    queueSection.classList.remove('visible');
    return;
  }

  queueSection.classList.add('visible');
  queueList.innerHTML = uploadQueue.map(item => `
    <div class="queue-item" data-id="${item.id}">
      <div class="queue-item-info">
        <span class="queue-item-name">${item.file.name}</span>
        <span class="queue-item-size">${formatSize(item.file.size)}</span>
      </div>
      <div class="queue-item-status">
        <span class="status-badge ${item.status}">${item.status}</span>
        ${item.status === 'pending' ? `
          <button class="remove-btn" onclick="removeFromQueue(${item.id})">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');

  // Update button state
  const hasPending = uploadQueue.some(item => item.status === 'pending');
  const hasProcessing = uploadQueue.some(item => item.status === 'processing');
  transcribeAllBtn.disabled = !hasPending || hasProcessing;
}

window.removeFromQueue = function(id) {
  uploadQueue = uploadQueue.filter(item => item.id !== id);
  renderQueue();
};

// Transcription
transcribeAllBtn.addEventListener('click', async () => {
  const pendingItems = uploadQueue.filter(item => item.status === 'pending');

  for (const item of pendingItems) {
    item.status = 'processing';
    renderQueue();

    try {
      const formData = new FormData();
      formData.append('video', item.file);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const data = await response.json();
      item.status = 'done';
      transcriptions.push({
        filename: data.filename,
        transcription: data.transcription
      });
      renderResults();
    } catch (error) {
      item.status = 'error';
      console.error('Error:', error);
    }

    renderQueue();
  }
});

function renderResults() {
  if (transcriptions.length === 0) {
    resultsSection.classList.remove('visible');
    return;
  }

  resultsSection.classList.add('visible');
  resultsList.innerHTML = transcriptions.map((item, index) => `
    <div class="result-item ${index === 0 ? 'expanded' : ''}" data-index="${index}">
      <div class="result-header" onclick="toggleResult(${index})">
        <span class="result-title">${item.filename}</span>
        <svg class="result-toggle" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="result-content">
        <div class="transcription-text">${item.transcription}</div>
      </div>
    </div>
  `).join('');
}

window.toggleResult = function(index) {
  const item = resultsList.querySelector(`[data-index="${index}"]`);
  item.classList.toggle('expanded');
};

// Preset prompts
presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    presetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    promptInput.value = btn.dataset.prompt;
  });
});

// Run prompt
runPromptBtn.addEventListener('click', async () => {
  if (transcriptions.length === 0) return;

  const prompt = promptInput.value.trim();
  if (!prompt) return;

  runPromptBtn.disabled = true;
  runPromptBtn.innerHTML = '<span class="spinner"></span> Processing...';

  try {
    // Combine all transcriptions
    const combinedTranscription = transcriptions
      .map(t => `## ${t.filename}\n\n${t.transcription}`)
      .join('\n\n---\n\n');

    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcription: combinedTranscription,
        prompt
      })
    });

    if (!response.ok) {
      throw new Error('Summarization failed');
    }

    const data = await response.json();
    summaryContent.innerHTML = marked.parse(data.summary);
    summarySection.classList.add('visible');
    summarySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('Error:', error);
    summaryContent.innerHTML = `<p style="color: var(--error);">Error: ${error.message}</p>`;
    summarySection.classList.add('visible');
  } finally {
    runPromptBtn.disabled = false;
    runPromptBtn.innerHTML = `
      <span>Run Prompt</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    `;
  }
});

// Simple markdown parser (fallback if marked.js not loaded)
if (typeof marked === 'undefined') {
  window.marked = {
    parse: (text) => {
      return text
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/^\- (.*$)/gim, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/^(.*)$/gim, (match) => {
          if (match.startsWith('<')) return match;
          return match;
        });
    }
  };
}

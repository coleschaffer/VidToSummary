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

dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');

  const files = Array.from(e.dataTransfer.files);

  // Check for 0-byte files (common when dragging from Chrome Downloads)
  const zeroByteFiles = files.filter(f => f.size === 0);
  if (zeroByteFiles.length > 0) {
    alert(`${zeroByteFiles.length} file(s) appear empty (0 bytes). This often happens when dragging directly from Chrome's download bar.\n\nPlease drag files from Finder/Explorer instead, or use the file picker.`);
  }

  // Only add files with actual content
  const validFiles = files.filter(f => f.size > 0);
  if (validFiles.length > 0) {
    await handleFiles(validFiles);
  }
});

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  await handleFiles(files);
  fileInput.value = '';
});

// Generate thumbnail from video file
function generateThumbnail(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('video/') || file.size === 0) {
      resolve(null);
      return;
    }

    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const timeout = setTimeout(() => {
      URL.revokeObjectURL(video.src);
      resolve(null);
    }, 5000);

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration * 0.1);
    };

    video.onseeked = () => {
      clearTimeout(timeout);
      canvas.width = 80;
      canvas.height = 45;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
      URL.revokeObjectURL(video.src);
      resolve(thumbnail);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(video.src);
      resolve(null);
    };

    video.src = URL.createObjectURL(file);
  });
}

async function handleFiles(files) {
  for (const file of files) {
    if (file.size === 0) continue;

    const isVideo = file.type.startsWith('video/') || file.name.match(/\.(mp4|webm|mov|avi|mkv)$/i);
    const isAudio = file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|aac|ogg)$/i);

    if (isVideo || isAudio) {
      const thumbnail = await generateThumbnail(file);
      uploadQueue.push({
        id: Date.now() + Math.random(),
        file,
        thumbnail,
        status: 'pending',
        stage: null,
        progress: 0
      });
    }
  }
  renderQueue();
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getStageLabel(stage) {
  switch (stage) {
    case 'uploading': return 'Uploading';
    case 'queued': return 'Queued';
    case 'transcribing': return 'Transcribing';
    case 'done': return 'Done';
    default: return 'Processing';
  }
}

function renderQueue() {
  if (uploadQueue.length === 0) {
    queueSection.classList.remove('visible');
    return;
  }

  queueSection.classList.add('visible');
  queueList.innerHTML = uploadQueue.map(item => {
    const isProcessing = item.status === 'processing';
    const statusDisplay = isProcessing
      ? `<span class="status-stage">${getStageLabel(item.stage)}: ${item.progress}%</span>`
      : `<span class="status-badge ${item.status}">${item.status}</span>`;

    return `
      <div class="queue-item" data-id="${item.id}">
        <div class="queue-item-info">
          <div class="queue-item-thumbnail">
            ${item.thumbnail
              ? `<img src="${item.thumbnail}" alt="thumbnail">`
              : `<div class="audio-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18V5l12-2v13"/>
                    <circle cx="6" cy="18" r="3"/>
                    <circle cx="18" cy="16" r="3"/>
                  </svg>
                </div>`
            }
          </div>
          <div class="queue-item-details">
            <span class="queue-item-name">${item.file.name}</span>
            <span class="queue-item-size">${formatSize(item.file.size)}</span>
          </div>
        </div>
        <div class="queue-item-right">
          ${isProcessing ? `
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${item.progress}%"></div>
              </div>
            </div>
          ` : ''}
          <div class="queue-item-status">
            ${statusDisplay}
            ${item.status === 'pending' ? `
              <button class="remove-btn" onclick="removeFromQueue(${item.id})">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Update button state
  const hasPending = uploadQueue.some(item => item.status === 'pending');
  const hasProcessing = uploadQueue.some(item => item.status === 'processing');
  transcribeAllBtn.disabled = !hasPending || hasProcessing;
}

window.removeFromQueue = function(id) {
  uploadQueue = uploadQueue.filter(item => item.id !== id);
  renderQueue();
};

// Upload file with progress tracking using XMLHttpRequest
function uploadWithProgress(item) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('video', item.file);

    // Track upload progress
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        item.stage = 'uploading';
        item.progress = Math.round((e.loaded / e.total) * 100);
        renderQueue();
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch (e) {
          reject(new Error('Invalid response'));
        }
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.error || 'Upload failed'));
        } catch (e) {
          reject(new Error('Upload failed'));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.open('POST', '/api/transcribe/start');
    xhr.send(formData);
  });
}

// Poll for transcription status
async function pollTranscriptionStatus(item, jobId) {
  const pollInterval = 2000; // 2 seconds
  const maxPolls = 600; // 20 minutes max
  let polls = 0;

  while (polls < maxPolls) {
    try {
      const response = await fetch(`/api/transcribe/status/${jobId}`);
      const data = await response.json();

      item.stage = data.stage;
      item.progress = data.progress;
      renderQueue();

      console.log(`[${item.file.name}] ${data.stage}: ${data.progress}%`);

      if (data.status === 'completed') {
        return data;
      } else if (data.status === 'error') {
        throw new Error(data.error || 'Transcription failed');
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
      polls++;
    } catch (error) {
      throw error;
    }
  }

  throw new Error('Transcription timed out');
}

// Transcribe a single video with progress
async function transcribeVideo(item) {
  const startTime = Date.now();
  const fileSizeMB = item.file.size / (1024 * 1024);
  console.log(`[${item.file.name}] Starting transcription... (${formatSize(item.file.size)})`);

  // Warn about large files
  if (fileSizeMB > 50) {
    console.warn(`[${item.file.name}] Large file (${fileSizeMB.toFixed(0)}MB) - upload may take several minutes`);
  }

  try {
    // Step 1: Upload file
    item.stage = 'uploading';
    item.progress = 0;
    renderQueue();

    console.log(`[${item.file.name}] Uploading...`);
    const uploadResult = await uploadWithProgress(item);
    console.log(`[${item.file.name}] Upload complete, job ID: ${uploadResult.jobId}`);

    // Step 2: Poll for transcription progress
    item.stage = 'queued';
    item.progress = 0;
    renderQueue();

    const result = await pollTranscriptionStatus(item, uploadResult.jobId);

    // Success!
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${item.file.name}] ✓ Complete in ${elapsed}s`);

    item.status = 'done';
    item.videoId = result.videoId;
    transcriptions.push({
      filename: result.filename,
      transcription: result.transcription,
      videoId: result.videoId
    });

    return { success: true, item };
  } catch (error) {
    console.error(`[${item.file.name}] ✗ Failed:`, error.message);
    item.status = 'error';
    item.error = error.message;
    return { success: false, item, error };
  }
}

// Transcribe all videos in PARALLEL
transcribeAllBtn.addEventListener('click', async () => {
  const pendingItems = uploadQueue.filter(item => item.status === 'pending');
  if (pendingItems.length === 0) return;

  console.log(`\n========== Starting transcription of ${pendingItems.length} video(s) ==========`);
  pendingItems.forEach(item => {
    console.log(`  - ${item.file.name} (${formatSize(item.file.size)})`);
  });

  // Disable button
  transcribeAllBtn.disabled = true;
  transcribeAllBtn.innerHTML = '<span class="spinner"></span> Transcribing...';

  // Set ALL items to processing FIRST
  pendingItems.forEach(item => {
    item.status = 'processing';
    item.stage = 'uploading';
    item.progress = 0;
  });
  renderQueue();

  // Start ALL transcriptions in parallel
  const promises = pendingItems.map(item => transcribeVideo(item));

  // Update UI as each completes
  promises.forEach(promise => {
    promise.then(() => {
      renderQueue();
      renderResults();
    });
  });

  // Wait for all to complete
  await Promise.all(promises);

  // Reset button
  transcribeAllBtn.disabled = false;
  transcribeAllBtn.innerHTML = `
    <span>Transcribe All</span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  `;
  renderQueue();
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
        <div class="result-actions">
          <button class="btn btn-secondary btn-sm" onclick="downloadTranscript(${index}, event)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download .txt
          </button>
        </div>
        <div class="transcription-text">${item.transcription}</div>
      </div>
    </div>
  `).join('');
}

// Download transcript as text file
window.downloadTranscript = function(index, event) {
  event.stopPropagation();
  const item = transcriptions[index];
  if (!item) return;

  const blob = new Blob([item.transcription], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = item.filename.replace(/\.[^/.]+$/, '') + '_transcript.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

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
    const combinedTranscription = transcriptions
      .map(t => `## ${t.filename}\n\n${t.transcription}`)
      .join('\n\n---\n\n');

    const videoIds = transcriptions.map(t => t.videoId).filter(Boolean);

    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcription: combinedTranscription, prompt, videoIds })
    });

    if (!response.ok) throw new Error('Summarization failed');

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

// Markdown parser fallback
if (typeof marked === 'undefined') {
  window.marked = {
    parse: (text) => text
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/^\- (.*$)/gim, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
  };
}

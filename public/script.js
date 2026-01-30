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

let uploadQueue = [];
let transcriptions = [];
let summaries = [];

// ==================== HISTORY MANAGEMENT ====================
const HISTORY_KEY = 'vt_history';
const MAX_HISTORY_ITEMS = 20;

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
    const videoNames = session.videos.map(v => v.filename).join(', ');
    const truncated = videoNames.length > 40 ? videoNames.substring(0, 40) + '...' : videoNames;

    return `
      <div class="history-item">
        <div class="history-item-header" onclick="loadHistorySession(${idx})">
          <div class="history-item-date">${date}</div>
          <div class="history-item-videos">${truncated}</div>
        </div>
        <div class="history-item-actions">
          <button class="btn-icon" onclick="loadHistorySession(${idx}); event.stopPropagation();" title="Load">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
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
    videoId: v.videoId
  }));
  summaries = session.summaries || [];

  renderResults();
  if (summaries.length > 0) {
    renderSummaries();
    summarySection.classList.add('visible');
  }

  historySidebar.classList.remove('open');
};

window.deleteHistorySession = function(idx) {
  const history = getHistory();
  history.splice(idx, 1);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
};

// Sidebar toggle
historyToggle.addEventListener('click', () => historySidebar.classList.add('open'));
closeSidebar.addEventListener('click', () => historySidebar.classList.remove('open'));
clearHistoryBtn.addEventListener('click', () => {
  if (confirm('Clear all history?')) clearHistory();
});

// Initialize history on load
renderHistory();

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
      videos: transcriptions.map(t => ({ filename: t.filename, transcription: t.transcription, videoId: t.videoId })),
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
  const downloadAllBtn = transcriptions.length > 1 ? `<button class="btn-icon-text" onclick="downloadAllTranscriptsZip(event)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download All</button>` : '';
  resultsList.innerHTML = `
    <div class="results-header"><span class="results-count">${transcriptions.length} transcription${transcriptions.length > 1 ? 's' : ''}</span>${downloadAllBtn}</div>
    ${transcriptions.map((item, i) => `
    <div class="result-item ${i === 0 ? 'expanded' : ''}" data-index="${i}">
      <div class="result-header" onclick="toggleResult(${i})">
        <span class="result-title">${item.filename}</span>
        <svg class="result-toggle" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="result-content">
        <div class="result-actions">
          <button class="btn-icon" onclick="copyText(${i}, 'transcript', event)" title="Copy"><svg class="icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg class="icon-success" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>
          <button class="btn-icon" onclick="downloadText(${i}, 'transcript', event)" title="Download"><svg class="icon-default" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><svg class="icon-success" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>
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
  setTimeout(() => btn.classList.remove('success'), 1500);
}

window.copyText = function(index, type, event) {
  event.stopPropagation();
  const item = type === 'transcript' ? transcriptions[index] : summaries[index];
  if (!item) return;
  const text = type === 'transcript' ? item.transcription : item.summary;
  navigator.clipboard.writeText(text).then(() => showSuccess(event.currentTarget));
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

// ==================== PROMPTS ====================
presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    presetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.prompt === 'custom') { promptInput.value = ''; promptInput.focus(); }
    else promptInput.value = btn.dataset.prompt;
  });
});

runPromptBtn.addEventListener('click', async () => {
  if (!transcriptions.length) return;
  const prompt = promptInput.value.trim();
  if (!prompt) return;

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

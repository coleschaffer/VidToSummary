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
let summaries = []; // Store individual summaries

// FFmpeg for audio extraction
let ffmpeg = null;
let ffmpegLoaded = false;
let ffmpegLoading = false;
let currentProgressCallback = null;

async function loadFFmpeg() {
  if (ffmpegLoaded) return true;
  if (ffmpegLoading) {
    while (ffmpegLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    return ffmpegLoaded;
  }

  ffmpegLoading = true;
  console.log('[FFmpeg] Loading...');

  try {
    const { FFmpeg } = FFmpegWASM;
    const { fetchFile } = FFmpegUtil;
    window.fetchFile = fetchFile;

    ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    ffmpeg.on('progress', ({ progress }) => {
      const pct = Math.round(progress * 100);
      console.log(`[FFmpeg] Progress: ${pct}%`);
      if (currentProgressCallback) {
        currentProgressCallback('extracting', pct);
      }
    });

    await ffmpeg.load({
      coreURL: '/ffmpeg/ffmpeg-core.js',
      wasmURL: '/ffmpeg/ffmpeg-core.wasm',
    });

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
  const isVideo = file.type.startsWith('video/');
  if (!isVideo) return file;

  const loaded = await loadFFmpeg();
  if (!loaded) {
    console.warn('[FFmpeg] Not available, uploading original file');
    return file;
  }

  const extraction = ffmpegQueue.then(async () => {
    console.log(`[FFmpeg] Extracting audio from ${file.name}...`);
    if (onProgress) onProgress('extracting', 0);
    currentProgressCallback = onProgress;

    const uniqueId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const inputName = `input_${uniqueId}.mp4`;
    const outputName = `output_${uniqueId}.mp3`;

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', '-y', outputName]);

      const data = await ffmpeg.readFile(outputName);
      const audioBlob = new Blob([data.buffer], { type: 'audio/mpeg' });
      const audioFile = new File([audioBlob], file.name.replace(/\.[^/.]+$/, '.mp3'), { type: 'audio/mpeg' });

      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}

      const reduction = ((1 - audioFile.size / file.size) * 100).toFixed(0);
      console.log(`[FFmpeg] Extracted audio: ${formatSize(file.size)} → ${formatSize(audioFile.size)} (${reduction}% smaller)`);

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

// Dropzone handlers
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('dragover'); });

dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files);
  const zeroByteFiles = files.filter(f => f.size === 0);
  if (zeroByteFiles.length > 0) {
    alert(`${zeroByteFiles.length} file(s) appear empty (0 bytes). Please drag files from Finder/Explorer instead.`);
  }
  const validFiles = files.filter(f => f.size > 0);
  if (validFiles.length > 0) await handleFiles(validFiles);
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
    const ctx = canvas.getContext('2d');
    video.preload = 'metadata'; video.muted = true; video.playsInline = true;
    const timeout = setTimeout(() => { URL.revokeObjectURL(video.src); resolve(null); }, 5000);
    video.onloadeddata = () => { video.currentTime = Math.min(1, video.duration * 0.1); };
    video.onseeked = () => {
      clearTimeout(timeout);
      canvas.width = 80; canvas.height = 45;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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
    const isVideo = file.type.startsWith('video/') || file.name.match(/\.(mp4|webm|mov|avi|mkv)$/i);
    const isAudio = file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|aac|ogg)$/i);
    if (isVideo || isAudio) {
      const thumbnail = await generateThumbnail(file);
      uploadQueue.push({ id: Date.now() + Math.random(), file, thumbnail, status: 'pending', stage: null, progress: 0 });
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
  const labels = { extracting: 'Extracting audio', uploading: 'Uploading', queued: 'Queued', transcribing: 'Transcribing', done: 'Done' };
  return labels[stage] || 'Processing';
}

function renderQueue() {
  if (uploadQueue.length === 0) { queueSection.classList.remove('visible'); return; }
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
            ${item.thumbnail ? `<img src="${item.thumbnail}" alt="thumbnail">` : `<div class="audio-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`}
          </div>
          <div class="queue-item-details">
            <span class="queue-item-name">${item.file.name}</span>
            <span class="queue-item-size">${formatSize(item.file.size)}</span>
          </div>
        </div>
        <div class="queue-item-right">
          ${isProcessing ? `<div class="progress-container"><div class="progress-bar"><div class="progress-fill" style="width: ${item.progress}%"></div></div></div>` : ''}
          <div class="queue-item-status">
            ${statusDisplay}
            ${item.status === 'pending' ? `<button class="remove-btn" onclick="removeFromQueue(${item.id})"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
  const hasPending = uploadQueue.some(item => item.status === 'pending');
  const hasProcessing = uploadQueue.some(item => item.status === 'processing');
  transcribeAllBtn.disabled = !hasPending || hasProcessing;
}

window.removeFromQueue = function(id) {
  uploadQueue = uploadQueue.filter(item => item.id !== id);
  renderQueue();
};

function uploadWithProgress(item) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    const fileToUpload = item.fileToUpload || item.file;
    formData.append('video', fileToUpload, fileToUpload.name);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) { item.stage = 'uploading'; item.progress = Math.round((e.loaded / e.total) * 100); renderQueue(); }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(new Error('Invalid response')); }
      } else {
        try { reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed')); } catch (e) { reject(new Error(`Upload failed with status ${xhr.status}`)); }
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.open('POST', '/api/transcribe/start');
    xhr.send(formData);
  });
}

async function pollTranscriptionStatus(item, jobId) {
  const pollInterval = 2000, maxPolls = 600;
  let polls = 0;
  while (polls < maxPolls) {
    const response = await fetch(`/api/transcribe/status/${jobId}`);
    const data = await response.json();
    item.stage = data.stage; item.progress = data.progress; renderQueue();
    if (data.status === 'completed') return data;
    if (data.status === 'error') throw new Error(data.error || 'Transcription failed');
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    polls++;
  }
  throw new Error('Transcription timed out');
}

async function transcribeVideo(item) {
  const startTime = Date.now();
  console.log(`[${item.file.name}] Starting transcription... (${formatSize(item.file.size)})`);
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
    console.log(`[${item.file.name}] ✓ Complete in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    item.status = 'done'; item.videoId = result.videoId;
    transcriptions.push({ filename: result.filename, transcription: result.transcription, videoId: result.videoId });
    return { success: true, item };
  } catch (error) {
    console.error(`[${item.file.name}] ✗ Failed:`, error.message);
    item.status = 'error'; item.error = error.message;
    return { success: false, item, error };
  }
}

transcribeAllBtn.addEventListener('click', async () => {
  const pendingItems = uploadQueue.filter(item => item.status === 'pending');
  if (pendingItems.length === 0) return;
  transcribeAllBtn.disabled = true;
  transcribeAllBtn.innerHTML = '<span class="spinner"></span> Transcribing...';
  pendingItems.forEach(item => { item.status = 'processing'; item.stage = 'uploading'; item.progress = 0; });
  renderQueue();
  const promises = pendingItems.map(item => transcribeVideo(item));
  promises.forEach(promise => { promise.then(() => { renderQueue(); renderResults(); }); });
  await Promise.all(promises);
  transcribeAllBtn.disabled = false;
  transcribeAllBtn.innerHTML = `<span>Transcribe All</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  renderQueue();
});

function renderResults() {
  if (transcriptions.length === 0) { resultsSection.classList.remove('visible'); return; }
  resultsSection.classList.add('visible');

  const downloadAllBtn = transcriptions.length > 1 ? `
    <button class="btn-icon-text" onclick="downloadAllTranscripts(event)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download All
    </button>` : '';

  resultsList.innerHTML = `
    <div class="results-header">
      <span class="results-count">${transcriptions.length} transcription${transcriptions.length > 1 ? 's' : ''}</span>
      ${downloadAllBtn}
    </div>
    ${transcriptions.map((item, index) => `
    <div class="result-item ${index === 0 ? 'expanded' : ''}" data-index="${index}">
      <div class="result-header" onclick="toggleResult(${index})">
        <span class="result-title">${item.filename}</span>
        <svg class="result-toggle" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="result-content">
        <div class="result-actions">
          <button class="btn-icon" onclick="copyTranscript(${index}, event)" title="Copy">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button class="btn-icon" onclick="downloadTranscript(${index}, event)" title="Download">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
        </div>
        <div class="transcription-text">${item.transcription}</div>
      </div>
    </div>`).join('')}`;
}

window.copyTranscript = function(index, event) {
  event.stopPropagation();
  const item = transcriptions[index];
  if (!item) return;
  navigator.clipboard.writeText(item.transcription).then(() => {
    const btn = event.currentTarget;
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  });
};

window.downloadTranscript = function(index, event) {
  event.stopPropagation();
  const item = transcriptions[index];
  if (!item) return;
  downloadTextFile(item.transcription, item.filename.replace(/\.[^/.]+$/, '') + '_transcript.txt');
};

window.downloadAllTranscripts = function(event) {
  event.stopPropagation();
  const combined = transcriptions.map(t => `=== ${t.filename} ===\n\n${t.transcription}`).join('\n\n' + '='.repeat(50) + '\n\n');
  downloadTextFile(combined, 'all_transcripts.txt');
};

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.toggleResult = function(index) {
  resultsList.querySelector(`[data-index="${index}"]`).classList.toggle('expanded');
};

window.toggleSummary = function(index) {
  document.querySelector(`.summary-item[data-index="${index}"]`).classList.toggle('expanded');
};

// Preset prompts
presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    presetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const prompt = btn.dataset.prompt;
    if (prompt === 'custom') {
      promptInput.value = '';
      promptInput.focus();
    } else {
      promptInput.value = prompt;
    }
  });
});

// Run prompt - separate calls for each transcription
runPromptBtn.addEventListener('click', async () => {
  if (transcriptions.length === 0) return;
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  runPromptBtn.disabled = true;
  runPromptBtn.innerHTML = '<span class="spinner"></span> Processing...';
  summaries = [];
  summarySection.classList.add('visible');
  summaryContent.innerHTML = '<div class="processing-message">Processing transcriptions...</div>';

  try {
    // Process each transcription separately in parallel
    const promises = transcriptions.map(async (t, index) => {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcription: t.transcription, prompt, videoIds: [t.videoId] })
      });
      if (!response.ok) throw new Error('Summarization failed');
      const data = await response.json();
      return { filename: t.filename, summary: data.summary, index };
    });

    const results = await Promise.all(promises);
    summaries = results.sort((a, b) => a.index - b.index);
    renderSummaries();
    summarySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('Error:', error);
    summaryContent.innerHTML = `<p style="color: var(--error);">Error: ${error.message}</p>`;
  } finally {
    runPromptBtn.disabled = false;
    runPromptBtn.innerHTML = `<span>Run Prompt</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  }
});

function renderSummaries() {
  const downloadAllBtn = summaries.length > 1 ? `
    <button class="btn-icon-text" onclick="downloadAllSummaries(event)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download All
    </button>` : '';

  summaryContent.innerHTML = `
    <div class="results-header">
      <span class="results-count">${summaries.length} result${summaries.length > 1 ? 's' : ''}</span>
      ${downloadAllBtn}
    </div>
    ${summaries.map((item, index) => `
    <div class="summary-item ${index === 0 ? 'expanded' : ''}" data-index="${index}">
      <div class="summary-header" onclick="toggleSummary(${index})">
        <span class="summary-title">${item.filename}</span>
        <svg class="result-toggle" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="summary-body">
        <div class="result-actions">
          <button class="btn-icon" onclick="copySummary(${index}, event)" title="Copy">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button class="btn-icon" onclick="downloadSummary(${index}, event)" title="Download">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
        </div>
        <div class="summary-text">${marked.parse(item.summary)}</div>
      </div>
    </div>`).join('')}`;
}

window.copySummary = function(index, event) {
  event.stopPropagation();
  const item = summaries[index];
  if (!item) return;
  navigator.clipboard.writeText(item.summary).then(() => {
    const btn = event.currentTarget;
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  });
};

window.downloadSummary = function(index, event) {
  event.stopPropagation();
  const item = summaries[index];
  if (!item) return;
  downloadTextFile(item.summary, item.filename.replace(/\.[^/.]+$/, '') + '_summary.txt');
};

window.downloadAllSummaries = function(event) {
  event.stopPropagation();
  const combined = summaries.map(s => `=== ${s.filename} ===\n\n${s.summary}`).join('\n\n' + '='.repeat(50) + '\n\n');
  downloadTextFile(combined, 'all_summaries.txt');
};

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

// Pre-load FFmpeg in the background
setTimeout(() => {
  loadFFmpeg().then(loaded => {
    if (loaded) console.log('[FFmpeg] Pre-loaded and ready');
  });
}, 1000);

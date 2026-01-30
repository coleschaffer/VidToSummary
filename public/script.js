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

// FFmpeg for audio extraction
let ffmpeg = null;
let ffmpegLoaded = false;
let ffmpegLoading = false;
let currentProgressCallback = null;

async function loadFFmpeg() {
  if (ffmpegLoaded) return true;
  if (ffmpegLoading) {
    // Wait for loading to complete
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
      // Update UI progress
      if (currentProgressCallback) {
        console.log(`[FFmpeg] Calling progress callback with ${pct}%`);
        currentProgressCallback('extracting', pct);
      } else {
        console.log(`[FFmpeg] No progress callback set!`);
      }
    });

    // Load from local files to avoid CORS issues
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

// Queue for FFmpeg extractions (only one at a time to avoid FS conflicts)
let ffmpegQueue = Promise.resolve();

// Extract audio from video file
async function extractAudio(file, onProgress) {
  const isVideo = file.type.startsWith('video/');
  if (!isVideo) {
    // Already audio, return as-is
    return file;
  }

  // Load FFmpeg if needed
  const loaded = await loadFFmpeg();
  if (!loaded) {
    console.warn('[FFmpeg] Not available, uploading original file');
    return file;
  }

  // Queue this extraction to run after any pending ones
  const extraction = ffmpegQueue.then(async () => {
    console.log(`[FFmpeg] Extracting audio from ${file.name}...`);
    if (onProgress) onProgress('extracting', 0);

    // Set the progress callback for this extraction
    currentProgressCallback = onProgress;

    // Use unique filenames based on timestamp to avoid conflicts
    const uniqueId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const inputName = `input_${uniqueId}.mp4`;
    const outputName = `output_${uniqueId}.mp3`;

    try {
      // Write input file
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      // Extract audio
      await ffmpeg.exec([
        '-i', inputName,
        '-vn',           // No video
        '-acodec', 'libmp3lame',
        '-q:a', '4',     // Good quality (~165 kbps)
        '-y',            // Overwrite
        outputName
      ]);

      // Read output
      console.log(`[FFmpeg] Reading output file: ${outputName}`);
      const data = await ffmpeg.readFile(outputName);
      console.log(`[FFmpeg] Read ${data.byteLength} bytes from output`);

      // Use audio/mpeg (correct MIME type for MP3) - audio/mp3 is not standard
      const audioBlob = new Blob([data.buffer], { type: 'audio/mpeg' });
      console.log(`[FFmpeg] Created blob: ${audioBlob.size} bytes, type: ${audioBlob.type}`);

      const audioFile = new File([audioBlob], file.name.replace(/\.[^/.]+$/, '.mp3'), { type: 'audio/mpeg' });
      console.log(`[FFmpeg] Created file: ${audioFile.name}, ${audioFile.size} bytes, type: ${audioFile.type}`);

      // Cleanup
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
      // Cleanup on error
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
      return file; // Fall back to original
    }
  });

  // Update the queue
  ffmpegQueue = extraction.catch(() => {});

  return extraction;
}

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
    case 'extracting': return 'Extracting audio';
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
    // Use extracted audio if available, otherwise original file
    const fileToUpload = item.fileToUpload || item.file;

    console.log(`[Upload] Preparing upload for: ${item.file.name}`);
    console.log(`[Upload] File to upload: name=${fileToUpload.name}, size=${fileToUpload.size}, type=${fileToUpload.type}`);
    console.log(`[Upload] Is File: ${fileToUpload instanceof File}, Is Blob: ${fileToUpload instanceof Blob}`);

    formData.append('video', fileToUpload, fileToUpload.name);

    // Track upload progress
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        item.stage = 'uploading';
        item.progress = Math.round((e.loaded / e.total) * 100);
        renderQueue();
      }
    };

    xhr.onload = () => {
      console.log(`[Upload] Response status: ${xhr.status}`);
      console.log(`[Upload] Response: ${xhr.responseText.substring(0, 500)}`);

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
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => {
      console.error(`[Upload] Network error - readyState: ${xhr.readyState}`);
      reject(new Error('Network error'));
    };
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
  const originalSize = item.file.size;
  console.log(`[${item.file.name}] Starting transcription... (${formatSize(originalSize)})`);

  try {
    // Step 1: Extract audio from video (if it's a video)
    let fileToUpload = item.file;

    if (item.file.type.startsWith('video/')) {
      item.stage = 'extracting';
      item.progress = 0;
      renderQueue();

      console.log(`[${item.file.name}] Extracting audio...`);
      fileToUpload = await extractAudio(item.file, (stage, progress) => {
        console.log(`[${item.file.name}] Progress callback: ${stage} ${progress}%`);
        item.stage = stage;
        item.progress = progress;
        renderQueue();
      });

      console.log(`[${item.file.name}] Audio extracted: ${formatSize(originalSize)} → ${formatSize(fileToUpload.size)}`);
    }

    // Store the file to upload for the upload function
    item.fileToUpload = fileToUpload;

    // Step 2: Upload file
    item.stage = 'uploading';
    item.progress = 0;
    renderQueue();

    console.log(`[${item.file.name}] Uploading ${formatSize(fileToUpload.size)}...`);
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

// Pre-load FFmpeg in the background
setTimeout(() => {
  loadFFmpeg().then(loaded => {
    if (loaded) console.log('[FFmpeg] Pre-loaded and ready');
  });
}, 1000);

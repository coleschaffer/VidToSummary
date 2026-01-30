/**
 * Queue Management & Rate Limiting
 *
 * Handles:
 * - Global concurrent processing limit
 * - Per-user concurrent processing limit
 * - Per-user queue limit
 * - Job cleanup
 * - Upload file cleanup
 */

import { unlinkSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Configuration (can be overridden via environment variables)
export const CONFIG = {
  MAX_GLOBAL_CONCURRENT: parseInt(process.env.MAX_GLOBAL_CONCURRENT) || 10,
  MAX_USER_CONCURRENT: parseInt(process.env.MAX_USER_CONCURRENT) || 3,
  MAX_USER_QUEUE: parseInt(process.env.MAX_USER_QUEUE) || 10,
  JOB_RETENTION_MS: 10 * 60 * 1000, // 10 minutes
  UPLOAD_CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  UPLOAD_MAX_AGE_MS: 30 * 60 * 1000, // 30 minutes
};

// Track active jobs globally
const activeJobs = new Map();

// Track jobs per user
const userJobs = new Map(); // userId -> Set of jobIds

// Track user queue counts
const userQueueCounts = new Map(); // userId -> count of queued/processing jobs

/**
 * Generate or retrieve session ID from request
 */
export function getSessionId(req, res) {
  let sessionId = req.cookies?.vt_session;
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    res.cookie('vt_session', sessionId, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax'
    });
  }
  return sessionId;
}

/**
 * Get current global stats
 */
export function getGlobalStats() {
  let processingCount = 0;
  for (const job of activeJobs.values()) {
    if (job.status === 'processing') {
      processingCount++;
    }
  }
  return {
    totalJobs: activeJobs.size,
    processingJobs: processingCount,
    maxGlobalConcurrent: CONFIG.MAX_GLOBAL_CONCURRENT,
    maxUserConcurrent: CONFIG.MAX_USER_CONCURRENT,
    maxUserQueue: CONFIG.MAX_USER_QUEUE,
  };
}

/**
 * Get stats for a specific user
 */
export function getUserStats(userId) {
  const userJobIds = userJobs.get(userId) || new Set();
  let processingCount = 0;
  let queuedCount = 0;

  for (const jobId of userJobIds) {
    const job = activeJobs.get(jobId);
    if (job) {
      if (job.status === 'processing') processingCount++;
      else if (job.status === 'queued') queuedCount++;
    }
  }

  return {
    totalJobs: userJobIds.size,
    processingJobs: processingCount,
    queuedJobs: queuedCount,
    canAddMore: (processingCount + queuedCount) < CONFIG.MAX_USER_QUEUE,
    canStartProcessing: processingCount < CONFIG.MAX_USER_CONCURRENT,
  };
}

/**
 * Check if a new job can be started globally
 */
export function canStartGlobally() {
  let processingCount = 0;
  for (const job of activeJobs.values()) {
    if (job.status === 'processing') {
      processingCount++;
    }
  }
  return processingCount < CONFIG.MAX_GLOBAL_CONCURRENT;
}

/**
 * Check if user can add more jobs to queue
 */
export function canUserAddJob(userId) {
  const stats = getUserStats(userId);
  return stats.canAddMore;
}

/**
 * Check if user can start processing a new job
 */
export function canUserStartJob(userId) {
  const stats = getUserStats(userId);
  return stats.canStartProcessing && canStartGlobally();
}

/**
 * Register a new job
 */
export function registerJob(jobId, userId, filename) {
  const job = {
    jobId,
    userId,
    filename,
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  activeJobs.set(jobId, job);

  if (!userJobs.has(userId)) {
    userJobs.set(userId, new Set());
  }
  userJobs.get(userId).add(jobId);

  console.log(`[Queue] Job ${jobId} registered for user ${userId}. Global: ${activeJobs.size}, User: ${userJobs.get(userId).size}`);

  return job;
}

/**
 * Update job status
 */
export function updateJobStatus(jobId, status, data = {}) {
  const job = activeJobs.get(jobId);
  if (job) {
    job.status = status;
    job.updatedAt = Date.now();
    Object.assign(job, data);

    console.log(`[Queue] Job ${jobId} status: ${status}`);
  }
}

/**
 * Mark job as completed (will be cleaned up later)
 */
export function completeJob(jobId, result = {}) {
  updateJobStatus(jobId, 'completed', { result, completedAt: Date.now() });
}

/**
 * Mark job as failed
 */
export function failJob(jobId, error) {
  updateJobStatus(jobId, 'failed', { error: error.message, failedAt: Date.now() });
}

/**
 * Get job by ID
 */
export function getJob(jobId) {
  return activeJobs.get(jobId);
}

/**
 * Remove a job (called during cleanup)
 */
export function removeJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job) {
    const userJobSet = userJobs.get(job.userId);
    if (userJobSet) {
      userJobSet.delete(jobId);
      if (userJobSet.size === 0) {
        userJobs.delete(job.userId);
      }
    }
    activeJobs.delete(jobId);
    console.log(`[Queue] Job ${jobId} removed`);
  }
}

/**
 * Cleanup old completed/failed jobs
 */
export function cleanupOldJobs() {
  const now = Date.now();
  let cleaned = 0;

  for (const [jobId, job] of activeJobs) {
    const isTerminal = job.status === 'completed' || job.status === 'failed';
    const isOld = (now - job.updatedAt) > CONFIG.JOB_RETENTION_MS;

    if (isTerminal && isOld) {
      removeJob(jobId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[Queue] Cleaned up ${cleaned} old jobs`);
  }
}

/**
 * Cleanup old upload files
 */
export function cleanupUploads(uploadsDir) {
  try {
    const files = readdirSync(uploadsDir);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const filePath = join(uploadsDir, file);
      try {
        const stats = statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > CONFIG.UPLOAD_MAX_AGE_MS) {
          unlinkSync(filePath);
          cleaned++;
        }
      } catch (err) {
        // File might have been deleted already
      }
    }

    if (cleaned > 0) {
      console.log(`[Queue] Cleaned up ${cleaned} old upload files`);
    }
  } catch (err) {
    console.error('[Queue] Error cleaning uploads:', err.message);
  }
}

/**
 * Start cleanup intervals
 */
export function startCleanupIntervals(uploadsDir) {
  // Cleanup jobs every minute
  setInterval(cleanupOldJobs, 60 * 1000);

  // Cleanup uploads every 5 minutes
  setInterval(() => cleanupUploads(uploadsDir), CONFIG.UPLOAD_CLEANUP_INTERVAL_MS);

  console.log('[Queue] Cleanup intervals started');
}

/**
 * Rate limit middleware
 */
export function rateLimitMiddleware(req, res, next) {
  const sessionId = getSessionId(req, res);
  req.sessionId = sessionId;

  // Check if user can add more jobs
  if (!canUserAddJob(sessionId)) {
    return res.status(429).json({
      error: 'Queue limit reached',
      message: `You can only have ${CONFIG.MAX_USER_QUEUE} videos in your queue at a time. Please wait for some to complete.`,
      limits: getUserStats(sessionId)
    });
  }

  next();
}

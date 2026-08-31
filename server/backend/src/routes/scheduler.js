const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { requireAuth, requireAdmin } = require('./auth');
const { schedulerService } = require('../services/scheduler-service');
const { setTaskEnabled } = require('../services/scheduler-service');
const { audit } = require('../services/audit-log');
const { getTask } = require('../services/task-registry');

// All scheduler routes require admin
router.use(requireAuth);
router.use(requireAdmin);

// List all tasks with last run info + schedule config
router.get('/tasks', async (req, res) => {
  try {
    const tasks = await schedulerService.getTasksWithStatus();
    res.json({ success: true, data: tasks });
  } catch (error) {
    console.error('Error fetching scheduler tasks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks' });
  }
});

// Paginated run history
router.get('/runs', async (req, res) => {
  try {
    const { page, pageSize, taskName } = req.query;
    const result = await schedulerService.getRuns({
      page: Math.max(parseInt(page, 10) || 1, 1),
      pageSize: Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 200),
      taskName: taskName || undefined,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching scheduler runs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch runs' });
  }
});

// Single run detail
router.get('/runs/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid run id' });
    }
    const run = await schedulerService.getRunById(req.params.id);
    if (!run) {
      return res.status(404).json({ success: false, error: 'Run not found' });
    }
    res.json({ success: true, data: run });
  } catch (error) {
    console.error('Error fetching run detail:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch run' });
  }
});

// Pause a task — scheduled runs are skipped (manual triggers still work).
router.post('/tasks/:taskName/pause', async (req, res) => {
  try {
    const { taskName } = req.params;
    if (!getTask(taskName)) {
      return res.status(404).json({ success: false, error: `Unknown task: ${taskName}` });
    }
    await setTaskEnabled(taskName, false, req.user.id);

    audit({
      userId: req.user.id,
      action: 'pause_scheduled_task',
      resource: 'scheduler',
      resourceId: taskName,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, taskName, enabled: false });
  } catch (error) {
    console.error('Error pausing scheduler task:', error);
    res.status(500).json({ success: false, error: 'Failed to pause task' });
  }
});

// Resume a paused task.
router.post('/tasks/:taskName/resume', async (req, res) => {
  try {
    const { taskName } = req.params;
    if (!getTask(taskName)) {
      return res.status(404).json({ success: false, error: `Unknown task: ${taskName}` });
    }
    await setTaskEnabled(taskName, true, req.user.id);

    audit({
      userId: req.user.id,
      action: 'resume_scheduled_task',
      resource: 'scheduler',
      resourceId: taskName,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, taskName, enabled: true });
  } catch (error) {
    console.error('Error resuming scheduler task:', error);
    res.status(500).json({ success: false, error: 'Failed to resume task' });
  }
});

// Manual trigger
router.post('/trigger/:taskName', async (req, res) => {
  try {
    const { taskName } = req.params;

    audit({
      userId: req.user.id,
      action: 'trigger_scheduled_task',
      resource: 'scheduler',
      resourceId: taskName,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Start execution in background, respond immediately
    const runPromise = schedulerService.executeTask(taskName, 'manual', req.user.id);

    // Wait briefly to catch immediate errors (unknown task, already running)
    const result = await Promise.race([
      runPromise.then((r) => ({ started: true, result: r })),
      new Promise((resolve) => setTimeout(() => resolve({ started: true, pending: true }), 500)),
    ]);
    // If the 500ms timeout won the race, the task keeps running in background —
    // swallow any late rejection so it can't surface as an unhandledRejection.
    runPromise.catch(() => {});

    res.json({ success: true, message: `Task '${taskName}' triggered`, data: result });
  } catch (error) {
    if (error.message?.includes('already running')) {
      return res.status(409).json({ success: false, error: error.message });
    }
    if (error.message?.includes('Unknown task')) {
      return res.status(404).json({ success: false, error: error.message });
    }
    console.error('Error triggering task:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger task' });
  }
});

module.exports = router;

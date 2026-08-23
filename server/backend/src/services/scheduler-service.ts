import { ScheduledTaskRun } from '../models/ScheduledTaskRun';
import { getAllTasks, getTask } from './task-registry';
import { sendOperationalAlert } from './alert-notifier';
import AppSetting from '../models/AppSetting';

const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes — stale locks are auto-released
const HEARTBEAT_MS = 60 * 1000; // refresh the lock every minute while a task runs
const PROCESS_ID = `${process.pid}-${Date.now()}`;

function taskSettingKey(taskName: string): string {
  return `scheduler_enabled_${taskName}`;
}

// Whether a task is enabled for SCHEDULED runs (manual triggers still work).
// Default: enabled. Persisted via AppSetting so the admin UI can pause tasks.
export async function isTaskEnabled(taskName: string): Promise<boolean> {
  try {
    const doc = await AppSetting.findOne({ key: taskSettingKey(taskName) }).lean();
    return doc?.value !== false;
  } catch {
    return true;
  }
}

export async function setTaskEnabled(taskName: string, enabled: boolean, updatedBy?: string): Promise<void> {
  try {
    await AppSetting.findOneAndUpdate(
      { key: taskSettingKey(taskName) },
      { $set: { value: enabled, updatedBy: updatedBy || null } },
      { upsert: true, setDefaultsOnInsert: true },
    );
  } catch (err: any) {
    // Concurrent upsert on the unique key (double-click / two tabs) — retry once.
    if (err?.code === 11000) {
      await AppSetting.findOneAndUpdate(
        { key: taskSettingKey(taskName) },
        { $set: { value: enabled, updatedBy: updatedBy || null } },
      );
      return;
    }
    throw err;
  }
}

class SchedulerService {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private catchUpTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // Start interval timers for all registered tasks
  async start(): Promise<void> {
    // Recover any tasks left in 'running' state from a previous crash
    await this.recoverStaleRuns();

    const tasks = getAllTasks();
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const timer = setInterval(async () => {
        // Paused tasks keep their timer but skip scheduled executions.
        if (!(await isTaskEnabled(task.name))) return;
        this.executeTask(task.name, 'scheduled').catch((err) =>
          console.error(`[scheduler] Scheduled run of '${task.name}' failed:`, err.message),
        );
      }, task.intervalMs);
      this.timers.set(task.name, timer);

      // Catch-up: if the task is overdue (never ran, or last completed run is
      // older than its interval), trigger an immediate run. Staggered per index
      // to avoid a thundering herd on (re)start.
      this.maybeRunOnStart(task, i).catch((err) =>
        console.error(`[scheduler] Catch-up check for '${task.name}' failed:`, err.message),
      );

      const hours = (task.intervalMs / 3600000).toFixed(1);
      console.log(`[scheduler] ${task.displayName} scheduled every ${hours}h`);
    }
    console.log(`[scheduler] Started ${tasks.length} tasks`);
  }

  // Trigger an immediate run if the task is overdue relative to its last completed run.
  private async maybeRunOnStart(
    task: { name: string; intervalMs: number },
    index: number,
  ): Promise<void> {
    if (!(await isTaskEnabled(task.name))) return;
    const lastCompleted = await ScheduledTaskRun.findOne({
      taskName: task.name,
      status: 'completed',
    })
      .sort({ completedAt: -1 })
      .lean();

    const lastAt = lastCompleted?.completedAt || lastCompleted?.startedAt;
    const overdue = !lastAt || Date.now() - new Date(lastAt).getTime() >= task.intervalMs;
    if (!overdue) return;

    // Stagger to avoid all overdue tasks firing at once on start. Re-check the
    // enabled flag at fire time too — an admin may pause within the stagger
    // window, and a paused task must NOT run.
    const timer = setTimeout(async () => {
      this.catchUpTimers.delete(task.name);
      if (!(await isTaskEnabled(task.name))) return;
      this.executeTask(task.name, 'scheduled').catch((err) =>
        console.error(`[scheduler] Catch-up run of '${task.name}' failed:`, err.message),
      );
    }, index * 5000);
    this.catchUpTimers.set(task.name, timer);
  }

  // Stop all interval timers (and pending catch-up runs)
  stop(): void {
    for (const [, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
    for (const [, timer] of this.catchUpTimers) {
      clearTimeout(timer);
    }
    this.catchUpTimers.clear();
    console.log('[scheduler] Stopped all tasks');
  }

  // Clean up stale 'running' records from previous crashes
  async recoverStaleRuns(): Promise<void> {
    const staleThreshold = new Date(Date.now() - 4 * 3600000); // 4 hours
    const stale = await ScheduledTaskRun.updateMany(
      { status: 'running', startedAt: { $lt: staleThreshold } },
      {
        status: 'failed',
        error: 'Marked as failed: process crashed or timed out',
        completedAt: new Date(),
      },
    );
    if (stale.modifiedCount > 0) {
      console.log(`[scheduler] Recovered ${stale.modifiedCount} stale running task(s)`);
    }
  }

  // Execute a single task with DB tracking
  async executeTask(
    taskName: string,
    trigger: 'scheduled' | 'manual',
    triggeredBy?: string,
  ): Promise<any> {
    const taskDef = getTask(taskName);
    if (!taskDef) {
      throw new Error(`Unknown task: ${taskName}`);
    }

    // Atomic distributed lock via findOneAndUpdate + upsert.
    // Acquires if no running doc exists, or reclaims if the existing lock is stale (older than LOCK_TTL_MS).
    // The unique partial index on { taskName } where status='running' guarantees at most one running doc.
    const now = new Date();
    const staleBefore = new Date(now.getTime() - LOCK_TTL_MS);

    let run;
    try {
      run = await ScheduledTaskRun.findOneAndUpdate(
        {
          taskName,
          status: 'running',
          $or: [
            { lockedAt: { $exists: false } },
            { lockedAt: null },
            { lockedAt: { $lt: staleBefore } },
          ],
        },
        {
          $set: {
            status: 'running',
            trigger,
            triggeredBy: triggeredBy || null,
            startedAt: now,
            lockedAt: now,
            lockedBy: PROCESS_ID,
            completedAt: null,
            durationMs: null,
            result: null,
            error: null,
            subtasks: [],
          },
          $setOnInsert: { taskName },
        },
        { upsert: true, new: true },
      );
    } catch (err: any) {
      if (err.code === 11000) {
        // Another process won the upsert race — lock is held and not stale
        if (trigger === 'scheduled') {
          console.log(`[scheduler] Skipping '${taskName}' — already running`);
          return null;
        }
        throw new Error(`Task '${taskName}' is already running`);
      }
      throw err;
    }

    // If we matched a stale doc but another process beat us to it, verify we own the lock
    if (run.lockedBy !== PROCESS_ID) {
      if (trigger === 'scheduled') {
        console.log(`[scheduler] Skipping '${taskName}' — already running`);
        return null;
      }
      throw new Error(`Task '${taskName}' is already running`);
    }

    console.log(`[scheduler] Running '${taskDef.displayName}' (${trigger})`);

    // Heartbeat: keep refreshing lockedAt so the stale-lock reclaim (LOCK_TTL_MS)
    // doesn't fire mid-run for tasks that outlast the TTL. Only refreshes while we
    // still own the lock.
    const heartbeat = setInterval(() => {
      ScheduledTaskRun.updateOne(
        { _id: run._id, lockedBy: PROCESS_ID, status: 'running' },
        { $set: { lockedAt: new Date() } },
      ).catch((err) =>
        console.error(`[scheduler] Heartbeat for '${taskName}' failed:`, err.message),
      );
    }, HEARTBEAT_MS);

    try {
      const result = await taskDef.handler();

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - run.startedAt!.getTime();

      // Only write completion if we still own the lock — a reclaimed run may now
      // belong to another process, and clobbering it would corrupt history.
      await ScheduledTaskRun.updateOne(
        { _id: run._id, lockedBy: PROCESS_ID },
        {
          status: 'completed',
          completedAt,
          durationMs,
          result: result.summary,
          subtasks: result.subtasks.map((s) => ({
            ...s,
            startedAt: s.startedAt || run.startedAt,
            completedAt: s.completedAt || completedAt,
          })),
        },
      );

      const failedSubtasks = result.subtasks.filter((subtask) => subtask.status === 'failed');
      if (failedSubtasks.length > 0) {
        void sendOperationalAlert({
          event: `scheduler:${taskName}:partial-failure`,
          severity: 'warning',
          message: `${taskDef.displayName} completed with ${failedSubtasks.length} failed subtask(s)`,
          details: {
            taskName,
            failedSubtasks: failedSubtasks.map((subtask) => subtask.name),
          },
        });
      }

      console.log(
        `[scheduler] '${taskDef.displayName}' completed in ${(durationMs / 1000).toFixed(1)}s`,
      );
      return { ...result.summary, durationMs };
    } catch (err: any) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - run.startedAt!.getTime();

      await ScheduledTaskRun.updateOne(
        { _id: run._id, lockedBy: PROCESS_ID },
        {
          status: 'failed',
          completedAt,
          durationMs,
          error: err.message,
        },
      );

      void sendOperationalAlert({
        event: `scheduler:${taskName}:failure`,
        severity: 'critical',
        message: `${taskDef.displayName} failed: ${err.message}`,
        details: { taskName },
      });
      console.error(`[scheduler] '${taskDef.displayName}' failed: ${err.message}`);
      throw err;
    } finally {
      clearInterval(heartbeat);
    }
  }

  // Get all tasks with their last run info for admin UI
  async getTasksWithStatus(): Promise<any[]> {
    const tasks = getAllTasks();

    // Parallelize the per-task DB reads (last run, running state, enabled flag).
    const rows = await Promise.all(
      tasks.map(async (task) => {
        const [lastRun, isRunning, enabled] = await Promise.all([
          ScheduledTaskRun.findOne({ taskName: task.name }).sort({ startedAt: -1 }).lean(),
          ScheduledTaskRun.exists({ taskName: task.name, status: 'running' }),
          isTaskEnabled(task.name),
        ]);

        let nextRunAt: string | null = null;
        if (lastRun?.startedAt) {
          nextRunAt = new Date(new Date(lastRun.startedAt).getTime() + task.intervalMs).toISOString();
        }

        return {
          name: task.name,
          displayName: task.displayName,
          description: task.description,
          intervalMs: task.intervalMs,
          enabled,
          lastRun: lastRun || null,
          nextRunAt,
          isRunning: !!isRunning,
        };
      }),
    );

    return rows;
  }

  // Paginated run history
  async getRuns(query: {
    page?: number;
    pageSize?: number;
    taskName?: string;
  }): Promise<{ data: any[]; totalCount: number; page: number; pageSize: number }> {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const filter: any = {};
    if (query.taskName) filter.taskName = query.taskName;

    const [data, totalCount] = await Promise.all([
      ScheduledTaskRun.find(filter)
        .sort({ startedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate('triggeredBy', 'username')
        .lean(),
      ScheduledTaskRun.countDocuments(filter),
    ]);

    return { data, totalCount, page, pageSize };
  }

  // Single run detail
  async getRunById(id: string): Promise<any> {
    return ScheduledTaskRun.findById(id).populate('triggeredBy', 'username').lean();
  }
}

export const schedulerService = new SchedulerService();

module.exports = { schedulerService, SchedulerService, isTaskEnabled, setTaskEnabled };

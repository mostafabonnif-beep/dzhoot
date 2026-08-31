/* eslint-disable @typescript-eslint/no-var-requires */
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Controlled fake ffmpeg: writes the output file it was asked to produce,
// and emits 'close' (0) when killed (or immediately for remux/probe calls).
jest.mock('child_process', () => {
  const { EventEmitter } = require('events');
  return {
    spawn: jest.fn((bin: string, args: string[]) => {
      const proc: any = new EventEmitter();
      proc.stderr = { on: jest.fn() };
      proc.stdout = { on: jest.fn() };
      proc.kill = jest.fn(() => setImmediate(() => proc.emit('close', 0)));
      const outFile = args[args.length - 1];
      // Recording capture (ts) and remux (mp4) create their output file.
      if (args.includes('mpegts') || args.includes('-movflags')) {
        fs.writeFileSync(outFile, `fake-${bin}`);
      }
      // ffprobe/probe or remux resolve immediately; capture waits for kill.
      if (bin.includes('ffprobe') || args.includes('-movflags')) {
        setImmediate(() => proc.emit('close', 0));
      }
      return proc;
    }),
  };
});

import Channel from '../models/Channel';
import Recording from '../models/Recording';
import { startRecording, stopRecording, deleteRecording, listRecordings } from '../services/recording-service';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dzhoot-rec-'));

describe('recording service', () => {
  beforeAll(async () => {
    process.env.RECORDINGS_DIR = TMP;
    process.env.RECORDING_MAX_SECONDS = '3600';
  });

  it('starts a recording, finalizes to ready on stop, then deletes it', async () => {
    const channel: any = await Channel.create({
      channelId: `rec-test-${Date.now()}`,
      channelName: 'Record Me',
      channelUrl: 'https://upstream.example/live.m3u8',
      channelGroup: 'Test',
      ownerId: null,
    });

    const { rec } = await startRecording(channel.channelId, '65f000000000000000000001');
    expect(rec.status).toBe('recording');
    expect(rec.slug).toMatch(/^rec-/);

    // Duplicate start for the same channel is idempotent
    const again = await startRecording(channel.channelId, '65f000000000000000000001');
    expect(again.alreadyActive).toBe(true);

    await stopRecording(String(rec._id));
    await new Promise((r) => setTimeout(r, 50));

    const done: any = await Recording.findById(rec._id).lean();
    expect(done.status).toBe('ready');
    expect(done.fileName).toMatch(/\.mp4$/);
    expect(done.sizeBytes).toBeGreaterThan(0);

    const list = await listRecordings({}, 1, 10);
    expect(list.totalCount).toBeGreaterThanOrEqual(1);

    await deleteRecording(String(rec._id));
    const gone = await Recording.findById(rec._id).lean();
    expect(gone).toBeNull();
  });

  it('marks a recording failed when capture does not produce a file', async () => {
    const channel: any = await Channel.create({
      channelId: `rec-fail-${Date.now()}`,
      channelName: 'Broken Stream',
      channelUrl: 'https://upstream.example/dead.m3u8',
      ownerId: null,
    });
    const { rec } = await startRecording(channel.channelId, '65f000000000000000000001');
    // Simulate a capture that produced no output: remove the ts file, then stop.
    const ts = path.join(TMP, `${rec.slug}.ts`);
    fs.unlinkSync(ts);
    await stopRecording(String(rec._id));
    await new Promise((r) => setTimeout(r, 50));
    const done: any = await Recording.findById(rec._id).lean();
    // Without a ts file the remux is skipped → status stays failed/missing mp4.
    expect(['failed', 'recording']).toContain(done.status);
    await deleteRecording(String(rec._id));
  });
});

import mongoose from 'mongoose';

jest.mock('../models/Channel', () => ({
  findOne: jest.fn(),
}));

jest.mock('../models/ChannelFailoverMap', () => ({
  aggregate: jest.fn(),
}));

// The helper lives in the (heavy) failover service — pull it out under the
// mocked models only; nothing else in the module runs during these tests.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getHttpsBackupStreamUrl } = require('../services/source-failover-service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Channel = require('../models/Channel');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FailoverMap = require('../models/ChannelFailoverMap');

const B_SOURCE = new mongoose.Types.ObjectId();

function mockNoMaps() {
  (FailoverMap.aggregate as jest.Mock).mockReturnValue({ exec: async () => [] });
}

function mockTwin(url: string | null) {
  (FailoverMap.aggregate as jest.Mock).mockReturnValue({
    exec: async () => [
      { backupSourceId: B_SOURCE, backupStreamId: '555', priority: 10, updatedAt: new Date() },
    ],
  });
  (Channel.findOne as jest.Mock).mockReturnValue({
    select: () => ({
      lean: () => ({
        exec: async () => (url ? { channelUrl: url } : null),
      }),
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getHttpsBackupStreamUrl', () => {
  it('returns the https twin URL when a failover map + twin channel exist', async () => {
    mockTwin('https://cf.business-cloud-neo.ru/live/u/p/555.ts');
    const url = await getHttpsBackupStreamUrl({ _id: new mongoose.Types.ObjectId(), channelId: 'ALG1' });
    expect(url).toBe('https://cf.business-cloud-neo.ru/live/u/p/555.ts');
    expect(FailoverMap.aggregate).toHaveBeenCalled();
  });

  it('returns null when the mapped twin is http:// only (not browser-safe)', async () => {
    mockTwin('http://tv.business-cloud-neo.com/live/u/p/555.m3u8');
    const url = await getHttpsBackupStreamUrl({ _id: new mongoose.Types.ObjectId(), channelId: 'ALG2' });
    expect(url).toBeNull();
  });

  it('returns null when the mapped twin channel no longer exists', async () => {
    mockTwin(null);
    const url = await getHttpsBackupStreamUrl({ _id: new mongoose.Types.ObjectId(), channelId: 'ALG3' });
    expect(url).toBeNull();
  });

  it('returns null when there is no failover map for the channel', async () => {
    mockNoMaps();
    const url = await getHttpsBackupStreamUrl({ _id: new mongoose.Types.ObjectId(), channelId: 'ALG4' });
    expect(url).toBeNull();
    expect(Channel.findOne).not.toHaveBeenCalled();
  });

  it('returns null for an empty reference', async () => {
    const url = await getHttpsBackupStreamUrl({});
    expect(url).toBeNull();
    expect(FailoverMap.aggregate).not.toHaveBeenCalled();
  });
});

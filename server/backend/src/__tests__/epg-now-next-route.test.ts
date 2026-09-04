import request from 'supertest';
import express from 'express';

jest.mock('../models/User', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../models/Channel', () => ({
  find: jest.fn(),
  bulkWrite: jest.fn(),
}));

jest.mock('../models/EpgProgram', () => ({
  distinct: jest.fn().mockResolvedValue(['beinsports1.tr']),
}));

jest.mock('../services/epg-service', () => ({
  epgService: {
    getEpgForChannels: jest.fn(),
  },
}));

jest.mock('../services/cache', () => {
  const store = new Map<string, unknown>();
  return {
    epgCache: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: unknown) => {
        store.set(k, v);
      }),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tvRouter = require('../routes/tv');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const User = require('../models/User');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Channel = require('../models/Channel');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { epgService } = require('../services/epg-service');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tv', tvRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /epg/:code/now-next', () => {
  const future = (minutes: number) => new Date(Date.now() + minutes * 60000);

  it('returns now/next for channels with guide data and hasEpg=false fallback for the rest', async () => {
    (User.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });
    (User.findOne as jest.Mock).mockResolvedValue({
      channelListCode: 'TVTEST',
      isActive: true,
    });

    epgService.getEpgForChannels.mockResolvedValue([
      {
        channelEpgId: 'beinsports1.tr',
        title: 'Match Live',
        description: 'Full match',
        category: ['Sport'],
        startTime: future(-30),
        endTime: future(30),
      },
      {
        channelEpgId: 'beinsports1.tr',
        title: 'Post Match',
        description: '',
        category: ['Sport'],
        startTime: future(30),
        endTime: future(90),
      },
    ]);

    (Channel.find as jest.Mock).mockReturnValue({
      sort: () => ({
        limit: () => ({
          select: () => ({
            lean: async () => [
              { channelId: 'c1', tvgId: 'beinsports1.tr', channelName: 'beIN 1', tvgLogo: 'logo.png' },
              { channelId: 'c2', tvgId: '', channelName: 'No Guide TV', tvgLogo: '' },
            ],
          }),
        }),
      }),
    });

    const res = await request(buildApp()).get('/api/v1/tv/epg/TVTEST/now-next');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const chans = res.body.channels;
    expect(chans.length).toBeGreaterThanOrEqual(2);

    const withGuide = chans.find((c: any) => c.hasEpg);
    expect(withGuide.now?.title).toBe('Match Live');
    expect(withGuide.next?.title).toBe('Post Match');

    const withoutGuide = chans.find((c: any) => !c.hasEpg);
    expect(withoutGuide.now).toBeNull();
    expect(withoutGuide.next).toBeNull();
  });

  it('rejects invalid codes with 400', async () => {
    const res = await request(buildApp()).get('/api/v1/tv/epg/XX/now-next');
    expect(res.status).toBe(400);
  });
});

import request from 'supertest';
import express from 'express';

jest.mock('../models/User', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../models/Channel', () => ({
  find: jest.fn(),
}));

jest.mock('../models/EpgProgram', () => ({
  find: jest.fn(),
  distinct: jest.fn(),
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
const EpgProgram = require('../models/EpgProgram');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tv', tvRouter);
  return app;
}

const MIN = 60000;
const HOUR = 3600000;

function mockUser(code: string) {
  (User.findOne as jest.Mock).mockResolvedValue({
    _id: 'u1',
    username: 'tester',
    channelListCode: code,
    role: 'User',
    allCatalog: false,
    channels: ['ch1'],
    isActive: true,
    lastLogin: new Date(Date.now() - 3600000),
  });
  (User.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });
}

function mockChannels(channels: Array<Record<string, unknown>>) {
  const chain = {
    sort: () => ({
      limit: () => ({
        select: () => ({
          lean: async () => channels,
        }),
      }),
    }),
  };
  (Channel.find as jest.Mock).mockReturnValue(chain);
}

function mockPrograms(programs: Array<Record<string, unknown>>) {
  // Mirror the real MongoDB range filter the route relies on: the mocked
  // EpgProgram.find receives { channelEpgId, startTime: { $gte, $lt } } and we
  // apply the same window before returning documents.
  (EpgProgram.find as jest.Mock).mockImplementation((query: any) => {
    const range = query?.startTime || {};
    const gte = range.$gte ? Date.parse(range.$gte) : Number.NEGATIVE_INFINITY;
    const lt = range.$lt ? Date.parse(range.$lt) : Number.POSITIVE_INFINITY;
    const inWindow = programs.filter((p: any) => {
      const start = Date.parse(p.startTime);
      return start >= gte && start < lt;
    });
    const chain = {
      collation: () => ({
        sort: () => ({
          select: () => ({
            limit: () => ({
              lean: async () => inWindow,
            }),
          }),
        }),
      }),
    };
    return chain;
  });
  (EpgProgram.distinct as jest.Mock).mockResolvedValue(['beinsports1.tr']);
}

/** Same UTC-day window arithmetic the route uses — keeps expectations honest. */
function utcDayWindow(nowMs: number): { start: number; end: number } {
  const now = new Date(nowMs);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start, end: start + 24 * HOUR };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /epg/:code/matches-today', () => {
  it('returns only the sports matches inside today\'s window, sorted with channel info', async () => {
    mockUser('AAA111');
    mockChannels([
      { channelId: 'c1', tvgId: 'beinsports1.tr', tvgName: null, channelName: 'beIN 1', tvgLogo: 'https://cdn.example/logo.png' },
    ]);

    const nowMs = Date.now();
    const fixture = (startMs: number, endMs: number) => ({
      channelEpgId: 'beinsports1.tr',
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      description: '',
      language: 'ar',
    });
    const fixtures = [
      // Live now (sports, title keyword + category).
      { ...fixture(nowMs - 30 * MIN, nowMs + 30 * MIN), title: 'مباراة حية الآن', category: ['Sport'] },
      // Non-sports news — must be filtered out.
      { ...fixture(nowMs + 4 * HOUR, nowMs + 5 * HOUR), title: 'أخبار اليوم', category: ['News'] },
      // Upcoming sports (Arabic keyword).
      { ...fixture(nowMs + 2 * HOUR, nowMs + 4 * HOUR), title: 'دوري أبطال أوروبا: النهائي', category: [] },
      // Upcoming sports (Latin team-vs-team).
      { ...fixture(nowMs + 7 * HOUR, nowMs + 9 * HOUR), title: 'PSG vs Marseille', category: [], language: 'fr' },
      // Sports event starting tomorrow — outside the window.
      { ...fixture(nowMs + 30 * HOUR, nowMs + 32 * HOUR), title: 'مباراة الغد', category: [] },
    ];
    mockPrograms(fixtures);

    const res = await request(buildApp()).get('/api/v1/tv/epg/AAA111/matches-today');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Recompute the expected list with the same rules the route applies.
    const window = utcDayWindow(Date.now());
    const expected = fixtures
      .filter((f) => f.title !== 'أخبار اليوم')
      .filter(
        (f) =>
          Date.parse(f.startTime) >= window.start &&
          Date.parse(f.startTime) < window.end &&
          Date.parse(f.endTime) > nowMs,
      )
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

    expect(res.body.count).toBe(expected.length);
    expect(res.body.matches.map((m: any) => m.title)).toEqual(expected.map((f) => f.title));
    expect(res.body.matches.map((m: any) => m.status)).toEqual(
      expected.map((f) => (Date.parse(f.startTime) <= nowMs ? 'live' : 'upcoming')),
    );

    if (res.body.count > 0) {
      expect(res.body.matches[0].channel.name).toBe('beIN 1');
      expect(res.body.matches[0].channel.channelId).toBe('c1');
      expect(res.body.matches[0].channel.icon).toContain('logo');
    }
  });

  it('returns an empty success payload when the code has no EPG coverage', async () => {
    mockUser('BBB222');
    mockChannels([]);
    mockPrograms([]);
    (EpgProgram.distinct as jest.Mock).mockResolvedValue([]);

    const res = await request(buildApp()).get('/api/v1/tv/epg/BBB222/matches-today');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(0);
    expect(res.body.matches).toEqual([]);
    // No point querying programs when the scope has no EPG ids.
    expect(EpgProgram.find).not.toHaveBeenCalled();
  });

  it('rejects a malformed code with 400', async () => {
    const res = await request(buildApp()).get('/api/v1/tv/epg/XX/matches-today');
    expect(res.status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('404s for an unknown code', async () => {
    (User.findOne as jest.Mock).mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/v1/tv/epg/NOPE12/matches-today');
    expect(res.status).toBe(404);
  });
});

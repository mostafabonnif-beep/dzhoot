/**
 * End-to-end coverage of the display-name matching added to `buildGuideIndex`:
 * a catalog channel with no `tvgId` is linked to a guide id through the guide's
 * own `<display-name>` aliases (persisted in `EpgChannel`), using the REAL
 * resolver. The mocked suite (`epg-rematch-service.test.ts`) stubs the resolver,
 * so it cannot observe this path.
 *
 * Guard rails under test:
 *   - an alias that resolves to exactly one guide id matches;
 *   - an ambiguous alias (same cleaned name on two guide ids) is never used;
 *   - a guide-id-derived name keeps precedence over an alias.
 */
jest.mock('../models/Channel', () => ({
  find: jest.fn(),
  bulkWrite: jest.fn(),
}));
jest.mock('../models/EpgProgram', () => ({
  distinct: jest.fn(),
}));
jest.mock('../models/EpgChannel', () => ({
  find: jest.fn(),
}));

import Channel from '../models/Channel';
import EpgProgram from '../models/EpgProgram';
import EpgChannel from '../models/EpgChannel';
import { runEpgRematch } from './epg-rematch-service';

const ChannelMock = Channel as unknown as { find: jest.Mock; bulkWrite: jest.Mock };
const EpgProgramMock = EpgProgram as unknown as { distinct: jest.Mock };
const EpgChannelMock = EpgChannel as unknown as { find: jest.Mock };

function channelDoc(name: string, tvgId: string | null) {
  return { _id: `chan_${name}`, channelName: name, tvgId };
}

function mockChannels(docs: Array<{ channelName: string; tvgId: string | null }>) {
  ChannelMock.find.mockReturnValue({
    limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(docs) }),
  });
}

function mockEpgChannels(docs: Array<{ channelEpgId: string; displayNames: string[] }>) {
  EpgChannelMock.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(docs) });
}

function writtenTvgId(callIndex: number, opIndex: number): string {
  const ops = ChannelMock.bulkWrite.mock.calls[callIndex][0];
  return ops[opIndex].updateOne.update.$set.tvgId;
}

beforeEach(() => {
  jest.clearAllMocks();
  ChannelMock.bulkWrite.mockResolvedValue({ modifiedCount: 1 });
});

describe('runEpgRematch — display-name matching', () => {
  test('links a blank-tvgId channel through an unambiguous guide display-name', async () => {
    // The guide id does not canonicalize to the channel name; only its display-name does.
    EpgProgramMock.distinct.mockResolvedValue(['xyz.123.tr']);
    mockEpgChannels([{ channelEpgId: 'xyz.123.tr', displayNames: ['BBC One', 'BBC 1'] }]);
    mockChannels([channelDoc('BBC One HD', '')]);

    const result = await runEpgRematch();

    expect(result.matched).toBe(1);
    expect(ChannelMock.bulkWrite).toHaveBeenCalledTimes(1);
    expect(writtenTvgId(0, 0)).toBe('xyz.123.tr');
  });

  test('never uses an ambiguous display-name that maps to two guide ids', async () => {
    EpgProgramMock.distinct.mockResolvedValue(['news.a.tr', 'news.b.tr']);
    mockEpgChannels([
      { channelEpgId: 'news.a.tr', displayNames: ['News Channel'] },
      { channelEpgId: 'news.b.tr', displayNames: ['News Channel'] },
    ]);
    mockChannels([channelDoc('News Channel', '')]);

    const result = await runEpgRematch();

    expect(result.matched).toBe(0);
    expect(ChannelMock.bulkWrite).not.toHaveBeenCalled();
  });

  test('a guide-id-derived name keeps precedence over a display-name alias', async () => {
    // CARTOON.NETWORK.tr canonicalizes to "cartoon network" from its id; the alias
    // also claims "cartoon network" for a different id. The id-derived name wins.
    EpgProgramMock.distinct.mockResolvedValue(['CARTOON.NETWORK.tr', 'other.tr']);
    mockEpgChannels([{ channelEpgId: 'other.tr', displayNames: ['Cartoon Network'] }]);
    mockChannels([channelDoc('Cartoon Network', '')]);

    const result = await runEpgRematch();

    expect(result.matched).toBe(1);
    expect(writtenTvgId(0, 0)).toBe('CARTOON.NETWORK.tr');
  });

  test('ignores aliases for guide ids that have no programmes', async () => {
    // The alias points at a guide id absent from EpgProgram, so it is not a valid target.
    EpgProgramMock.distinct.mockResolvedValue(['present.tr']);
    mockEpgChannels([{ channelEpgId: 'ghost.tr', displayNames: ['Ghost Channel'] }]);
    mockChannels([channelDoc('Ghost Channel', '')]);

    const result = await runEpgRematch();

    expect(result.matched).toBe(0);
    expect(ChannelMock.bulkWrite).not.toHaveBeenCalled();
  });
});

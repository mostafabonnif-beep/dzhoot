jest.mock('../models/Channel', () => ({
  find: jest.fn(),
  bulkWrite: jest.fn(),
}));
jest.mock('../models/EpgProgram', () => ({
  distinct: jest.fn(),
}));
jest.mock('../utils/epg-id-resolver', () => ({
  epgIdName: jest.fn((id: string) => id.replace(/\.[a-z]{2,3}$/i, '').replace(/[._]+/g, ' ').trim()),
  extractBeinNumber: jest.fn((name: string) => {
    const m = name.match(/BEIN[^0-9]{0,40}?(\d{1,2})(?![0-9])/);
    return m ? m[1] : null;
  }),
  isBeinSportsFeed: jest.fn((name: string) => /BEIN/i.test(name) && !/CINEMA|FILM/i.test(name)),
  resolveEpgIdForChannel: jest.fn(),
}));

import Channel from '../models/Channel';
import EpgProgram from '../models/EpgProgram';
import { resolveEpgIdForChannel } from '../utils/epg-id-resolver';
import { runEpgRematch } from './epg-rematch-service';

const ChannelMock = Channel as unknown as { find: jest.Mock; bulkWrite: jest.Mock };
const EpgProgramMock = EpgProgram as unknown as { distinct: jest.Mock };
const resolveMock = resolveEpgIdForChannel as jest.Mock;

function channelDoc(name: string, tvgId: string | null) {
  return { _id: `chan_${name}`, channelName: name, tvgId };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runEpgRematch', () => {
  test('matches channels without a tvgId against current guide ids and bulk-writes updates', async () => {
    EpgProgramMock.distinct.mockResolvedValue([
      'CARTOON.NETWORK.tr',
      'BEIN_SPORTS1_DIGITAL_Mono_AR.bein',
      'BEIN_SPORTS2_DIGITAL_Mono_AR.bein',
      'Alkass_3_AR.bein',
    ]);
    ChannelMock.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          channelDoc('CARTOON NETWORK HD', ''),
          channelDoc('BEIN SPORTS 2 HD', ''),
          channelDoc('ALKASS 3', null),
        ]),
      }),
    });
    ChannelMock.bulkWrite.mockResolvedValue({ modifiedCount: 3 });

    resolveMock.mockImplementation(({ channelName }: { channelName: string }) => {
      if (channelName.startsWith('CARTOON')) return { tvgId: 'CARTOON.NETWORK.tr', via: 'generic' };
      if (channelName.startsWith('BEIN SPORTS 2')) return { tvgId: 'BEIN_SPORTS2_DIGITAL_Mono_AR.bein', via: 'bein' };
      if (channelName.startsWith('ALKASS')) return { tvgId: 'Alkass_3_AR.bein', via: 'generic' };
      return null;
    });

    const result = await runEpgRematch();

    expect(result.availableGuideIds).toBe(4);
    expect(result.candidates).toBe(3);
    expect(result.matched).toBe(3);
    expect(ChannelMock.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = ChannelMock.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(3);
    expect(ops[0].updateOne.update.$set.tvgId).toBe('CARTOON.NETWORK.tr');
  });

  test('never writes a tvgId that is not present in the guide ids', async () => {
    EpgProgramMock.distinct.mockResolvedValue(['AL_JAZEERA.ar']);
    ChannelMock.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([channelDoc('SOME CHANNEL', '')]),
      }),
    });
    resolveMock.mockReturnValue({ tvgId: 'NOT_IN_GUIDES.tr', via: 'generic' });

    const result = await runEpgRematch();
    expect(result.matched).toBe(0);
    expect(ChannelMock.bulkWrite).not.toHaveBeenCalled();
  });

  test('skips channels that already have a tvgId', async () => {
    EpgProgramMock.distinct.mockResolvedValue(['AL_JAZEERA.ar']);
    ChannelMock.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([channelDoc('BEIN SPORTS 9 HD', '')]),
      }),
    });
    resolveMock.mockReturnValue(null);

    const result = await runEpgRematch();
    expect(result.candidates).toBe(0);
    expect(result.matched).toBe(0);
    expect(ChannelMock.bulkWrite).not.toHaveBeenCalled();
  });

  test('propagates database errors', async () => {
    EpgProgramMock.distinct.mockRejectedValue(new Error('db down'));
    await expect(runEpgRematch()).rejects.toThrow('db down');
  });
});

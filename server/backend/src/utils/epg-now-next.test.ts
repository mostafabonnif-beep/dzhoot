import { buildNowNext } from './epg-now-next';

const T0 = new Date('2026-09-04T12:00:00.000Z');

function prog(
  channel: string,
  title: string,
  startOffsetMin: number,
  endOffsetMin: number,
): any {
  return {
    channelEpgId: channel,
    title,
    description: `desc-${title}`,
    category: ['series'],
    startTime: new Date(T0.getTime() + startOffsetMin * 60000),
    endTime: new Date(T0.getTime() + endOffsetMin * 60000),
  };
}

describe('buildNowNext', () => {
  it('picks the program whose window contains now as "now" and the following one as "next"', () => {
    const result = buildNowNext(
      [{ key: 'ch1', name: 'Channel One', icon: 'logo.png' }],
      [
        prog('CH1', 'earlier', -120, -60),
        prog('CH1', 'current', -30, 30),
        prog('CH1', 'upcoming', 30, 90),
      ],
      T0,
    );
    expect(result.withEpg).toBe(1);
    expect(result.withoutEpg).toBe(0);
    const ch = result.channels[0];
    expect(ch.hasEpg).toBe(true);
    expect(ch.now?.title).toBe('current');
    expect(ch.next?.title).toBe('upcoming');
    expect(ch.now?.start).toBe(new Date(T0.getTime() - 30 * 60000).toISOString());
    expect(ch.channelName).toBe('Channel One');
  });

  it('marks channels without guide data as hasEpg=false with null now/next (fallback)', () => {
    const result = buildNowNext(
      [
        { key: 'ch1', name: 'With Guide' },
        { key: 'ch2', name: 'No Guide' },
      ],
      [prog('ch1', 'current', -10, 10)],
      T0,
    );
    expect(result.withEpg).toBe(1);
    expect(result.withoutEpg).toBe(1);
    const noGuide = result.channels.find((c) => c.channelId === 'ch2');
    expect(noGuide?.hasEpg).toBe(false);
    expect(noGuide?.now).toBeNull();
    expect(noGuide?.next).toBeNull();
    expect(noGuide?.channelName).toBe('No Guide');
  });

  it('matches guide ids case-insensitively (beINSPORTS1.tr vs beINSports1.tr)', () => {
    const result = buildNowNext(
      [{ key: 'beINSports1.tr', name: 'beIN 1' }],
      [prog('BEINSPORTS1.TR', 'match', -5, 5)],
      T0,
    );
    expect(result.channels[0].hasEpg).toBe(true);
    expect(result.channels[0].now?.title).toBe('match');
  });

  it('treats a program that just ended as not-now', () => {
    const result = buildNowNext(
      [{ key: 'ch1', name: 'One' }],
      [prog('ch1', 'ended', -60, -1), prog('ch1', 'later', 60, 120)],
      T0,
    );
    expect(result.channels[0].now).toBeNull();
    expect(result.channels[0].next?.title).toBe('later');
  });
});

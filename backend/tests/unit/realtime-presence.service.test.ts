import { beforeEach, describe, expect, it } from 'vitest';
import { RealtimePresenceService } from '../../src/services/realtime/realtime-presence.service';

describe('RealtimePresenceService', () => {
  const service = RealtimePresenceService.getInstance();

  beforeEach(() => {
    service.clear();
  });

  it('tracks the first member in a room and returns the snapshot', () => {
    const result = service.trackMember('realtime:chat:lobby', 'socket-1', {
      type: 'user',
      presenceId: 'user-1',
      joinedAt: '2026-04-26T00:00:00.000Z',
    });

    expect(result.joinedMember).toMatchObject({
      type: 'user',
      presenceId: 'user-1',
    });
    expect(result.presence.members).toEqual([result.joinedMember!]);
  });

  it('deduplicates multiple sockets for the same user into one logical member', () => {
    const first = service.trackMember('realtime:chat:lobby', 'socket-1', {
      type: 'user',
      presenceId: 'user-1',
      joinedAt: '2026-04-26T00:00:00.000Z',
    });

    const second = service.trackMember('realtime:chat:lobby', 'socket-2', {
      type: 'user',
      presenceId: 'user-1',
      joinedAt: '2026-04-26T00:01:00.000Z',
    });

    expect(first.joinedMember).toBeDefined();
    expect(second.joinedMember).toBeUndefined();
    expect(second.presence.members).toEqual([first.joinedMember!]);
  });

  it('tracks anonymous sockets independently when there is no human user identity', () => {
    const first = service.trackMember('realtime:chat:lobby', 'socket-1', {
      type: 'anonymous',
      presenceId: 'socket-1',
      joinedAt: '2026-04-26T00:00:00.000Z',
    });

    const second = service.trackMember('realtime:chat:lobby', 'socket-2', {
      type: 'anonymous',
      presenceId: 'socket-2',
      joinedAt: '2026-04-26T00:01:00.000Z',
    });

    expect(first.joinedMember).toBeDefined();
    expect(second.joinedMember).toBeDefined();
    expect(second.presence.members).toEqual([
      {
        type: 'anonymous',
        presenceId: 'socket-1',
        joinedAt: first.joinedMember!.joinedAt,
      },
      {
        type: 'anonymous',
        presenceId: 'socket-2',
        joinedAt: second.joinedMember!.joinedAt,
      },
    ]);
  });

  it('does not emit a leave when another socket still represents the same member', () => {
    service.trackMember('realtime:chat:lobby', 'socket-1', {
      type: 'user',
      presenceId: 'user-1',
      joinedAt: '2026-04-26T00:00:00.000Z',
    });
    service.trackMember('realtime:chat:lobby', 'socket-2', {
      type: 'user',
      presenceId: 'user-1',
      joinedAt: '2026-04-26T00:01:00.000Z',
    });

    const result = service.removeSocketFromRoom('realtime:chat:lobby', 'socket-1');

    expect(result).toBeNull();
    expect(service.getPresence('realtime:chat:lobby').members).toHaveLength(1);
    expect(service.getPresence('realtime:chat:lobby').members[0]?.presenceId).toBe('user-1');
  });

  it('emits a leave when the final socket for a member disconnects', () => {
    const join = service.trackMember('realtime:chat:lobby', 'socket-1', {
      type: 'user',
      presenceId: 'user-1',
      joinedAt: '2026-04-26T00:00:00.000Z',
    });

    const result = service.removeSocketFromRoom('realtime:chat:lobby', 'socket-1');

    expect(join.joinedMember).toBeDefined();
    expect(result).toEqual(join.joinedMember);
    expect(service.getPresence('realtime:chat:lobby').members).toEqual([]);
  });

  it('removes a socket from every subscribed room during disconnect cleanup', () => {
    service.trackMember('realtime:chat:lobby', 'socket-1', {
      type: 'user',
      presenceId: 'user-1',
      joinedAt: '2026-04-26T00:00:00.000Z',
    });
    service.trackMember('realtime:alerts', 'socket-1', {
      type: 'user',
      presenceId: 'user-1',
      joinedAt: '2026-04-26T00:00:00.000Z',
    });

    const results = service.removeSocketFromAllRooms('socket-1');

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.roomName).sort()).toEqual([
      'realtime:alerts',
      'realtime:chat:lobby',
    ]);
    expect(service.getPresence('realtime:chat:lobby').members).toEqual([]);
    expect(service.getPresence('realtime:alerts').members).toEqual([]);
  });
});

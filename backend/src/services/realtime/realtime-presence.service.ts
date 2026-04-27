import type { PresenceMember, PresenceSnapshot } from '@insforge/shared-schemas';

interface PresenceEntry {
  member: PresenceMember;
  socketIds: Set<string>;
}

/**
 * Manages ephemeral realtime presence for the single backend instance.
 * Presence is stored in memory and scoped to logical channel rooms.
 */
export class RealtimePresenceService {
  private static instance: RealtimePresenceService;
  private channelPresence = new Map<string, Map<string, PresenceEntry>>();
  private socketMemberships = new Map<string, Map<string, string>>();

  private constructor() {}

  static getInstance(): RealtimePresenceService {
    if (!RealtimePresenceService.instance) {
      RealtimePresenceService.instance = new RealtimePresenceService();
    }
    return RealtimePresenceService.instance;
  }

  trackMember(
    roomName: string,
    socketId: string,
    member: PresenceMember
  ): { presence: PresenceSnapshot; joinedMember?: PresenceMember } {
    const roomPresence = this.getOrCreateRoomPresence(roomName);
    const presenceId = member.presenceId;
    const existingEntry = roomPresence.get(presenceId);

    if (existingEntry) {
      if (!existingEntry.socketIds.has(socketId)) {
        existingEntry.socketIds.add(socketId);
        this.setSocketMembership(socketId, roomName, presenceId);
      }

      return {
        presence: this.getPresence(roomName),
      };
    }

    roomPresence.set(presenceId, {
      member,
      socketIds: new Set([socketId]),
    });
    this.setSocketMembership(socketId, roomName, presenceId);

    return {
      presence: this.getPresence(roomName),
      joinedMember: member,
    };
  }

  removeSocketFromRoom(roomName: string, socketId: string): PresenceMember | null {
    const presenceId = this.socketMemberships.get(socketId)?.get(roomName);
    if (!presenceId) {
      return null;
    }

    const roomPresence = this.channelPresence.get(roomName);
    const entry = roomPresence?.get(presenceId);
    if (!roomPresence || !entry) {
      this.deleteSocketMembership(socketId, roomName);
      return null;
    }

    entry.socketIds.delete(socketId);
    this.deleteSocketMembership(socketId, roomName);

    if (entry.socketIds.size > 0) {
      return null;
    }

    roomPresence.delete(presenceId);
    if (roomPresence.size === 0) {
      this.channelPresence.delete(roomName);
    }

    return entry.member;
  }

  removeSocketFromAllRooms(socketId: string): Array<{ roomName: string; member: PresenceMember }> {
    const rooms = this.socketMemberships.get(socketId);
    if (!rooms) {
      return [];
    }

    const removedMembers: Array<{ roomName: string; member: PresenceMember }> = [];

    for (const roomName of rooms.keys()) {
      const member = this.removeSocketFromRoom(roomName, socketId);
      if (member) {
        removedMembers.push({ roomName, member });
      }
    }

    return removedMembers;
  }

  getPresence(roomName: string): PresenceSnapshot {
    const roomPresence = this.channelPresence.get(roomName);
    if (!roomPresence) {
      return { members: [] };
    }

    return {
      members: Array.from(roomPresence.values(), ({ member }) => member),
    };
  }

  clear(): void {
    this.channelPresence.clear();
    this.socketMemberships.clear();
  }

  private getOrCreateRoomPresence(roomName: string): Map<string, PresenceEntry> {
    let roomPresence = this.channelPresence.get(roomName);
    if (!roomPresence) {
      roomPresence = new Map();
      this.channelPresence.set(roomName, roomPresence);
    }
    return roomPresence;
  }

  private setSocketMembership(socketId: string, roomName: string, presenceId: string): void {
    let memberships = this.socketMemberships.get(socketId);
    if (!memberships) {
      memberships = new Map();
      this.socketMemberships.set(socketId, memberships);
    }
    memberships.set(roomName, presenceId);
  }

  private deleteSocketMembership(socketId: string, roomName: string): void {
    const memberships = this.socketMemberships.get(socketId);
    if (!memberships) {
      return;
    }

    memberships.delete(roomName);
    if (memberships.size === 0) {
      this.socketMemberships.delete(socketId);
    }
  }
}

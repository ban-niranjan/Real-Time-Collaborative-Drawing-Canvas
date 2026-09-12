/**
 * Room Management System
 * Handles multi-room isolation, user session tracking,
 * drawing state attachment, and graceful empty room retention.
 */

const DrawingState = require('./drawing-state');

const USER_COLORS = [
    '#EF4444', // Red
    '#F97316', // Orange
    '#F59E0B', // Amber
    '#10B981', // Emerald
    '#06B6D4', // Cyan
    '#3B82F6', // Blue
    '#6366F1', // Indigo
    '#8B5CF6', // Purple
    '#EC4899', // Pink
    '#14B8A6'  // Teal
];

const ADJECTIVES = ['Creative', 'Swift', 'Bright', 'Nimble', 'Bold', 'Calm', 'Vivid', 'Clever', 'Agile', 'Cosmic'];
const NOUNS = ['Artist', 'Painter', 'Sketcher', 'Doodler', 'Crafter', 'Otter', 'Falcon', 'Fox', 'Panda', 'Lynx'];

function generateUserName() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = Math.floor(Math.random() * 90) + 10;
    return `${adj} ${noun} ${num}`;
}

class RoomManager {
    constructor() {
        this.rooms = new Map();
        this.cleanupTimers = new Map();
        this.ROOM_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // Keep empty room history for 10 minutes
    }

    /**
     * Sanitize room ID
     */
    sanitizeRoomId(rawId) {
        if (!rawId || typeof rawId !== 'string') return 'general';
        const cleaned = rawId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
        return cleaned || 'general';
    }

    /**
     * Get or create room
     */
    getOrCreateRoom(rawRoomId) {
        const roomId = this.sanitizeRoomId(rawRoomId);

        // Cancel pending deletion if user rejoins
        if (this.cleanupTimers.has(roomId)) {
            clearTimeout(this.cleanupTimers.get(roomId));
            this.cleanupTimers.delete(roomId);
        }

        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, {
                id: roomId,
                createdAt: Date.now(),
                drawingState: new DrawingState(2000),
                clients: new Map() // socketId -> User
            });
        }

        return this.rooms.get(roomId);
    }

    getRoom(rawRoomId) {
        const roomId = this.sanitizeRoomId(rawRoomId);
        return this.rooms.get(roomId) || null;
    }

    /**
     * Add a user to a room
     */
    addUser(rawRoomId, socketId, requestedName = null) {
        const room = this.getOrCreateRoom(rawRoomId);
        const userCount = room.clients.size;
        const color = USER_COLORS[userCount % USER_COLORS.length];
        const name = requestedName && typeof requestedName === 'string' && requestedName.trim()
            ? requestedName.trim().slice(0, 24)
            : generateUserName();

        const user = {
            id: socketId,
            name,
            color,
            joinedAt: Date.now()
        };

        room.clients.set(socketId, user);
        return { room, user };
    }

    /**
     * Remove a user from a room
     */
    removeUser(rawRoomId, socketId) {
        const roomId = this.sanitizeRoomId(rawRoomId);
        const room = this.rooms.get(roomId);
        if (!room) return null;

        const removedUser = room.clients.get(socketId);
        room.clients.delete(socketId);

        // If room is empty, schedule memory release
        if (room.clients.size === 0) {
            if (this.cleanupTimers.has(roomId)) {
                clearTimeout(this.cleanupTimers.get(roomId));
            }
            const timer = setTimeout(() => {
                this.rooms.delete(roomId);
                this.cleanupTimers.delete(roomId);
            }, this.ROOM_IDLE_TIMEOUT_MS);
            this.cleanupTimers.set(roomId, timer);
        }

        return { room, user: removedUser };
    }

    /**
     * Get list of users in room
     */
    getRoomUsers(rawRoomId) {
        const room = this.getRoom(rawRoomId);
        if (!room) return [];
        return Array.from(room.clients.values()).map(u => ({
            id: u.id,
            name: u.name,
            color: u.color
        }));
    }
}

module.exports = RoomManager;

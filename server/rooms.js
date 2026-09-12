// Room management system (for future multi-room support)

class RoomManager {
    constructor() {
        this.rooms = new Map();
    }

    createRoom(roomId) {
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, { 
                id: roomId,
                clients: new Set(),
                drawingHistory: [],
                createdAt: Date.now()
            });
            console.log(`Room ${roomId} created`);
        } 
        return this.rooms.get(roomId);
    }

    getRoom(roomId) {
        return this.rooms.get(roomId);
    }

    addClientToRoom(roomId, clientId) {
        const room = this.getRoom(roomId) || this.createRoom(roomId);
        room.clients.add(clientId);
        return room;
    }

    removeClientFromRoom(roomId, clientId) {
        const room = this.getRoom(roomId);
        if (room) {
            room.clients.delete(clientId);
            
            // Clean up empty rooms
            if (room.clients.size === 0) {
                this.rooms.delete(roomId);
                console.log(`Room ${roomId} deleted (empty)`);
            }
        }
    }

    getRoomClients(roomId) {
        const room = this.getRoom(roomId);
        return room ? Array.from(room.clients) : [];
    }

    addToHistory(roomId, operation) {
        const room = this.getRoom(roomId);
        if (room) {
            room.drawingHistory.push(operation);
            
            // Limit history size
            if (room.drawingHistory.length > 1000) {
                room.drawingHistory.shift();
            }
        }
    }

    getHistory(roomId) {
        const room = this.getRoom(roomId);
        return room ? room.drawingHistory : [];
    }

    clearHistory(roomId) {
        const room = this.getRoom(roomId);
        if (room) {
            room.drawingHistory = [];
        }
    }
}


module.exports = RoomManager;


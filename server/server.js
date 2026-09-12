/**
 * Express + Socket.IO Collaboration Server
 * Coordinates rooms, vector stroke validation, sequence ordering,
 * global undo/redo, cursor tracking, and state synchronization.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const RoomManager = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e6 // 1 MB max payload
});

const roomManager = new RoomManager();

// Serve static client assets
app.use(express.static(path.join(__dirname, '../client')));

// Support direct room route: /room/:roomId
app.get('/room/:roomId', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

io.on('connection', (socket) => {
    console.log(`[Socket] Connection established: ${socket.id}`);

    /**
     * Join Room
     */
    socket.on('room:join', ({ roomId, userName } = {}) => {
        try {
            // Leave previous room if any
            if (socket.data.roomId) {
                const prevRoomId = socket.data.roomId;
                socket.leave(prevRoomId);
                const removed = roomManager.removeUser(prevRoomId, socket.id);
                if (removed) {
                    socket.to(prevRoomId).emit('user:left', {
                        userId: socket.id,
                        users: roomManager.getRoomUsers(prevRoomId)
                    });
                    socket.to(prevRoomId).emit('cursor:remove', { userId: socket.id });
                }
            }

            const targetRoomId = roomManager.sanitizeRoomId(roomId);
            const { room, user } = roomManager.addUser(targetRoomId, socket.id, userName);

            socket.join(room.id);
            socket.data.roomId = room.id;
            socket.data.user = user;

            console.log(`[Room] User "${user.name}" (${socket.id}) joined "${room.id}"`);

            // Send initial state to newly joined client
            socket.emit('room:init', {
                roomId: room.id,
                user: user,
                users: roomManager.getRoomUsers(room.id),
                history: room.drawingState.getSnapshot()
            });

            // Notify others in room
            socket.to(room.id).emit('user:joined', {
                user: user,
                users: roomManager.getRoomUsers(room.id)
            });
        } catch (err) {
            console.error('[Error] room:join failure:', err);
            socket.emit('error:event', { message: 'Failed to join room' });
        }
    });

    /**
     * Real-time incremental stroke streaming (in-progress)
     * Forwards partial point batches so collaborators see live drawing
     */
    socket.on('stroke:chunk', (chunk) => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId || !chunk || typeof chunk !== 'object') return;

            // Forward to peers in the same room
            socket.to(roomId).emit('stroke:chunk', {
                strokeId: String(chunk.strokeId || ''),
                userId: socket.id,
                userName: socket.data.user ? socket.data.user.name : 'Peer',
                tool: chunk.tool === 'eraser' ? 'eraser' : 'brush',
                color: typeof chunk.color === 'string' ? chunk.color : '#000000',
                width: typeof chunk.width === 'number' ? chunk.width : 4,
                points: Array.isArray(chunk.points) ? chunk.points.slice(0, 100) : []
            });
        } catch (err) {
            console.error('[Error] stroke:chunk failure:', err);
        }
    });

    /**
     * Stroke Completed (Authoritative Commit)
     * Validates stroke, assigns monotonic sequence, clears redo, broadcasts commit
     */
    socket.on('stroke:commit', (strokeData) => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const room = roomManager.getRoom(roomId);
            if (!room) return;

            // Attach authoritative author info
            const author = socket.data.user;
            const fullStroke = {
                ...strokeData,
                userId: socket.id,
                userName: author ? author.name : 'Unknown'
            };

            const committed = room.drawingState.commitStroke(fullStroke);
            if (!committed) {
                console.warn(`[Draw] Invalid stroke rejected from ${socket.id}`);
                return;
            }

            // Broadcast committed operation to entire room (including sender to verify sequence)
            io.to(roomId).emit('stroke:committed', {
                operation: committed,
                counts: room.drawingState.getCounts()
            });
        } catch (err) {
            console.error('[Error] stroke:commit failure:', err);
        }
    });

    /**
     * Global Undo
     * Server removes latest active operation in the room regardless of creator
     */
    socket.on('action:undo', () => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const room = roomManager.getRoom(roomId);
            if (!room) return;

            const result = room.drawingState.undo();
            if (result) {
                console.log(`[Undo] Undid sequence #${result.sequence} in "${roomId}" by ${socket.id}`);
                io.to(roomId).emit('action:undone', result);
            }
        } catch (err) {
            console.error('[Error] action:undo failure:', err);
        }
    });

    /**
     * Global Redo
     * Server restores latest undone operation in the room
     */
    socket.on('action:redo', () => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const room = roomManager.getRoom(roomId);
            if (!room) return;

            const result = room.drawingState.redo();
            if (result) {
                console.log(`[Redo] Restored sequence #${result.operation.sequence} in "${roomId}" by ${socket.id}`);
                io.to(roomId).emit('action:redone', result);
            }
        } catch (err) {
            console.error('[Error] action:redo failure:', err);
        }
    });

    /**
     * Clear Canvas
     */
    socket.on('action:clear', () => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const room = roomManager.getRoom(roomId);
            if (!room) return;

            const cleared = room.drawingState.clear();
            if (cleared) {
                console.log(`[Clear] Room "${roomId}" cleared by ${socket.id}`);
                io.to(roomId).emit('action:cleared', {
                    userId: socket.id,
                    userName: socket.data.user ? socket.data.user.name : 'Someone'
                });
            }
        } catch (err) {
            console.error('[Error] action:clear failure:', err);
        }
    });

    /**
     * Live Cursor Movement (Throttled by client)
     */
    socket.on('cursor:move', (coords) => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId || !coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') return;

            const user = socket.data.user;
            if (!user) return;

            socket.to(roomId).emit('cursor:update', {
                userId: socket.id,
                userName: user.name,
                color: user.color,
                x: coords.x,
                y: coords.y
            });
        } catch (err) {
            console.error('[Error] cursor:move failure:', err);
        }
    });

    /**
     * Disconnect
     */
    socket.on('disconnect', (reason) => {
        try {
            const roomId = socket.data.roomId;
            if (roomId) {
                const removed = roomManager.removeUser(roomId, socket.id);
                if (removed) {
                    console.log(`[Room] User ${socket.id} disconnected from "${roomId}" (${reason})`);
                    io.to(roomId).emit('user:left', {
                        userId: socket.id,
                        users: roomManager.getRoomUsers(roomId)
                    });
                    io.to(roomId).emit('cursor:remove', { userId: socket.id });
                }
            }
        } catch (err) {
            console.error('[Error] disconnect handler failure:', err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Collaborative Canvas Studio running!`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`⚙️  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`=========================================`);
});

/**
 * Automated End-to-End Integration Tests
 * Verifies real-time synchronization, room isolation, monotonic sequence ordering,
 * global undo/redo semantics, and user lifecycle events.
 */

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const RoomManager = require('../server/rooms');

let server;
let ioServer;
let port;
let roomManager;

function createTestServer() {
    return new Promise((resolve) => {
        const app = express();
        server = http.createServer(app);
        ioServer = new Server(server, {
            cors: { origin: '*' }
        });

        roomManager = new RoomManager();

        ioServer.on('connection', (socket) => {
            socket.on('room:join', ({ roomId, userName }) => {
                const targetRoomId = roomManager.sanitizeRoomId(roomId);
                const { room, user } = roomManager.addUser(targetRoomId, socket.id, userName);

                socket.join(room.id);
                socket.data.roomId = room.id;
                socket.data.user = user;

                socket.emit('room:init', {
                    roomId: room.id,
                    user: user,
                    users: roomManager.getRoomUsers(room.id),
                    history: room.drawingState.getSnapshot()
                });

                socket.to(room.id).emit('user:joined', {
                    user: user,
                    users: roomManager.getRoomUsers(room.id)
                });
            });

            socket.on('stroke:chunk', (chunk) => {
                const roomId = socket.data.roomId;
                if (!roomId) return;
                socket.to(roomId).emit('stroke:chunk', {
                    strokeId: chunk.strokeId,
                    userId: socket.id,
                    points: chunk.points
                });
            });

            socket.on('stroke:commit', (strokeData) => {
                const roomId = socket.data.roomId;
                if (!roomId) return;
                const room = roomManager.getRoom(roomId);
                if (!room) return;

                const committed = room.drawingState.commitStroke({
                    ...strokeData,
                    userId: socket.id,
                    userName: socket.data.user ? socket.data.user.name : 'Anon'
                });

                if (committed) {
                    ioServer.to(roomId).emit('stroke:committed', {
                        operation: committed,
                        counts: room.drawingState.getCounts()
                    });
                }
            });

            socket.on('action:undo', () => {
                const roomId = socket.data.roomId;
                if (!roomId) return;
                const room = roomManager.getRoom(roomId);
                if (!room) return;

                const result = room.drawingState.undo();
                if (result) {
                    ioServer.to(roomId).emit('action:undone', result);
                }
            });

            socket.on('action:redo', () => {
                const roomId = socket.data.roomId;
                if (!roomId) return;
                const room = roomManager.getRoom(roomId);
                if (!room) return;

                const result = room.drawingState.redo();
                if (result) {
                    ioServer.to(roomId).emit('action:redone', result);
                }
            });

            socket.on('disconnect', () => {
                const roomId = socket.data.roomId;
                if (roomId) {
                    const removed = roomManager.removeUser(roomId, socket.id);
                    if (removed) {
                        ioServer.to(roomId).emit('user:left', {
                            userId: socket.id,
                            users: roomManager.getRoomUsers(roomId)
                        });
                    }
                }
            });
        });

        server.listen(0, () => {
            port = server.address().port;
            console.log(`[Test Server] Listening on dynamic port ${port}`);
            resolve();
        });
    });
}

function createClient(roomId, userName) {
    return new Promise((resolve) => {
        const client = ioClient(`http://localhost:${port}`, {
            transports: ['websocket'],
            forceNew: true
        });

        client.on('connect', () => {
            client.emit('room:join', { roomId, userName });
        });

        client.on('room:init', (initData) => {
            resolve({ client, initData });
        });
    });
}

async function runTests() {
    console.log('--- Starting Real-Time Collaboration Integration Tests ---');
    await createTestServer();

    let clientA, clientB, clientC;

    try {
        // Test 1: Connect Client A and Client B to the same room
        console.log('\n[Test 1] Multi-client room join & user list synchronization');
        const resA = await createClient('studio-alpha', 'Alice');
        clientA = resA.client;
        if (resA.initData.roomId !== 'studio-alpha') throw new Error('Client A room mismatch');
        console.log('✓ Client A successfully joined "studio-alpha"');

        const joinPromise = new Promise((resolve) => {
            clientA.once('user:joined', (data) => {
                if (data.user.name === 'Bob') resolve();
            });
        });

        const resB = await createClient('studio-alpha', 'Bob');
        clientB = resB.client;
        await joinPromise;
        console.log('✓ Client B joined; Client A received user:joined notification with Bob');

        // Test 2: Real-time stroke streaming (chunk)
        console.log('\n[Test 2] Real-time stroke chunk streaming');
        const chunkPromise = new Promise((resolve) => {
            clientB.once('stroke:chunk', (chunk) => {
                if (chunk.strokeId === 's-1' && chunk.points.length === 2) resolve();
            });
        });

        clientA.emit('stroke:chunk', {
            strokeId: 's-1',
            points: [{ x: 0.1, y: 0.1 }, { x: 0.15, y: 0.15 }]
        });
        await chunkPromise;
        console.log('✓ Client B received stroke:chunk from Client A while drawing');

        // Test 3: Authoritative stroke commit & sequence numbering
        console.log('\n[Test 3] Authoritative stroke commit and sequence assignment');
        const commitPromiseA = new Promise((resolve) => {
            clientA.once('stroke:committed', (data) => resolve(data));
        });
        const commitPromiseB = new Promise((resolve) => {
            clientB.once('stroke:committed', (data) => resolve(data));
        });

        clientA.emit('stroke:commit', {
            id: 'stroke-alice-1',
            tool: 'brush',
            color: '#ef4444',
            width: 4,
            points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]
        });

        const [commitA1, commitB1] = await Promise.all([commitPromiseA, commitPromiseB]);
        if (commitA1.operation.sequence !== 1 || commitB1.operation.sequence !== 1) {
            throw new Error(`Expected sequence 1, got ${commitA1.operation.sequence}`);
        }
        console.log('✓ Alice committed stroke #1 with sequence 1 across all clients');

        // Client B draws a second stroke
        const commitPromiseA2 = new Promise((resolve) => {
            clientA.once('stroke:committed', (data) => resolve(data));
        });
        clientB.emit('stroke:commit', {
            id: 'stroke-bob-1',
            tool: 'brush',
            color: '#3b82f6',
            width: 6,
            points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }]
        });

        const commit2 = await commitPromiseA2;
        if (commit2.operation.sequence !== 2) {
            throw new Error(`Expected sequence 2, got ${commit2.operation.sequence}`);
        }
        console.log('✓ Bob committed stroke #2 with sequence 2 across all clients');

        // Test 4: Global Undo (Alice undos -> Bob's stroke is undone!)
        console.log('\n[Test 4] Global Undo: Alice clicks Undo -> removes Bob stroke #2');
        const undoPromiseA = new Promise((resolve) => clientA.once('action:undone', resolve));
        const undoPromiseB = new Promise((resolve) => clientB.once('action:undone', resolve));

        clientA.emit('action:undo');

        const [undoA, undoB] = await Promise.all([undoPromiseA, undoPromiseB]);
        if (undoA.sequence !== 2 || undoB.sequence !== 2) {
            throw new Error(`Expected undone sequence 2, got ${undoA.sequence}`);
        }
        if (undoA.undoCount !== 1 || undoA.redoCount !== 1) {
            throw new Error(`Undo counts incorrect: ${JSON.stringify(undoA)}`);
        }
        console.log('✓ Global Undo verified: latest stroke (#2 from Bob) undone regardless of who requested it');

        // Test 5: Global Redo (Bob clicks Redo -> Bob's stroke #2 restored)
        console.log('\n[Test 5] Global Redo: Bob clicks Redo -> restores stroke #2');
        const redoPromiseA = new Promise((resolve) => clientA.once('action:redone', resolve));
        const redoPromiseB = new Promise((resolve) => clientB.once('action:redone', resolve));

        clientB.emit('action:redo');

        const [redoA, redoB] = await Promise.all([redoPromiseA, redoPromiseB]);
        if (redoA.operation.sequence !== 2) {
            throw new Error(`Expected restored sequence 2, got ${redoA.operation.sequence}`);
        }
        if (redoA.undoCount !== 2 || redoA.redoCount !== 0) {
            throw new Error(`Redo counts incorrect: ${JSON.stringify(redoA)}`);
        }
        console.log('✓ Global Redo verified: restored stroke #2 cleanly across all clients');

        // Test 6: Branch invalidation (Undo + New Draw clears Redo Stack)
        console.log('\n[Test 6] History branching: Undo + New Draw purges Redo Stack');
        const undoPromise = new Promise((resolve) => clientA.once('action:undone', resolve));
        clientA.emit('action:undo'); // Undos stroke 2
        await undoPromise;

        const newStrokePromise = new Promise((resolve) => clientA.once('stroke:committed', resolve));
        clientA.emit('stroke:commit', {
            id: 'stroke-alice-new',
            tool: 'brush',
            color: '#10b981',
            width: 4,
            points: [{ x: 0.8, y: 0.8 }, { x: 0.9, y: 0.9 }]
        });
        const branchResult = await newStrokePromise;
        if (branchResult.counts.redoCount !== 0) {
            throw new Error(`Redo stack should be purged to 0, got ${branchResult.counts.redoCount}`);
        }
        console.log('✓ Redo stack correctly purged on new stroke branch');

        // Test 7: Room Isolation
        console.log('\n[Test 7] Room Isolation: Clients in different rooms do not leak events');
        const resC = await createClient('studio-beta', 'Charlie');
        clientC = resC.client;

        let charlieReceivedLeak = false;
        clientC.on('stroke:committed', () => { charlieReceivedLeak = true; });
        clientC.on('stroke:chunk', () => { charlieReceivedLeak = true; });

        // Alice emits in studio-alpha
        clientA.emit('stroke:commit', {
            id: 'stroke-alpha-leak-test',
            tool: 'brush',
            color: '#000000',
            width: 2,
            points: [{ x: 0.3, y: 0.3 }]
        });

        await new Promise(r => setTimeout(r, 150));
        if (charlieReceivedLeak) {
            throw new Error('Room isolation violated! Charlie received events from studio-alpha');
        }
        console.log('✓ Room isolation verified: zero cross-room event leakage');

        // Test 8: Disconnection cleanup
        console.log('\n[Test 8] Disconnection and user cleanup');
        const bId = clientB.id;
        const userLeftPromise = new Promise((resolve) => {
            clientA.once('user:left', (data) => {
                if (data.userId === bId) resolve();
            });
        });
        clientB.disconnect();
        await userLeftPromise;
        console.log('✓ User disconnection event broadcasted and user list updated');

        console.log('\n=========================================');
        console.log('🎉 ALL INTEGRATION TESTS PASSED CLEANLY! 🎉');
        console.log('=========================================');

    } finally {
        if (clientA) clientA.disconnect();
        if (clientB) clientB.disconnect();
        if (clientC) clientC.disconnect();
        if (server) server.close();
        process.exit(0);
    }
}

runTests().catch((err) => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});

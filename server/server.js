const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../client')));
 
const clients = new Map();
const drawingHistory = [];
let clientIdCounter = 0;
 
const MAX_HISTORY = 1000;
const USER_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];

function broadcast(message, excludeClient = null) {
    const data = JSON.stringify(message);
    clients.forEach((client, ws) => {
        if (ws !== excludeClient && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(data);
            } catch (error) {
                console.error('Error broadcasting to client:', error);
            }
        }
    });
}

function getConnectedUsers() {
    return Array.from(clients.values()).map(client => ({
        id: client.id,
        color: client.color,
        username: client.username
    }));
}

wss.on('connection', (ws) => {
    const clientId = ++clientIdCounter;
    const clientColor = USER_COLORS[clientId % USER_COLORS.length];
    
    clients.set(ws, {
        id: clientId,
        color: clientColor,
        username: `User ${clientId}`
    });

    console.log(`Client ${clientId} connected. Total clients: ${clients.size}`);

    try {
        ws.send(JSON.stringify({
            type: 'init',
            clientId: clientId,
            color: clientColor,
            history: drawingHistory,
            users: getConnectedUsers()
        }));
    } catch (error) {
        console.error('Error sending init message:', error);
    }

    broadcast({
        type: 'user-joined',
        user: {
            id: clientId,
            color: clientColor,
            username: `User ${clientId}`
        },
        users: getConnectedUsers()
    }, ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'draw':
                    if (typeof data.x0 !== 'number' || typeof data.y0 !== 'number' ||
                        typeof data.x1 !== 'number' || typeof data.y1 !== 'number') {
                        console.error('Invalid draw coordinates');
                        break;
                    }

                    const operation = {
                        type: 'draw',
                        x0: data.x0,
                        y0: data.y0,
                        x1: data.x1,
                        y1: data.y1,
                        color: data.color || '#000000',
                        width: data.width || 3,
                        tool: data.tool || 'brush',
                        opId: `${clientId}-${Date.now()}-${Math.random()}`,
                        userId: clientId,
                        timestamp: Date.now()
                    };
                    
                    drawingHistory.push(operation);
                    
                    if (drawingHistory.length > MAX_HISTORY) {
                        drawingHistory.shift();
                    }
                    
                    broadcast(operation, ws);
                    break;

                case 'undo':
                    if (drawingHistory.length > 0) {
                        const undoneOp = drawingHistory.pop();
                        broadcast({
                            type: 'undo',
                            operationId: undoneOp.opId,
                            userId: clientId
                        }, ws);
                    }
                    break;

                case 'redo':
                    if (data.operation) {
                        drawingHistory.push(data.operation);
                        
                        if (drawingHistory.length > MAX_HISTORY) {
                            drawingHistory.shift();
                        }
                    }
                    
                    broadcast({
                        type: 'redo',
                        operation: data.operation,
                        userId: clientId
                    }, ws);
                    break;

                case 'clear':
                    drawingHistory.length = 0;
                    broadcast({
                        type: 'clear',
                        userId: clientId
                    }, ws);
                    break;

                case 'cursor':
                    const cursorClient = clients.get(ws);
                    if (cursorClient && typeof data.x === 'number' && typeof data.y === 'number') {
                        broadcast({
                            type: 'cursor',
                            userId: clientId,
                            x: data.x,
                            y: data.y,
                            color: cursorClient.color
                        }, ws);
                    }
                    break;

                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        const client = clients.get(ws);
        
        if (client) {
            clients.delete(ws);
            console.log(`Client ${client.id} disconnected. Total clients: ${clients.size}`);
            
            broadcast({
                type: 'user-left',
                userId: client.id,
                users: getConnectedUsers()
            });
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        
        const client = clients.get(ws);
        if (client) {
            clients.delete(ws);
            console.log(`Client ${client.id} error disconnect`);
            
            broadcast({
                type: 'user-left',
                userId: client.id,
                users: getConnectedUsers()
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:3000`);
    console.log(`WebSocket server ready for connections`);

});


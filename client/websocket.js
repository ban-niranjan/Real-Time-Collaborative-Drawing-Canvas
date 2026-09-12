console.log('✅ websocket.js loaded');

class WebSocketManager {
    constructor() {
        this.ws = null;
        this.clientId = null;
        this.clientColor = null;
        this.connected = false;
        this.reconnectAttempts = 0; 
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
         
        this.messageQueue = []; 
        this.batchInterval = 16;
        this.isBatching = false;
        
        this.onInit = null;
        this.onDraw = null;
        this.onUndo = null;
        this.onRedo = null;
        this.onClear = null;
        this.onCursor = null;
        this.onUserJoined = null;
        this.onUserLeft = null;
        this.onConnectionChange = null;
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        try {
            this.ws = new WebSocket(wsUrl);
            this.setupEventHandlers();
        } catch (error) {
            console.error('WebSocket connection error:', error);
            this.handleReconnect();
        }
    }

    setupEventHandlers() {
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.connected = true;
            this.reconnectAttempts = 0;
            
            if (this.onConnectionChange) {
                this.onConnectionChange(true);
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.connected = false;
            
            if (this.onConnectionChange) {
                this.onConnectionChange(false);
            }
            
            this.handleReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    handleMessage(data) {
        switch(data.type) {
            case 'init':
                this.clientId = data.clientId;
                this.clientColor = data.color;
                if (this.onInit) {
                    this.onInit(data);
                }
                break;

            case 'draw':
                if (this.onDraw) {
                    this.onDraw(data);
                }
                break;

            case 'undo':
                if (this.onUndo) {
                    this.onUndo(data);
                }
                break;

            case 'redo':
                if (this.onRedo) {
                    this.onRedo(data);
                }
                break;

            case 'clear':
                if (this.onClear) {
                    this.onClear(data);
                }
                break;

            case 'cursor':
                if (this.onCursor) {
                    this.onCursor(data);
                }
                break;

            case 'user-joined':
                if (this.onUserJoined) {
                    this.onUserJoined(data);
                }
                break;

            case 'user-left':
                if (this.onUserLeft) {
                    this.onUserLeft(data);
                }
                break;

            default:
                console.log('Unknown message type:', data.type);
        }
    }

    handleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
            this.connect();
        }, delay);
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('WebSocket not connected, message not sent');
        }
    }

    sendDraw(drawData) {
        this.messageQueue.push({
            type: 'draw',
            ...drawData
        });

        if (!this.isBatching) {
            this.startBatching();
        }
    }

    startBatching() {
        this.isBatching = true;
        
        const processBatch = () => {
            if (this.messageQueue.length === 0) {
                this.isBatching = false;
                return;
            }

            const batch = this.messageQueue.splice(0, this.messageQueue.length);
            batch.forEach(msg => this.send(msg));

            setTimeout(processBatch, this.batchInterval);
        };

        processBatch();
    }

    sendUndo() {
        this.send({ type: 'undo' });
    }

    sendRedo(operation) {
        this.send({ 
            type: 'redo',
            operation: operation
        });
    }

    sendClear() {
        this.send({ type: 'clear' });
    }

    sendCursor(x, y) {
        if (!this.lastCursorSent || Date.now() - this.lastCursorSent > 50) {
            this.send({
                type: 'cursor',
                x: x,
                y: y
            });
            this.lastCursorSent = Date.now();
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }

}



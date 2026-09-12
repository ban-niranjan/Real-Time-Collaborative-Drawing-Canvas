/**
 * Robust Socket.IO Client Wrapper
 * Handles room joining, state synchronization, point batching,
 * cursor throttling, and automatic reconnection recovery.
 */

class SocketClient {
    constructor() {
        this.socket = null;
        this.roomId = null;
        this.currentUser = null;
        this.connected = false;

        // Throttling timers
        this.lastCursorTime = 0;
        this.cursorThrottleMs = 35;

        // Callback hooks
        this.onInit = null;
        this.onUserJoined = null;
        this.onUserLeft = null;
        this.onStrokeChunk = null;
        this.onStrokeCommitted = null;
        this.onActionUndone = null;
        this.onActionRedone = null;
        this.onActionCleared = null;
        this.onCursorUpdate = null;
        this.onCursorRemove = null;
        this.onConnectionChange = null;
    }

    connect(roomId, userName = null) {
        this.roomId = roomId;
        this.savedUserName = userName;

        if (this.onConnectionChange) {
            this.onConnectionChange('connecting');
        }

        // Initialize Socket.IO connection
        this.socket = io({
            transports: ['websocket', 'polling'],
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000
        });

        this.setupEventHandlers();
    }

    setupEventHandlers() {
        const s = this.socket;

        s.on('connect', () => {
            console.log('[Socket] Connected with ID:', s.id);
            this.connected = true;

            if (this.onConnectionChange) {
                this.onConnectionChange('connected');
            }

            // Join target room
            s.emit('room:join', {
                roomId: this.roomId,
                userName: this.currentUser ? this.currentUser.name : this.savedUserName
            });
        });

        s.on('disconnect', (reason) => {
            console.warn('[Socket] Disconnected:', reason);
            this.connected = false;

            if (this.onConnectionChange) {
                this.onConnectionChange(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
            }
        });

        s.on('connect_error', (err) => {
            console.warn('[Socket] Connection error:', err.message);
            if (this.onConnectionChange) {
                this.onConnectionChange('reconnecting');
            }
        });

        s.on('room:init', (data) => {
            console.log('[Socket] Room initialized:', data.roomId, 'User:', data.user);
            this.currentUser = data.user;
            if (this.onInit) this.onInit(data);
        });

        s.on('user:joined', (data) => {
            if (this.onUserJoined) this.onUserJoined(data);
        });

        s.on('user:left', (data) => {
            if (this.onUserLeft) this.onUserLeft(data);
        });

        s.on('stroke:chunk', (chunk) => {
            if (this.onStrokeChunk) this.onStrokeChunk(chunk);
        });

        s.on('stroke:committed', (data) => {
            if (this.onStrokeCommitted) this.onStrokeCommitted(data);
        });

        s.on('action:undone', (data) => {
            if (this.onActionUndone) this.onActionUndone(data);
        });

        s.on('action:redone', (data) => {
            if (this.onActionRedone) this.onActionRedone(data);
        });

        s.on('action:cleared', (data) => {
            if (this.onActionCleared) this.onActionCleared(data);
        });

        s.on('cursor:update', (cursor) => {
            if (this.onCursorUpdate) this.onCursorUpdate(cursor);
        });

        s.on('cursor:remove', (data) => {
            if (this.onCursorRemove) this.onCursorRemove(data);
        });
    }

    /**
     * Send in-progress stroke chunk to peers
     */
    sendStrokeChunk(chunk) {
        if (!this.connected || !this.socket) return;
        this.socket.emit('stroke:chunk', chunk);
    }

    /**
     * Send finalized stroke for authoritative commit
     */
    sendStrokeCommit(strokeData) {
        if (!this.connected || !this.socket) return;
        this.socket.emit('stroke:commit', strokeData);
    }

    sendUndo() {
        if (!this.connected || !this.socket) return;
        this.socket.emit('action:undo');
    }

    sendRedo() {
        if (!this.connected || !this.socket) return;
        this.socket.emit('action:redo');
    }

    sendClear() {
        if (!this.connected || !this.socket) return;
        this.socket.emit('action:clear');
    }

    /**
     * Send throttled cursor position
     */
    sendCursor(normX, normY) {
        if (!this.connected || !this.socket) return;

        const now = Date.now();
        if (now - this.lastCursorTime >= this.cursorThrottleMs) {
            this.lastCursorTime = now;
            this.socket.emit('cursor:move', { x: normX, y: normY });
        }
    }
}

window.SocketClient = SocketClient;

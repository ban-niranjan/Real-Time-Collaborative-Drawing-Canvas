/**
 * Main Application Orchestrator
 * Coordinates UI, CanvasEngine, SocketClient, and Overlay Cursor Animation.
 */

class CollaborativeApp {
    constructor() {
        this.canvasEngine = null;
        this.socketClient = null;

        // Overlay cursor state
        this.overlayCanvas = null;
        this.overlayCtx = null;
        this.remoteCursors = new Map(); // userId -> { x, y, userName, color, lastSeen }
        this.cursorAnimationId = null;

        // State counts
        this.undoCount = 0;
        this.redoCount = 0;

        // Room ID
        this.roomId = this.resolveRoomId();

        this.init();
    }

    /**
     * Parse room ID from URL or generate a clean room code
     */
    resolveRoomId() {
        const urlParams = new URLSearchParams(window.location.search);
        let room = urlParams.get('room');

        if (!room) {
            const pathParts = window.location.pathname.split('/');
            const roomIdx = pathParts.indexOf('room');
            if (roomIdx !== -1 && pathParts[roomIdx + 1]) {
                room = pathParts[roomIdx + 1];
            }
        }

        if (!room) {
            // Generate friendly default room code
            const randomCode = Math.random().toString(36).substring(2, 8);
            room = `studio-${randomCode}`;
            const newUrl = `${window.location.pathname}?room=${room}`;
            window.history.replaceState({ room }, '', newUrl);
        }

        return room.toLowerCase();
    }

    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    setup() {
        const mainCanvas = document.getElementById('canvas');
        const overlayCanvas = document.getElementById('cursors-canvas');

        if (!mainCanvas || !overlayCanvas) {
            console.error('Required canvas elements missing from DOM');
            return;
        }

        this.overlayCanvas = overlayCanvas;
        this.overlayCtx = overlayCanvas.getContext('2d');

        // Initialize Canvas Engine
        this.canvasEngine = new CanvasEngine(mainCanvas);

        // Initialize Socket Client
        this.socketClient = new SocketClient();

        this.setupOverlayCanvas();
        this.setupCanvasListeners();
        this.setupSocketListeners();
        this.setupUIControls();
        this.setupKeyboardShortcuts();

        // Connect to server
        this.socketClient.connect(this.roomId);

        // Start overlay cursor render loop
        this.startCursorRenderLoop();

        // Display room title
        const roomNameEl = document.getElementById('room-name-display');
        if (roomNameEl) {
            roomNameEl.textContent = this.roomId;
        }
    }

    /**
     * Overlay cursor canvas calibration
     */
    setupOverlayCanvas() {
        const resizeOverlay = () => {
            const rect = this.overlayCanvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            this.overlayCanvas.width = Math.round(rect.width * dpr);
            this.overlayCanvas.height = Math.round(rect.height * dpr);
            this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        resizeOverlay();
        window.addEventListener('resize', resizeOverlay);
    }

    /**
     * Canvas Engine -> Socket Events
     */
    setupCanvasListeners() {
        // Stream stroke chunks in real time
        this.canvasEngine.onStrokeChunk = (chunk) => {
            this.socketClient.sendStrokeChunk(chunk);
        };

        // Commit stroke when user lifts pointer
        this.canvasEngine.onStrokeEnd = (strokeData) => {
            this.socketClient.sendStrokeCommit(strokeData);
        };

        // Stream cursor coordinates (normalized 0.0 to 1.0)
        this.canvasEngine.onCursorMove = (normX, normY) => {
            this.socketClient.sendCursor(normX, normY);
        };
    }

    /**
     * Socket -> UI & Canvas Events
     */
    setupSocketListeners() {
        const s = this.socketClient;

        s.onConnectionChange = (status) => {
            this.updateConnectionStatus(status);
        };

        s.onInit = (data) => {
            // Update current user info
            const myBadge = document.getElementById('current-user-badge');
            if (myBadge && data.user) {
                myBadge.innerHTML = `
                    <span class="user-avatar-dot" style="background-color: ${data.user.color}"></span>
                    <span class="user-name">${data.user.name} (You)</span>
                `;
            }

            // Sync drawing history
            if (data.history && data.history.operations) {
                this.canvasEngine.setHistory(data.history.operations);
                this.undoCount = data.history.undoCount || 0;
                this.redoCount = data.history.redoCount || 0;
                this.updateUndoRedoUI();
            }

            this.updateOnlineUsers(data.users || []);
            this.showToast(`Connected to room: ${data.roomId}`, 'info');
        };

        s.onUserJoined = (data) => {
            this.updateOnlineUsers(data.users);
            this.showToast(`${data.user.name} joined the room`, 'info', data.user.color);
        };

        s.onUserLeft = (data) => {
            this.updateOnlineUsers(data.users);
            this.remoteCursors.delete(data.userId);
        };

        // Real-time remote stroke rendering
        s.onStrokeChunk = (chunk) => {
            this.canvasEngine.renderRemoteChunk(chunk);
        };

        // Stroke committed by server
        s.onStrokeCommitted = (data) => {
            this.canvasEngine.applyCommittedStroke(data.operation);
            if (data.counts) {
                this.undoCount = data.counts.undoCount;
                this.redoCount = data.counts.redoCount;
                this.updateUndoRedoUI();
            }
        };

        // Global Undo
        s.onActionUndone = (data) => {
            this.canvasEngine.removeOperation(data.operationId);
            this.undoCount = data.undoCount;
            this.redoCount = data.redoCount;
            this.updateUndoRedoUI();
        };

        // Global Redo
        s.onActionRedone = (data) => {
            this.canvasEngine.applyCommittedStroke(data.operation);
            this.undoCount = data.undoCount;
            this.redoCount = data.redoCount;
            this.updateUndoRedoUI();
        };

        // Canvas Cleared
        s.onActionCleared = (data) => {
            this.canvasEngine.clearCanvas();
            this.undoCount = 0;
            this.redoCount = 0;
            this.updateUndoRedoUI();
            this.showToast(`Canvas was cleared by ${data.userName}`, 'warning');
        };

        // Remote Cursor Position
        s.onCursorUpdate = (cursor) => {
            this.remoteCursors.set(cursor.userId, {
                x: cursor.x,
                y: cursor.y,
                userName: cursor.userName,
                color: cursor.color,
                lastSeen: Date.now()
            });
        };

        s.onCursorRemove = ({ userId }) => {
            this.remoteCursors.delete(userId);
        };
    }

    /**
     * UI Control Bindings
     */
    setupUIControls() {
        // Tool buttons
        const toolBtns = document.querySelectorAll('.tool-btn');
        toolBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                toolBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tool = btn.dataset.tool;
                this.canvasEngine.setTool(tool);
                this.updateCursorStyle(tool);
            });
        });

        // Color Presets
        const colorPresets = document.querySelectorAll('.color-swatch');
        const colorPicker = document.getElementById('color-picker');

        colorPresets.forEach(swatch => {
            swatch.addEventListener('click', () => {
                colorPresets.forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
                const color = swatch.dataset.color;
                this.canvasEngine.setColor(color);
                if (colorPicker) colorPicker.value = color;
                this.updateBrushPreview(color, this.canvasEngine.width);
            });
        });

        if (colorPicker) {
            colorPicker.addEventListener('input', (e) => {
                colorPresets.forEach(s => s.classList.remove('active'));
                this.canvasEngine.setColor(e.target.value);
                this.updateBrushPreview(e.target.value, this.canvasEngine.width);
            });
        }

        // Stroke Width Slider
        const widthSlider = document.getElementById('stroke-width-slider');
        const widthValDisplay = document.getElementById('stroke-width-val');

        if (widthSlider) {
            widthSlider.addEventListener('input', (e) => {
                const w = parseInt(e.target.value, 10);
                this.canvasEngine.setWidth(w);
                if (widthValDisplay) widthValDisplay.textContent = `${w}px`;
                this.updateBrushPreview(this.canvasEngine.color, w);
            });
        }

        // Undo Button
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => {
                this.socketClient.sendUndo();
            });
        }

        // Redo Button
        const redoBtn = document.getElementById('redo-btn');
        if (redoBtn) {
            redoBtn.addEventListener('click', () => {
                this.socketClient.sendRedo();
            });
        }

        // Clear Canvas Button
        const clearBtn = document.getElementById('clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (window.confirm('Clear the canvas for everyone in this room?')) {
                    this.socketClient.sendClear();
                }
            });
        }

        // Copy Room Link Button
        const copyLinkBtn = document.getElementById('copy-room-btn');
        if (copyLinkBtn) {
            copyLinkBtn.addEventListener('click', () => {
                const url = window.location.href;
                navigator.clipboard.writeText(url)
                    .then(() => this.showToast('Room link copied to clipboard!', 'success'))
                    .catch(() => {
                        prompt('Copy this room link:', url);
                    });
            });
        }

        // Export Canvas PNG
        const exportBtn = document.getElementById('export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportCanvasImage();
            });
        }

        // Initial preview update
        this.updateBrushPreview(this.canvasEngine.color, this.canvasEngine.width);
        this.updateUndoRedoUI();
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            // Avoid triggering shortcuts when typing into an input
            if (e.target.tagName === 'INPUT') return;

            if (e.ctrlKey || e.metaKey) {
                if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    if (this.undoCount > 0) this.socketClient.sendUndo();
                } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    if (this.redoCount > 0) this.socketClient.sendRedo();
                }
            } else {
                if (e.key.toLowerCase() === 'b') {
                    const brushBtn = document.querySelector('.tool-btn[data-tool="brush"]');
                    if (brushBtn) brushBtn.click();
                } else if (e.key.toLowerCase() === 'e') {
                    const eraserBtn = document.querySelector('.tool-btn[data-tool="eraser"]');
                    if (eraserBtn) eraserBtn.click();
                } else if (e.key === '[') {
                    const w = Math.max(1, this.canvasEngine.width - 2);
                    this.setStrokeWidth(w);
                } else if (e.key === ']') {
                    const w = Math.min(50, this.canvasEngine.width + 2);
                    this.setStrokeWidth(w);
                }
            }
        });
    }

    setStrokeWidth(w) {
        this.canvasEngine.setWidth(w);
        const slider = document.getElementById('stroke-width-slider');
        const display = document.getElementById('stroke-width-val');
        if (slider) slider.value = w;
        if (display) display.textContent = `${w}px`;
        this.updateBrushPreview(this.canvasEngine.color, w);
    }

    updateCursorStyle(tool) {
        const canvas = document.getElementById('canvas');
        if (!canvas) return;
        if (tool === 'eraser') {
            canvas.style.cursor = 'cell';
        } else {
            canvas.style.cursor = 'crosshair';
        }
    }

    updateBrushPreview(color, width) {
        const dot = document.getElementById('brush-preview-dot');
        if (dot) {
            dot.style.backgroundColor = this.canvasEngine.tool === 'eraser' ? '#94a3b8' : color;
            dot.style.width = `${Math.max(4, Math.min(32, width))}px`;
            dot.style.height = `${Math.max(4, Math.min(32, width))}px`;
        }
    }

    updateUndoRedoUI() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');

        if (undoBtn) {
            undoBtn.disabled = this.undoCount === 0;
            const badge = undoBtn.querySelector('.action-badge');
            if (badge) badge.textContent = this.undoCount;
        }

        if (redoBtn) {
            redoBtn.disabled = this.redoCount === 0;
            const badge = redoBtn.querySelector('.action-badge');
            if (badge) badge.textContent = this.redoCount;
        }
    }

    updateConnectionStatus(status) {
        const badge = document.getElementById('connection-status-badge');
        if (!badge) return;

        badge.className = `status-pill ${status}`;
        if (status === 'connected') {
            badge.innerHTML = `<span class="pulse-indicator online"></span>Connected`;
        } else if (status === 'reconnecting') {
            badge.innerHTML = `<span class="pulse-indicator connecting"></span>Reconnecting...`;
        } else {
            badge.innerHTML = `<span class="pulse-indicator offline"></span>Offline`;
        }
    }

    updateOnlineUsers(users) {
        const container = document.getElementById('online-users-list');
        const countBadge = document.getElementById('online-count-badge');

        if (countBadge) {
            countBadge.textContent = users.length;
        }

        if (!container) return;

        const currentSocketId = this.socketClient.socket ? this.socketClient.socket.id : null;

        container.innerHTML = users.map(user => {
            const isMe = user.id === currentSocketId;
            const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

            return `
                <div class="collaborator-item ${isMe ? 'is-self' : ''}" title="${user.name}">
                    <div class="user-avatar" style="border-color: ${user.color}">
                        <span style="color: ${user.color}">${initials}</span>
                    </div>
                    <div class="user-details">
                        <span class="user-name">${user.name} ${isMe ? '<small>(You)</small>' : ''}</span>
                        <span class="user-status-dot" style="background-color: ${user.color}"></span>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Overlay Remote Cursor Loop (RequestAnimationFrame)
     */
    startCursorRenderLoop() {
        const render = () => {
            const rect = this.overlayCanvas.getBoundingClientRect();
            this.overlayCtx.clearRect(0, 0, rect.width, rect.height);

            const now = Date.now();

            this.remoteCursors.forEach((c, userId) => {
                // Drop inactive cursors after 4 seconds
                if (now - c.lastSeen > 4000) {
                    this.remoteCursors.delete(userId);
                    return;
                }

                const px = c.x * rect.width;
                const py = c.y * rect.height;

                this.drawRemoteCursor(px, py, c.userName, c.color);
            });

            this.cursorAnimationId = requestAnimationFrame(render);
        };

        this.cursorAnimationId = requestAnimationFrame(render);
    }

    drawRemoteCursor(x, y, name, color) {
        const ctx = this.overlayCtx;
        ctx.save();

        // Draw cursor pointer arrow
        ctx.fillStyle = color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 15);
        ctx.lineTo(x + 4, y + 11);
        ctx.lineTo(x + 9, y + 16);
        ctx.lineTo(x + 12, y + 13);
        ctx.lineTo(x + 7, y + 9);
        ctx.lineTo(x + 12, y + 9);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw user name label tag
        ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const textMetrics = ctx.measureText(name);
        const tagWidth = textMetrics.width + 12;
        const tagHeight = 18;
        const tagX = x + 14;
        const tagY = y + 12;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(tagX, tagY, tagWidth, tagHeight, 4);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(name, tagX + 6, tagY + 13);

        ctx.restore();
    }

    exportCanvasImage() {
        const main = document.getElementById('canvas');
        if (!main) return;

        // Render clean composition on white background
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = main.width;
        exportCanvas.height = main.height;
        const expCtx = exportCanvas.getContext('2d');

        // Fill background white
        expCtx.fillStyle = '#ffffff';
        expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

        // Draw active drawing layer
        expCtx.drawImage(main, 0, 0);

        const dataUrl = exportCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `collaborative-canvas-${this.roomId}-${Date.now()}.png`;
        link.href = dataUrl;
        link.click();

        this.showToast('Drawing exported as PNG!', 'success');
    }

    showToast(message, type = 'info', accentColor = null) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        if (accentColor) {
            toast.style.borderLeftColor = accentColor;
        }
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    }
}

// Instantiate application on page load
window.app = new CollaborativeApp();

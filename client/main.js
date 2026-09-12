console.log('✅ main.js loaded');

class CollaborativeCanvas {
    constructor() {
        this.canvas = null;
        this.wsManager = null; 
        this.drawingHistory = [];
        this.redoStack = [];
        this.remoteCursors = new Map(); 
        this.users = [];
         
        this.fps = 0;
        this.lastFrameTime = Date.now();
        
        this.init();
    }

    init() {
        if (document.readyState === 'loading') { 
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    setup() {
        const canvasElement = document.getElementById('canvas');
        if (!canvasElement) {
            console.error('Canvas element not found!');
            return;
        }

        this.canvas = new CanvasDrawing(canvasElement);
        this.wsManager = new WebSocketManager();
        
        this.setupWebSocketCallbacks();
        this.setupCanvasCallbacks();
        this.setupControls();
        this.setupCursorsCanvas();
        this.startPerformanceMonitoring();
        
        this.wsManager.connect();
    }

    setupWebSocketCallbacks() {
        this.wsManager.onInit = (data) => {
            console.log('Initialized:', data.clientId);
            
            const userIdEl = document.getElementById('user-id');
            const userColorEl = document.getElementById('user-color');
            
            if (userIdEl) userIdEl.textContent = `You: User ${data.clientId}`;
            if (userColorEl) userColorEl.style.backgroundColor = data.color;
            
            if (data.history && data.history.length > 0) {
                this.drawingHistory = data.history;
                this.canvas.redrawFromHistory(data.history);
            }
            
            this.updateUsersList(data.users);
            this.updateUndoRedoButtons();
        };

        this.wsManager.onDraw = (data) => {
            this.drawingHistory.push(data);
            this.canvas.queueRemoteDraw(data);
            this.updateUndoRedoButtons();
        };

        this.wsManager.onUndo = (data) => {
            console.log('Received undo event from server');
            if (this.drawingHistory.length > 0) {
                const undoneOp = this.drawingHistory.pop();
                this.redoStack.push(undoneOp);
                this.canvas.redrawFromHistory(this.drawingHistory);
                this.updateUndoRedoButtons();
            }
        };

        this.wsManager.onRedo = (data) => {
            console.log('Received redo event from server');
            if (data.operation) {
                this.drawingHistory.push(data.operation);
                this.canvas.redrawFromHistory(this.drawingHistory);
                
                const index = this.redoStack.findIndex(op => op.opId === data.operation.opId);
                if (index !== -1) {
                    this.redoStack.splice(index, 1);
                }
                
                this.updateUndoRedoButtons();
            }
        };

        this.wsManager.onClear = () => {
            this.drawingHistory = [];
            this.redoStack = [];
            this.canvas.clear();
            this.updateUndoRedoButtons();
        };

        this.wsManager.onCursor = (data) => {
            this.updateRemoteCursor(data);
        };

        this.wsManager.onUserJoined = (data) => {
            this.updateUsersList(data.users);
            this.showNotification(`${data.user.username} joined`, data.user.color);
        };

        this.wsManager.onUserLeft = (data) => {
            this.updateUsersList(data.users);
            this.remoteCursors.delete(data.userId);
            this.showNotification(`User ${data.userId} left`, '#999');
        };

        this.wsManager.onConnectionChange = (connected) => {
            const statusEl = document.getElementById('connection-status');
            if (statusEl) {
                statusEl.textContent = connected ? 'Connected' : 'Disconnected';
                statusEl.className = connected ? 'status connected' : 'status disconnected';
            }
        };
    }

    setupCanvasCallbacks() {
        this.canvas.onDraw = (drawData) => {
            this.wsManager.sendDraw(drawData);
        };

        this.canvas.onCursorMove = (x, y) => {
            this.wsManager.sendCursor(x, y);
        };
    }

    setupControls() {
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.canvas.setTool(e.target.dataset.tool);
            });
        });

        const colorPicker = document.getElementById('color-picker');
        if (colorPicker) {
            colorPicker.addEventListener('input', (e) => {
                this.canvas.setColor(e.target.value);
            });
        }

        const brushSize = document.getElementById('brush-size');
        const brushSizeValue = document.getElementById('brush-size-value');
        if (brushSize && brushSizeValue) {
            brushSize.addEventListener('input', (e) => {
                const size = parseInt(e.target.value);
                this.canvas.setWidth(size);
                brushSizeValue.textContent = size;
            });
        }

        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => {
                console.log('Undo clicked, history length:', this.drawingHistory.length);
                if (this.drawingHistory.length > 0) {
                    const undoneOp = this.drawingHistory.pop();
                    this.redoStack.push(undoneOp);
                    this.canvas.redrawFromHistory(this.drawingHistory);
                    this.updateUndoRedoButtons();
                    
                    // Send to server AFTER local update
                    this.wsManager.sendUndo();
                } else {
                    console.log('Nothing to undo');
                }
            });
        }

        const redoBtn = document.getElementById('redo-btn');
        if (redoBtn) {
            redoBtn.addEventListener('click', () => {
                console.log('Redo clicked, redo stack length:', this.redoStack.length);
                if (this.redoStack.length > 0) {
                    const redoOp = this.redoStack.pop();
                    this.drawingHistory.push(redoOp);
                    this.canvas.redrawFromHistory(this.drawingHistory);
                    this.updateUndoRedoButtons();
                    
                    // Send to server AFTER local update
                    this.wsManager.sendRedo(redoOp);
                } else {
                    console.log('Nothing to redo');
                }
            });
        }

        const clearBtn = document.getElementById('clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Clear canvas for everyone?')) {
                    this.wsManager.sendClear();
                    this.drawingHistory = [];
                    this.redoStack = [];
                    this.canvas.clear();
                    this.updateUndoRedoButtons();
                }
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    if (undoBtn && !undoBtn.disabled) {
                        undoBtn.click();
                    }
                } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
                    e.preventDefault();
                    if (redoBtn && !redoBtn.disabled) {
                        redoBtn.click();
                    }
                }
            }
        });

        document.querySelectorAll('.color-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const color = e.target.dataset.color;
                if (color && colorPicker) {
                    colorPicker.value = color;
                    colorPicker.dispatchEvent(new Event('input'));
                }
            });
        });
    }

    updateUndoRedoButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        
        if (undoBtn) {
            undoBtn.disabled = this.drawingHistory.length === 0;
            console.log('Undo button:', this.drawingHistory.length === 0 ? 'disabled' : 'enabled', '(history:', this.drawingHistory.length, ')');
        }
        if (redoBtn) {
            redoBtn.disabled = this.redoStack.length === 0;
            console.log('Redo button:', this.redoStack.length === 0 ? 'disabled' : 'enabled', '(redo stack:', this.redoStack.length, ')');
        }
    }

    updateUsersList(users) {
        this.users = users;
        const usersList = document.getElementById('users-list');
        const usersCount = document.getElementById('users-count');
        
        if (usersList) {
            usersList.innerHTML = users.map(user => `
                <div class="user-item">
                    <span class="user-color" style="background-color: ${user.color}"></span>
                    <span>${user.username}</span>
                </div>
            `).join('');
        }
        
        if (usersCount) usersCount.textContent = users.length;
    }

    setupCursorsCanvas() {
        const cursorsCanvas = document.getElementById('cursors-canvas');
        const mainCanvas = document.getElementById('canvas');
        
        if (cursorsCanvas && mainCanvas) {
            cursorsCanvas.width = mainCanvas.width;
            cursorsCanvas.height = mainCanvas.height;
            this.animateCursors();
        }
    }

    updateRemoteCursor(data) {
        this.remoteCursors.set(data.userId, {
            x: data.x,
            y: data.y,
            color: data.color,
            lastUpdate: Date.now()
        });
    }

    animateCursors() {
        const cursorsCanvas = document.getElementById('cursors-canvas');
        if (!cursorsCanvas) return;
        
        const ctx = cursorsCanvas.getContext('2d');
        if (!ctx) return;
        
        const animate = () => {
            ctx.clearRect(0, 0, cursorsCanvas.width, cursorsCanvas.height);
            
            const now = Date.now();
            this.remoteCursors.forEach((cursor, userId) => {
                if (now - cursor.lastUpdate > 2000) {
                    this.remoteCursors.delete(userId);
                    return;
                }
                
                ctx.save();
                ctx.fillStyle = cursor.color;
                ctx.beginPath();
                ctx.arc(cursor.x, cursor.y, 5, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.fillStyle = '#000';
                ctx.font = '12px Arial';
                ctx.fillText(`User ${userId}`, cursor.x + 10, cursor.y - 10);
                ctx.restore();
            });
            
            requestAnimationFrame(animate);
        };
        
        animate();
    }

    startPerformanceMonitoring() {
        setInterval(() => {
            const now = Date.now();
            const delta = now - this.lastFrameTime;
            this.fps = Math.round(1000 / delta);
            this.lastFrameTime = now;
            
            const fpsCounter = document.getElementById('fps-counter');
            if (fpsCounter) fpsCounter.textContent = `${this.fps} FPS`;
        }, 1000);
    }

    showNotification(message, color) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.style.borderLeft = `4px solid ${color}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}

// Initialize app
new CollaborativeCanvas();





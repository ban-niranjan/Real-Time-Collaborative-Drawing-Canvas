console.log('✅ canvas.js loaded');

class CanvasDrawing {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d', { willReadFrequently: true });
        this.isDrawing = false; 
        this.currentTool = 'brush';
        this.currentColor = '#000000';
        this.currentWidth = 3;
        this.lastX = 0;
        this.lastY = 0;
        this.drawQueue = [];
        this.isProcessingQueue = false;
        this.setupCanvas();
        this.bindEvents();
    }
    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());        
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }
    resizeCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const oldImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        
        this.ctx.putImageData(oldImageData, 0, 0);
    }
    bindEvents() {
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
        });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
        });
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            const mouseEvent = new MouseEvent('mouseup', {});
            this.canvas.dispatchEvent(mouseEvent);
        });
    }
    getCoordinates(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }
    startDrawing(e) {
        this.isDrawing = true;
        const coords = this.getCoordinates(e);
        this.lastX = coords.x;
        this.lastY = coords.y;
        
        if (this.onDrawStart) {
            this.onDrawStart(coords.x, coords.y);
        }
    }
    draw(e) {
        if (!this.isDrawing) {
            if (this.onCursorMove) {
                const coords = this.getCoordinates(e);
                this.onCursorMove(coords.x, coords.y);
            }
            return;
        }
        const coords = this.getCoordinates(e);    
        this.drawLine(this.lastX, this.lastY, coords.x, coords.y, this.currentColor, this.currentWidth, this.currentTool);
        if (this.onDraw) {
            this.onDraw({
                x0: this.lastX,
                y0: this.lastY,
                x1: coords.x,
                y1: coords.y,
                color: this.currentColor,
                width: this.currentWidth,
                tool: this.currentTool
            });
        }
        this.lastX = coords.x;
        this.lastY = coords.y;
    }
    stopDrawing() {
        if (this.isDrawing) {
            this.isDrawing = false;
            if (this.onDrawEnd) {
                this.onDrawEnd();
            }
        }
    }
    drawLine(x0, y0, x1, y1, color, width, tool = 'brush') {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(x0, y0);
        this.ctx.lineTo(x1, y1);
        this.ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : color;
        this.ctx.lineWidth = width;
        this.ctx.stroke();
        this.ctx.restore();
    }

    queueRemoteDraw(operation) {
        this.drawQueue.push(operation);
        if (!this.isProcessingQueue) {
            this.processDrawQueue();
        }
    }

    processDrawQueue() {
        this.isProcessingQueue = true;
        
        const processNext = () => {
            if (this.drawQueue.length === 0) {
                this.isProcessingQueue = false;
                return;
            }

            const batch = this.drawQueue.splice(0, 10);
            batch.forEach(op => {
                this.drawLine(op.x0, op.y0, op.x1, op.y1, op.color, op.width, op.tool);
            });

            requestAnimationFrame(processNext);
        };

        requestAnimationFrame(processNext);
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    setTool(tool) {
        this.currentTool = tool;
    }

    setColor(color) {
        this.currentColor = color;
    }

    setWidth(width) {
        this.currentWidth = width;
    }

    getCanvasState() {
        return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    setCanvasState(imageData) {
        this.ctx.putImageData(imageData, 0, 0);
    }

    redrawFromHistory(history) {
        this.clear();
        history.forEach(op => {
            if (op.type === 'draw') {
                this.drawLine(op.x0, op.y0, op.x1, op.y1, op.color, op.width, op.tool);
            }
        });
    }

}


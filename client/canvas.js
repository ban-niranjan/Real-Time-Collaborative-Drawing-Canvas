/**
 * High-Performance HTML5 Canvas Drawing Engine
 * 
 * Features:
 * - High-DPI / Retina display support via devicePixelRatio
 * - Unified Pointer Events (mouse, touch, stylus) with pointer capture
 * - Coalesced event batching for high polling rate mice/styluses
 * - Silky smooth quadratic Bezier curve interpolation
 * - Native Canvas compositing eraser (destination-out)
 * - Normalized coordinate system (0.0 to 1.0) for multi-device cross-resolution sync
 * - Incremental local and remote stroke rendering (no full canvas redraw while drawing)
 * - Non-destructive ResizeObserver re-rendering
 */

class CanvasEngine {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d', { alpha: true, desynchronized: true });

        // Tool state
        this.tool = 'brush';       // 'brush' | 'eraser'
        this.color = '#3b82f6';
        this.width = 4;

        // Active stroke tracking
        this.isDrawing = false;
        this.activePointerId = null;
        this.currentLocalStroke = null;
        this.remoteActiveStrokes = new Map(); // strokeId -> strokeData

        // Committed operations log
        this.operations = [];

        // DPR and dimensions
        this.dpr = window.devicePixelRatio || 1;
        this.widthCss = 0;
        this.heightCss = 0;

        // Callbacks
        this.onStrokeStart = null;
        this.onStrokeChunk = null;
        this.onStrokeEnd = null;
        this.onCursorMove = null;

        this.init();
    }

    init() {
        this.resize();
        this.bindEvents();
        this.observeResize();
    }

    /**
     * Dynamic DPI & Canvas Dimension Calibration
     */
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        this.widthCss = rect.width;
        this.heightCss = rect.height;
        this.dpr = window.devicePixelRatio || 1;

        // Set buffer size to actual physical device pixels
        this.canvas.width = Math.round(this.widthCss * this.dpr);
        this.canvas.height = Math.round(this.heightCss * this.dpr);

        // Reset transform and scale by DPR
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        // Configure default line styles
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        // Redraw all committed operations to preserve quality
        this.redrawAll();
    }

    observeResize() {
        if (window.ResizeObserver) {
            let resizeTimeout;
            const ro = new ResizeObserver(() => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => this.resize(), 50);
            });
            ro.observe(this.canvas.parentElement);
        } else {
            window.addEventListener('resize', () => this.resize());
        }
    }

    /**
     * Unified Pointer Event Listeners
     */
    bindEvents() {
        this.canvas.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
        this.canvas.addEventListener('pointermove', (e) => this.handlePointerMove(e));
        this.canvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
        this.canvas.addEventListener('pointercancel', (e) => this.handlePointerUp(e));

        // Prevent standard touch gestures (scrolling, pinch zoom) on canvas
        this.canvas.style.touchAction = 'none';
    }

    /**
     * Map screen coordinates to normalized coordinates (0.0 to 1.0)
     */
    getNormalizedCoords(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (clientX - rect.left) / rect.width;
        const y = (clientY - rect.top) / rect.height;
        return {
            x: Math.max(0, Math.min(1, x)),
            y: Math.max(0, Math.min(1, y))
        };
    }

    /**
     * Denormalize coordinates to current CSS pixels
     */
    toCssCoords(normPoint) {
        return {
            x: normPoint.x * this.widthCss,
            y: normPoint.y * this.heightCss
        };
    }

    handlePointerDown(e) {
        // Only accept primary button
        if (e.button !== 0 && e.pointerType === 'mouse') return;

        this.isDrawing = true;
        this.activePointerId = e.pointerId;
        try {
            this.canvas.setPointerCapture(e.pointerId);
        } catch (_) {}

        const pt = this.getNormalizedCoords(e.clientX, e.clientY);
        const strokeId = `stroke-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        this.currentLocalStroke = {
            id: strokeId,
            tool: this.tool,
            color: this.color,
            width: this.width,
            points: [pt],
            lastRenderedIndex: 0
        };

        // Draw initial dot immediately
        this.renderPointDot(pt, this.tool, this.color, this.width);

        if (this.onStrokeStart) {
            this.onStrokeStart({
                strokeId,
                tool: this.tool,
                color: this.color,
                width: this.width,
                point: pt
            });
        }
    }

    handlePointerMove(e) {
        const normPt = this.getNormalizedCoords(e.clientX, e.clientY);

        // Notify cursor tracker
        if (this.onCursorMove) {
            this.onCursorMove(normPt.x, normPt.y);
        }

        if (!this.isDrawing || e.pointerId !== this.activePointerId || !this.currentLocalStroke) {
            return;
        }

        // Support coalesced pointer events for high-polling rate devices
        const events = (typeof e.getCoalescedEvents === 'function')
            ? e.getCoalescedEvents()
            : [e];

        const newPoints = [];
        for (let i = 0; i < events.length; i++) {
            const pt = this.getNormalizedCoords(events[i].clientX, events[i].clientY);
            // Deduplicate points that haven't moved noticeably
            const last = this.currentLocalStroke.points[this.currentLocalStroke.points.length - 1];
            const distSq = (pt.x - last.x) ** 2 + (pt.y - last.y) ** 2;
            if (distSq > 0.0000005) { // sub-pixel filter
                this.currentLocalStroke.points.push(pt);
                newPoints.push(pt);
            }
        }

        if (newPoints.length > 0) {
            this.renderLocalStrokeIncremental();

            if (this.onStrokeChunk) {
                this.onStrokeChunk({
                    strokeId: this.currentLocalStroke.id,
                    tool: this.currentLocalStroke.tool,
                    color: this.currentLocalStroke.color,
                    width: this.currentLocalStroke.width,
                    points: newPoints
                });
            }
        }
    }

    handlePointerUp(e) {
        if (!this.isDrawing || (this.activePointerId !== null && e.pointerId !== this.activePointerId)) {
            return;
        }

        this.isDrawing = false;
        try {
            if (this.activePointerId !== null) {
                this.canvas.releasePointerCapture(this.activePointerId);
            }
        } catch (_) {}
        this.activePointerId = null;

        if (this.currentLocalStroke) {
            const completedStroke = {
                id: this.currentLocalStroke.id,
                tool: this.currentLocalStroke.tool,
                color: this.currentLocalStroke.color,
                width: this.currentLocalStroke.width,
                points: this.currentLocalStroke.points
            };

            this.currentLocalStroke = null;

            if (this.onStrokeEnd) {
                this.onStrokeEnd(completedStroke);
            }
        }
    }

    /**
     * Render smooth quadratic Bezier curves incrementally for local stroke
     */
    renderLocalStrokeIncremental() {
        if (!this.currentLocalStroke) return;

        const pts = this.currentLocalStroke.points;
        const startIdx = this.currentLocalStroke.lastRenderedIndex;
        if (pts.length < 2 || startIdx >= pts.length - 1) return;

        this.ctx.save();
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.lineWidth = this.currentLocalStroke.width;

        if (this.currentLocalStroke.tool === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.strokeStyle = this.currentLocalStroke.color;
        }

        this.ctx.beginPath();
        const p0 = this.toCssCoords(pts[startIdx]);
        this.ctx.moveTo(p0.x, p0.y);

        for (let i = startIdx + 1; i < pts.length; i++) {
            const pCurrent = this.toCssCoords(pts[i]);
            const pPrev = this.toCssCoords(pts[i - 1]);
            const midX = (pPrev.x + pCurrent.x) / 2;
            const midY = (pPrev.y + pCurrent.y) / 2;

            this.ctx.quadraticCurveTo(pPrev.x, pPrev.y, midX, midY);
        }

        const pLast = this.toCssCoords(pts[pts.length - 1]);
        this.ctx.lineTo(pLast.x, pLast.y);
        this.ctx.stroke();
        this.ctx.restore();

        this.currentLocalStroke.lastRenderedIndex = pts.length - 1;
    }

    /**
     * Render incoming remote stroke points in real-time
     */
    renderRemoteChunk(chunk) {
        if (!chunk || !chunk.points || chunk.points.length === 0) return;

        let stroke = this.remoteActiveStrokes.get(chunk.strokeId);
        if (!stroke) {
            stroke = {
                id: chunk.strokeId,
                tool: chunk.tool,
                color: chunk.color,
                width: chunk.width,
                points: [],
                lastRenderedIndex: 0
            };
            this.remoteActiveStrokes.set(chunk.strokeId, stroke);
        }

        const startIdx = Math.max(0, stroke.points.length - 1);
        stroke.points.push(...chunk.points);

        this.ctx.save();
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.lineWidth = stroke.width;

        if (stroke.tool === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.strokeStyle = stroke.color;
        }

        const pts = stroke.points;
        if (pts.length === 1) {
            this.renderPointDot(pts[0], stroke.tool, stroke.color, stroke.width);
        } else {
            this.ctx.beginPath();
            const p0 = this.toCssCoords(pts[startIdx]);
            this.ctx.moveTo(p0.x, p0.y);

            for (let i = startIdx + 1; i < pts.length; i++) {
                const pCurrent = this.toCssCoords(pts[i]);
                const pPrev = this.toCssCoords(pts[i - 1]);
                const midX = (pPrev.x + pCurrent.x) / 2;
                const midY = (pPrev.y + pCurrent.y) / 2;

                this.ctx.quadraticCurveTo(pPrev.x, pPrev.y, midX, midY);
            }

            const pLast = this.toCssCoords(pts[pts.length - 1]);
            this.ctx.lineTo(pLast.x, pLast.y);
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    /**
     * Render single point dot
     */
    renderPointDot(normPoint, tool, color, width) {
        const pt = this.toCssCoords(normPoint);
        this.ctx.save();
        if (tool === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.fillStyle = 'rgba(0,0,0,1)';
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.fillStyle = color;
        }

        this.ctx.beginPath();
        this.ctx.arc(pt.x, pt.y, Math.max(1, width / 2), 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
    }

    /**
     * Render a full stroke operation cleanly
     */
    renderFullStroke(stroke) {
        if (!stroke || !stroke.points || stroke.points.length === 0) return;

        const pts = stroke.points;
        if (pts.length === 1) {
            this.renderPointDot(pts[0], stroke.tool, stroke.color, stroke.width);
            return;
        }

        this.ctx.save();
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.lineWidth = stroke.width;

        if (stroke.tool === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.strokeStyle = stroke.color;
        }

        this.ctx.beginPath();
        const p0 = this.toCssCoords(pts[0]);
        this.ctx.moveTo(p0.x, p0.y);

        for (let i = 1; i < pts.length; i++) {
            const pPrev = this.toCssCoords(pts[i - 1]);
            const pCurr = this.toCssCoords(pts[i]);
            const midX = (pPrev.x + pCurr.x) / 2;
            const midY = (pPrev.y + pCurr.y) / 2;
            this.ctx.quadraticCurveTo(pPrev.x, pPrev.y, midX, midY);
        }

        const pLast = this.toCssCoords(pts[pts.length - 1]);
        this.ctx.lineTo(pLast.x, pLast.y);
        this.ctx.stroke();
        this.ctx.restore();
    }

    /**
     * Clear and redraw entire operations list
     */
    redrawAll() {
        this.ctx.clearRect(0, 0, this.widthCss, this.heightCss);

        // Sort by sequence for deterministic rendering
        const sorted = [...this.operations].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

        for (let i = 0; i < sorted.length; i++) {
            this.renderFullStroke(sorted[i]);
        }
    }

    /**
     * Finalize committed stroke
     */
    applyCommittedStroke(stroke) {
        // Clean up any in-progress remote tracking
        if (this.remoteActiveStrokes.has(stroke.id)) {
            this.remoteActiveStrokes.delete(stroke.id);
        }

        // Check if already in operations
        const existingIdx = this.operations.findIndex(op => op.id === stroke.id);
        if (existingIdx !== -1) {
            this.operations[existingIdx] = stroke;
        } else {
            this.operations.push(stroke);
            // Render stroke directly onto canvas if it's the latest
            this.renderFullStroke(stroke);
        }
    }

    setHistory(operations) {
        this.operations = Array.isArray(operations) ? [...operations] : [];
        this.remoteActiveStrokes.clear();
        this.redrawAll();
    }

    removeOperation(operationId) {
        const idx = this.operations.findIndex(op => op.id === operationId);
        if (idx !== -1) {
            this.operations.splice(idx, 1);
            this.redrawAll();
        }
    }

    clearCanvas() {
        this.operations = [];
        this.remoteActiveStrokes.clear();
        this.ctx.clearRect(0, 0, this.widthCss, this.heightCss);
    }

    setTool(tool) {
        this.tool = tool;
    }

    setColor(color) {
        this.color = color;
    }

    setWidth(width) {
        this.width = width;
    }
}

window.CanvasEngine = CanvasEngine;

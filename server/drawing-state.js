/**
 * Server-Authoritative Drawing State for a Room
 * Manages ordered vector stroke operations, global undo/redo stacks,
 * sequence numbering, and payload validation.
 */

class DrawingState {
    constructor(maxOperations = 2000) {
        this.maxOperations = maxOperations;
        this.operations = [];      // Active committed strokes in chronological order
        this.undoneStack = [];     // Undone strokes ready for redo
        this.sequenceCounter = 0;  // Monotonically increasing room sequence ID
    }

    /**
     * Validate incoming stroke data from client
     * Protects server against corrupt, malicious, or unbounded payloads
     */
    validateStroke(data) {
        if (!data || typeof data !== 'object') return null;

        const tool = data.tool === 'eraser' ? 'eraser' : 'brush';
        const color = typeof data.color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(data.color)
            ? data.color
            : '#000000';
        
        const width = typeof data.width === 'number' && Number.isFinite(data.width)
            ? Math.max(1, Math.min(100, Math.round(data.width)))
            : 4;

        if (!Array.isArray(data.points) || data.points.length === 0) {
            return null;
        }

        // Bound points to maximum 5,000 points per stroke to prevent DoS
        const rawPoints = data.points.slice(0, 5000);
        const validPoints = [];

        for (let i = 0; i < rawPoints.length; i++) {
            const p = rawPoints[i];
            if (p && typeof p.x === 'number' && typeof p.y === 'number' &&
                Number.isFinite(p.x) && Number.isFinite(p.y)) {
                // Normalize coordinates clamped reasonably
                validPoints.push({
                    x: Math.max(0, Math.min(1, p.x)),
                    y: Math.max(0, Math.min(1, p.y))
                });
            }
        }

        if (validPoints.length === 0) return null;

        return {
            id: typeof data.id === 'string' && data.id.length > 0 ? data.id.slice(0, 64) : `op-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            userId: String(data.userId || 'anon'),
            userName: String(data.userName || 'Artist').slice(0, 32),
            tool,
            color,
            width,
            points: validPoints,
            timestamp: Date.now()
        };
    }

    /**
     * Commit a completed stroke to room history.
     * Assigns authoritative sequence number and purges the redo stack.
     */
    commitStroke(strokeData) {
        const validated = this.validateStroke(strokeData);
        if (!validated) return null;

        this.sequenceCounter += 1;
        validated.sequence = this.sequenceCounter;

        this.operations.push(validated);
        if (this.operations.length > this.maxOperations) {
            this.operations.shift();
        }

        // Standard history branching: new action clears redo stack
        this.undoneStack.length = 0;

        return validated;
    }

    /**
     * Global Undo:
     * Pops the most recent active operation regardless of who drew it.
     */
    undo() {
        if (this.operations.length === 0) return null;

        const undoneOp = this.operations.pop();
        this.undoneStack.push(undoneOp);

        return {
            operationId: undoneOp.id,
            sequence: undoneOp.sequence,
            undoCount: this.operations.length,
            redoCount: this.undoneStack.length
        };
    }

    /**
     * Global Redo:
     * Restores the most recently undone operation.
     */
    redo() {
        if (this.undoneStack.length === 0) return null;

        const restoredOp = this.undoneStack.pop();
        this.operations.push(restoredOp);

        return {
            operation: restoredOp,
            undoCount: this.operations.length,
            redoCount: this.undoneStack.length
        };
    }

    /**
     * Clear all drawings in the room.
     */
    clear() {
        const previousCount = this.operations.length;
        this.operations.length = 0;
        this.undoneStack.length = 0;
        return previousCount > 0;
    }

    /**
     * Snapshot sent to newly connected or reconnecting clients.
     */
    getSnapshot() {
        return {
            operations: this.operations,
            sequence: this.sequenceCounter,
            undoCount: this.operations.length,
            redoCount: this.undoneStack.length
        };
    }

    getCounts() {
        return {
            undoCount: this.operations.length,
            redoCount: this.undoneStack.length
        };
    }
}

module.exports = DrawingState;

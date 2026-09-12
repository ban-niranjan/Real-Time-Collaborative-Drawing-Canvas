
class DrawingState {  // Drawing state management
    constructor() {
        this.operations = [];
        this.maxOperations = 1000;
    }

    addOperation(operation) {
        this.operations.push(operation);
        
        if (this.operations.length > this.maxOperations) {         // Prevent memory leak  
            this.operations.shift();
        }
        return operation;
    }
    removeLastOperation() {
        return this.operations.pop();
    }

    getOperations() {
        return [...this.operations];
    }

    getOperationCount() {
        return this.operations.length;
    }

    clear() {
        this.operations = [];
    }

    getOperationsByUser(userId) {    // Get operations by user
        return this.operations.filter(op => op.userId === userId);
    }

    getOperationsAfter(timestamp) {    // Get operations after a specific timestamp
        return this.operations.filter(op => op.timestamp > timestamp);
    }

    getSnapshot() {    //  getsnapshot (for new users joining)
        return {
            operations: this.operations,
            count: this.operations.length,
            timestamp: Date.now()
        };
    }

    restoreFromSnapshot(snapshot) {    // Restore from snapshot
        if (snapshot && snapshot.operations) {
            this.operations = snapshot.operations;
        }
    }
}


module.exports = DrawingState;



#  Architecture Documentation

This document explains how the real-time collaborative drawing application works behind the scenes. It covers the system design, data flow, WebSocket communication, undo/redo logic, performance choices, and how conflicts are handled when multiple users draw at the same time.

---

##  Data Flow Diagram

The app uses a client–server model with WebSockets for two-way communication. The browser captures drawing events and sends them to the server, which then broadcasts them to all connected clients.

### High-Level Data Flow

```
You draw something
    ↓
Your browser: "Hey server, I drew from point A to B"
    ↓
Server: "Got it! Everyone listen up!"
    ↓
Server broadcasts to all other users
    ↓
Their browsers: "Okay, drawing that now!"
    ↓
Everyone sees the same drawing! 
```
##  System Architecture

Here's how the pieces fit together:
```
┌─────────────────┐                    ┌─────────────────┐
│   Browser 1     │                    │   Node.js       │
│   (User A)      │◄──── WebSocket ───►│   Server        │
│                 │                    │   (Mediator)    │
│  - Canvas       │                    │                 │
│  - WebSocket    │                    │  - Express      │
│  - Main Logic   │                    │  - WebSocket    │
└─────────────────┘                    │  - History      │
                                       └─────────────────┘
┌─────────────────┐                            ▲
│   Browser 2     │                            │
│   (User B)      │◄──── WebSocket ────────────┘
│                 │
│  - Canvas       │
│  - WebSocket    │
│  - Main Logic   │
└─────────────────┘
```

**Key Points:**
- Each user connects directly to the server via WebSocket
- Server doesn't care about the drawing itself, just passes messages around
- All drawing happens in the browser (client-side rendering)

---

##  WebSocket Protocol

The app uses WebSocket events instead of HTTP requests to achieve real-time two-way communication.

### Client → Server Events

| Event | Description |
|--------|----------------|
| `stroke:start` | User begins drawing (tool, color, size) |
| `stroke:point` | Sends points while drawing (x,y coordinates) |
| `stroke:end` | User finishes a stroke; server commits it as an operation |
| `undo` | User requests to undo the latest operation |
| `redo` | User requests to redo the last undone operation |
| `cursor` | Sends user cursor position periodically |

### Server → Client Events

| Event | Description |
|--------|----------------|
| `state:snapshot` | Sends full history and active users when a user joins |
| `op:commit` | Broadcasts a newly completed stroke to everyone |
| `op:undo` | Removes the latest operation across all clients |
| `op:redo` | Reapplies the last undone operation |
| `users:update` | Updated user list when someone joins/leaves |
| `cursor` | Shows live cursor position of other users |
| `user:left` | Notifies users when someone disconnects |

---

## Undo/Redo Strategy

Undo/Redo is implemented as a **global operation**, not per user. This ensures the entire canvas stays consistent for all users.

### Logic

- Each completed stroke is saved as an “operation” on the server.
- Server maintains:
  - `ops[]` = list of committed operations
  - `undone[]` = stack of undone operations
- **Undo**:
  - Last operation is removed from `ops[]`, pushed to `undone[]`, and broadcast to all clients
  - Clients redraw canvas based on updated `ops[]`
- **Redo**:
  - Last undone operation is moved back to `ops[]` and broadcast
  - Clients reapply it

### Why this approach?

- Keeps all clients in sync
- Prevents conflicts between per-user undo histories
- Easy to maintain and understand

---

##  Performance Decisions

To ensure smooth real-time drawing and low latency, a few key optimizations were used:

| Decision | Reason |
|------------|----------------|
| **Batching drawing points** | Reduces network load during fast mouse movement |
| **Redrawing only on commit/undo/redo** | Avoids unnecessary full canvas updates |
| **Bezier curve smoothing** | Converts sampled mouse points into smooth strokes |
| **Throttled cursor updates** | Prevents flooding WebSocket with cursor data |
| **Server stores operations, client replays** | Keeps canvas deterministic and consistent |

### Goal of Optimizations

- Maintain 50–60 FPS drawing experience
- Reduce network traffic
- Keep UI responsive even with multiple users drawing

---

##  Conflict Resolution

When multiple users draw simultaneously, their operations may overlap. The system follows a simple and predictable approach:

### Strategy: **Order-Based Rendering (Last Write Wins)**

- Each stroke is treated as a separate immutable operation
- The order in which the server receives operations determines which stroke appears on top
- No merging of strokes is required

### Why this strategy?

- Works well for drawing tools since overlapping is expected
- Simple to implement and maintain
- Keeps rendering consistent for all users

---

##  Summary

This architecture is designed to provide:

- Real-time synchronized drawing for multiple users
- Clear and consistent shared canvas state
- Efficient WebSocket communication
- Simple yet reliable undo/redo handling
- Predictable conflict resolution for simultaneous actions

It provides a solid foundation that can be extended to include persistence, private rooms, additional tools, and advanced collaborative features in the future.




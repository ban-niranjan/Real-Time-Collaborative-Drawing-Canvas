# CanvasFlow Studio — Real-Time Collaborative Drawing Canvas

A high-performance, real-time collaborative drawing canvas built with **Vanilla JavaScript (ES6+)**, **HTML5 Canvas**, **Node.js**, **Express**, and **Socket.IO**. Designed with zero third-party UI or drawing frameworks, this project demonstrates multi-room isolation, server-authoritative global undo/redo, ordered conflict resolution, sub-pixel quadratic Bezier smoothing, and high-DPI rendering.

---

## Table of Contents
1. [Overview](#overview)
2. [Key Features](#key-features)
3. [Tech Stack](#tech-stack)
4. [Installation & Quick Start](#installation--quick-start)
5. [Multi-User & Multi-Room Testing](#multi-user--multi-room-testing)
6. [Real-Time Synchronization Engine](#real-time-synchronization-engine)
7. [Global Undo / Redo Mechanism](#global-undo--redo-mechanism)
8. [Performance & Rendering Decisions](#performance--rendering-decisions)
9. [Known Limitations & Trade-offs](#known-limitations--trade-offs)
10. [Browser Compatibility](#browser-compatibility)
11. [Deployment Instructions](#deployment-instructions)
12. [Time Spent Breakdown](#time-spent-breakdown)

---

## Overview

CanvasFlow Studio enables distributed teams and collaborators to sketch, wireframe, and brainstorm simultaneously on an infinite-feel shared digital canvas. Every stroke is captured as a vector operation, streamed incrementally as users draw, and committed with monotonic sequence numbers.

Unlike naive drawing apps that stream heavy raster images or send uncoordinated raw mouse segments, CanvasFlow Studio implements a **server-authoritative vector operation model** with **normalized coordinates**, ensuring identical visual fidelity across varying screen sizes, window resizes, and device pixel ratios.

---

## Key Features

- **Multi-Room Isolation**: Rooms are isolated via URL query (`?room=design-critique`) or path (`/room/design-critique`). Room history, online rosters, and live cursors are isolated from other rooms.
- **Incremental Live Streaming**: Remote peers see strokes rendered smoothly *while* the author is drawing, avoiding delayed "pop-in" of finished strokes.
- **Server-Authoritative Global Undo/Redo**: Undo removes the most recent active stroke in the room regardless of author, ensuring canvas convergence across all participants.
- **Conflict Resolution**: Monotonically increasing room sequence numbers determine authoritative z-index rendering without complex CRDT/OT overhead.
- **Native Canvas Compositing Eraser**: True pixel erasure using `globalCompositeOperation = 'destination-out'` rather than painting opaque white strokes.
- **High-DPI / Retina Calibration**: Full support for `window.devicePixelRatio` with auto-rescaling on window resize without bitmap distortion.
- **Unified Pointer Events**: Complete support for mouse, stylus/pen, and touch screens with pointer capture and coalesced event processing.
- **Live Remote Cursors**: Smoothly animated cursor pointers with user badges, throttled to 35ms to optimize network throughput.
- **Offline & Reconnection Resilience**: Automatic Socket.IO reconnection with exponential backoff and seamless snapshot resynchronization.
- **One-Click Link Sharing**: Instant clipboard copy of the room URL for effortless invite flows.
- **PNG Export**: One-click local raster export of the collaborated artwork.

---

## Tech Stack

| Layer | Technologies / Modules |
|---|---|
| **Frontend UI** | Semantic HTML5, Plain Modern CSS (CSS Grid, Flexbox, CSS Variables) |
| **Canvas Engine** | Native HTML5 Canvas 2D API, Unified Pointer Events, `ResizeObserver`, `requestAnimationFrame` |
| **Client Transport** | Socket.IO Client 4.x (WebSockets with HTTP Long-Polling fallback) |
| **Backend Runtime** | Node.js (v14+), Express 4.x |
| **Real-Time Protocol** | Socket.IO Server 4.x with in-memory room management |
| **Testing** | Node.js Automated E2E Integration Suite (`tests/collaboration.test.js`) |

*Zero frontend frameworks (no React/Vue/Angular), zero canvas libraries (no Fabric.js/Paper.js/Konva).*

---

## Installation & Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v14.0.0 or higher
- [npm](https://www.npmjs.com/) v6.0.0 or higher

### Steps

1. **Clone or Navigate to Repository**:
   ```bash
   cd collaborative-canvas
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Run Automated Integration Tests**:
   ```bash
   npm test
   ```
   *Executes an 8-stage automated test verifying room isolation, real-time chunk streaming, monotonic sequence assignment, global undo/redo, and disconnection handling.*

4. **Start Application Server**:
   ```bash
   npm start
   ```

5. **Open in Browser**:
   Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## Multi-User & Multi-Room Testing

### Test 1: Real-Time Multi-User Collaboration (Same Room)
1. Open [http://localhost:3000/?room=collab-test](http://localhost:3000/?room=collab-test) in **Tab 1**.
2. Open the exact same link in **Tab 2** (or in an Incognito window / another device on your LAN).
3. Notice that each tab receives a unique user alias (e.g. `Swift Falcon 42`) and assigned color.
4. Move your cursor across Tab 1: Tab 2 displays a live cursor label tracking the movement.
5. Draw a stroke in Tab 1: Tab 2 renders the stroke in real time as your pointer moves.

### Test 2: Global Undo and Redo
1. In **Tab 1**, draw a red line.
2. In **Tab 2**, draw a blue line.
3. In **Tab 1**, click **Undo** (or press `Ctrl+Z`):
   - The blue line (most recent stroke in the room) vanishes in **both** Tab 1 and Tab 2.
4. In **Tab 2**, click **Redo** (or press `Ctrl+Y`):
   - The blue line reappears in **both** tabs with intact sequence and geometry.
5. In **Tab 1**, click **Undo** again (blue line disappears).
6. In **Tab 1**, draw a new green circle:
   - The redo stack is cleared for all clients, branching into the new history state.

### Test 3: Multi-Room Isolation
1. Open [http://localhost:3000/?room=room-a](http://localhost:3000/?room=room-a) in Tab A.
2. Open [http://localhost:3000/?room=room-b](http://localhost:3000/?room=room-b) in Tab B.
3. Draw in Tab A:
   - Tab B receives **zero** strokes, **zero** cursor events, and shows only its own room roster.
4. Click **Clear All** in Tab A:
   - Room A clears; Room B remains unaffected.

---

## Real-Time Synchronization Engine

### Vector Stroke Data Model
Rather than transmitting heavy bitmap snapshots over WebSockets, all interactions are modeled as lightweight vector operations:

```json
{
  "id": "stroke-1726173000-x9k2p",
  "userId": "socket-client-id",
  "userName": "Creative Otter 27",
  "sequence": 14,
  "tool": "brush",
  "color": "#3b82f6",
  "width": 4,
  "points": [
    { "x": 0.1245, "y": 0.4321 },
    { "x": 0.1288, "y": 0.4390 }
  ],
  "timestamp": 1726173000123
}
```

### Point Normalization
Points are stored in normalized coordinates:
$$x_{\text{norm}} = \frac{x_{\text{client}} - \text{rect.left}}{\text{rect.width}}, \quad y_{\text{norm}} = \frac{y_{\text{client}} - \text{rect.top}}{\text{rect.height}}$$
When rendering, points are mapped back: $x = x_{\text{norm}} \times \text{width}_{\text{css}}$. This guarantees that users on 4K monitors, laptops, and mobile screens draw onto the exact same logical canvas geometry without clipping.

### In-Progress Stroke Chunking
To balance real-time responsiveness with network efficiency:
- When pointer movement is detected, points are accumulated and dispatched every ~25ms (`stroke:chunk`).
- Other clients draw these incoming point batches incrementally into their canvas.
- Upon pointer release, `stroke:commit` sends the completed stroke. The server assigns an authoritative `sequence` number and broadcasts `stroke:committed`.

---

## Global Undo / Redo Mechanism

Global undo/redo operates strictly via **server-authoritative operation history**:

1. **Room State**:
   - `operations[]`: Monotonically ordered list of active committed strokes.
   - `undoneStack[]`: Stack of undone strokes.
   - `sequenceCounter`: Integer incremented on each commit.
2. **Global Undo**:
   - When any participant clicks Undo, the server pops the top stroke from `operations[]` and pushes it onto `undoneStack[]`.
   - The server broadcasts `action:undone` with `{ operationId, sequence, undoCount, redoCount }`.
   - Every connected client removes that operation from its local memory and deterministically replays the remaining vector strokes.
3. **Global Redo**:
   - When any participant clicks Redo, the server pops the top stroke from `undoneStack[]` and pushes it back into `operations[]`.
   - The server broadcasts `action:redone` with `{ operation, undoCount, redoCount }`.
   - Every client appends and renders the restored stroke.
4. **History Invalidation**:
   - Committing a new stroke while `undoneStack[]` is non-empty empties `undoneStack[]`, preserving deterministic single-timeline ordering.

---

## Performance & Rendering Decisions

1. **Device Pixel Ratio (DPR) Scaling**:
   ```javascript
   const dpr = window.devicePixelRatio || 1;
   canvas.width = Math.round(rect.width * dpr);
   canvas.height = Math.round(rect.height * dpr);
   ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
   ```
   Ensures sharp lines on Retina displays without blurry antialiasing artifacts.

2. **Smooth Quadratic Bezier Splines**:
   Points are connected through midpoints using quadratic curves:
   ```javascript
   const midX = (pPrev.x + pCurr.x) / 2;
   const midY = (pPrev.y + pCurr.y) / 2;
   ctx.quadraticCurveTo(pPrev.x, pPrev.y, midX, midY);
   ```
   Eliminates the sharp jagged corners typical of raw point-to-point line segments.

3. **Incremental Rendering During Drawing**:
   Local pointer moves only draw the latest sub-segment. The canvas is **never redrawn from scratch** during active drawing. Replays occur strictly on resize, undo, or room clear.

4. **Dual-Layer Canvas Architecture**:
   - `#canvas` (Drawing Layer): Holds committed and active ink lines.
   - `#cursors-canvas` (Overlay Layer): Cleared and repainted each animation frame via `requestAnimationFrame` to render smooth remote cursors and nametags without affecting drawing performance.

5. **Network Throttling**:
   - Remote cursor broadcasts are throttled to a 35ms interval (~28Hz).
   - Drawing chunks are dispatched every ~25ms.
   - High-polling mice events are coalesced via `e.getCoalescedEvents()`.

---

## Known Limitations & Trade-offs

1. **In-Memory Volatility**:
   - Room history is kept in server RAM. Server restarts reset canvas state. Empty rooms are retained in memory for 10 minutes before eviction.
   - *Production Solution*: Persist operations to Redis or PostgreSQL / S3.
2. **Single-Node Scaling Limit**:
   - Rooms currently live in the local Node process.
   - *Production Solution*: Integrate `@socket.io/redis-adapter` for horizontal multi-instance clustering (detailed in `ARCHITECTURE.md`).
3. **History Bounding**:
   - Rooms are capped at 2,000 operations to bound memory consumption. Oldest strokes are shifted out if the cap is exceeded.
4. **Offline Drawing Reconciliation**:
   - If a client disconnects, local offline strokes are not queued for reconciliation; the client receives a fresh authoritative snapshot on reconnect.

---

## Browser Compatibility

- **Google Chrome / Chromium**: Version 88+ (Full support for Pointer Events, Coalesced Events, ResizeObserver)
- **Mozilla Firefox**: Version 85+ (Full support)
- **Apple Safari**: Version 14+ (macOS & iOS full touch/Apple Pencil support)
- **Microsoft Edge**: Version 88+ (Full support)
- **Mobile Browsers**: Chrome for Android, Mobile Safari (Touch drawing with `touch-action: none`)

---
## Live Demo

**Demo:** https://real-time-collaborative-drawing-canvas-0kys.onrender.com

## Repository

**GitHub:** https://github.com/ban-niranjan/Real-Time-Collaborative-Drawing-Canvas

---


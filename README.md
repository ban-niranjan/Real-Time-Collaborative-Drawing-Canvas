# Collaborative Drawing Canvas (Flam Assignment- FRONTEND)

A real-time drawing web application that allows multiple users to sketch together on a shared canvas. Built using Vanilla JavaScript, HTML5 Canvas, Node.js, and Socket.IO, this project focuses on smooth real-time collaboration without using any frontend frameworks.

---

##  Live Demo

https://collaborative-canvas-ptv4.onrender.com/

Open the link in multiple tabs or devices to test real-time collaboration.

---

##  Overview

This application enables users to draw on the same canvas at the same time, with every action instantly reflected across all clients. It is ideal for collaborative sketching, idea sharing, and learning real-time WebSocket communication.

---

##  Features

- Brush and eraser tools  
- Adjustable color and stroke size  
- Real-time synchronized drawing across users  
- Displays active users and their cursor positions  
- Global undo/redo for shared canvas actions  
- Supports desktop and touch devices  

---

## Installation & Setup

### Requirements
- Node.js v14 or above

### Steps to Run

git clone https://github.com/GarvMittal04/collaborative-canvas.git
cd collaborative-canvas
npm install
npm start
http://localhost:3000

##  Project Structure

```
collaborative-canvas/
├── client/                
│   ├── index.html          
│   ├── style.css          
│   ├── canvas.js           
│   ├── websocket.js        
│   └── main.js                
│
├── server/                 
│   ├── server.js           
│   ├── rooms.js            
│   └── drawing-state.js   
│
├── package.json            
└── README.md               
```
##  How to Test With Multiple Users

To test real-time collaboration:

Method 1: Same Device
Open http://localhost:3000 in two or more browser tabs
Draw in one tab → It appears in the other instantly

Method 2: Same Network
Find your system's IP address
Share http://YOUR_IP:3000 with others on the same Wi-Fi
Everyone can draw together in real time

## How It Works

User drawing events are captured and sent to the server.
The server broadcasts these updates to all connected users.
Each client updates the canvas to maintain a synchronized shared view.
Undo/Redo is handled on the server to keep a consistent history across all users.

## Known Limitations / Bugs

Canvas does not retain drawing after server restart
Undo removes the latest stroke globally
Performance may drop if too many users draw simultaneously
No authentication or private room protection currently

## Time Spent on the Project

Approximate time invested: 6–7 hours
Initial setup & architecture: 1 hour
Canvas drawing & smoothing logic: 2 hours
Socket implementation & syncing: 2 hours
UI, testing & debugging: 1–2 hours


## Future Enhancements

Add save/load feature for drawings
More tools like shapes, text, layers
Ability to export drawing as PNG
Private rooms with optional authentication




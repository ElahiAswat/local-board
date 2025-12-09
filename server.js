// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static client
app.use(express.static('public'));

// In-memory action history (stroke/image/erase/delete/clear...), replayed to new clients
// Each action is an object with `type` field and other properties.
let actions = [];

// Helper to generate IDs
function makeId(prefix = '') {
  return prefix + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
}

// When new client connects
io.on('connection', (socket) => {
  console.log('Client connected', socket.id);

  // Send full history to new client so it can rebuild the canvas
  socket.emit('init', actions);

  // Broadcast action to others and store it
  socket.on('action', (act) => {
    // Validate type
    if (!act || !act.type) return;
    // Ensure id
    if (!act.id) act.id = makeId('a-');
    // If it's a stroke-erasure request, do server-side stroke deletion resolution
    if (act.type === 'erase-stroke-request') {
      // act: { type: 'erase-stroke-request', id, path:[{x,y}], size }
      // We'll find stroke actions that intersect and push 'delete-stroke' actions to history & broadcast
      const eraserPath = act.path || [];
      const eraserRadius = (act.size || 20) / 2;

      // Helper distance squared
      function dist2(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy; }

      // Build a set of stroke ids that are already deleted (from history)
      const deleted = new Set(actions.filter(a=>a.type==='delete-stroke').map(a=>a.targetId));

      // Find candidate strokes that are not deleted
      const strokeCandidates = actions.filter(a => a.type === 'stroke' && !deleted.has(a.id));

      const toDelete = new Set();

      // For simplicity, check distance between stroke points and eraser points
      for (const s of strokeCandidates) {
        const path = s.path || [];
        if (!path.length) continue;
        let hit = false;
        for (let i=0; i<path.length && !hit; i++){
          const sp = path[i];
          for (let j=0; j<eraserPath.length; j++){
            const ep = eraserPath[j];
            if (dist2(sp, ep) <= (eraserRadius+ (s.size||4))*(eraserRadius + (s.size||4))) {
              hit = true; break;
            }
          }
        }
        if (hit) toDelete.add(s.id);
      }

      // Append delete-stroke actions for each matched stroke and broadcast them
      for (const sid of toDelete) {
        const del = { type: 'delete-stroke', id: makeId('del-'), targetId: sid, timestamp: Date.now() };
        actions.push(del);
        io.emit('action', del);
      }
      // Optionally broadcast the original request for audit (not necessary visually)
      // actions.push(act);
      return;
    }

    // Normal flow: store and broadcast
    actions.push(act);
    io.emit('action', act);
  });

  // Clear history request
  socket.on('clear-history', () => {
    actions = [];
    io.emit('action', { type: 'clear', id: makeId('clear-') });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3200;
server.listen(PORT, () => {
  console.log('Server running on port', PORT);
});

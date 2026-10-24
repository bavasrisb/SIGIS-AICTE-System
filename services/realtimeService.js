const crypto = require('node:crypto');

// In-memory set of connected SSE clients
const clients = new Map();

// Register SSE client connection
function registerClient(req, res) {
  const clientId = crypto.randomUUID();
  const user = req.user;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Initial connection handshake
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, message: 'Connected to SIGIS Live Event Stream' })}\n\n`);

  clients.set(clientId, { res, user });

  // Cleanup on client disconnect
  req.on('close', () => {
    clients.delete(clientId);
  });

  return clientId;
}

// Check if a client is authorized to receive a specific event
function isAuthorizedForEvent(clientUser, eventType, payload, target) {
  if (!clientUser) return false;

  // Central Admin receives all events
  if (clientUser.role === 'ADMIN') return true;

  // Bureau Officer receives events for their assigned bureau
  if (clientUser.role === 'BUREAU_OFFICER') {
    if (eventType === 'STATS_UPDATED') return true;
    if (payload && payload.bureau === clientUser.bureau) return true;
    if (target && target.bureau === clientUser.bureau) return true;
    return false;
  }

  // Student Complainant receives events only for their own complaints
  if (clientUser.role === 'GUEST_STUDENT') {
    if (payload && (payload.complainant_email === clientUser.email || payload.complainant_email === clientUser.username)) {
      return true;
    }
    if (target && (target.email === clientUser.email || target.email === clientUser.username)) {
      return true;
    }
    return false;
  }

  return false;
}

// Broadcast an event to authorized clients
function broadcastEvent(eventType, payload = {}, target = {}) {
  const eventData = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;

  let deliveredCount = 0;
  for (const [clientId, client] of clients.entries()) {
    try {
      if (isAuthorizedForEvent(client.user, eventType, payload, target)) {
        client.res.write(eventData);
        deliveredCount++;
      }
    } catch (err) {
      clients.delete(clientId);
    }
  }

  return deliveredCount;
}

// Periodic heartbeat to keep connections alive
const heartbeatInterval = setInterval(() => {
  for (const [clientId, client] of clients.entries()) {
    try {
      client.res.write(': heartbeat\n\n');
    } catch (err) {
      clients.delete(clientId);
    }
  }
}, 25000);
if (heartbeatInterval.unref) {
  heartbeatInterval.unref();
}

function getConnectedClientsCount() {
  return clients.size;
}

module.exports = {
  registerClient,
  broadcastEvent,
  isAuthorizedForEvent,
  getConnectedClientsCount
};

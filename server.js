require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const YouTube = require('youtube-sr').default;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '8mb' }));
app.use(express.static('public'));

// In-memory party store
const parties = new Map();

// ─── REST API ────────────────────────────────────────────────────────────────

app.post('/api/party/create', (req, res) => {
  const { name, password, theme, logo } = req.body;
  if (!name || !/^[a-zA-Z0-9_-]{2,30}$/.test(name)) {
    return res.status(400).json({ error: 'Nom de party invalide (2-30 caractères alphanumériques)' });
  }
  if (parties.has(name.toLowerCase())) {
    return res.status(409).json({ error: 'Ce nom de party existe déjà' });
  }
  const validThemes = ['dark', 'ibiza', 'neon', 'minimal'];
  parties.set(name.toLowerCase(), {
    id: uuidv4(),
    name: name.toLowerCase(),
    displayName: name,
    password: password || null,
    theme: validThemes.includes(theme) ? theme : 'dark',
    logo: typeof logo === 'string' && logo.length < 6000000 ? logo : null,
    hostSocketId: null,
    queue: [],
    history: [],
    nowPlaying: null,
    createdAt: new Date(),
  });
  res.json({ ok: true, name: name.toLowerCase() });
});

app.get('/api/party/:name', (req, res) => {
  const party = parties.get(req.params.name.toLowerCase());
  if (!party) return res.status(404).json({ error: 'Party introuvable' });
  res.json({
    name: party.name,
    displayName: party.displayName,
    hasPassword: !!party.password,
    hostOnline: !!party.hostSocketId,
    theme: party.theme || 'dark',
    logo: party.logo || null,
    queue: party.queue,
    history: party.history,
    nowPlaying: party.nowPlaying,
  });
});

app.get('/api/parties', (req, res) => {
  const list = [...parties.values()].map(p => ({
    name: p.name,
    displayName: p.displayName,
    hasPassword: !!p.password,
    hostOnline: !!p.hostSocketId,
    guestCount: io.sockets.adapter.rooms.get(p.name)?.size ?? 0,
  }));
  res.json(list);
});

// Expose YouTube API key au frontend (la clé est déjà restreinte au domaine)
app.get('/api/yt-config', (req, res) => {
  res.json({ apiKey: process.env.YOUTUBE_API_KEY || null });
});

// Fallback scraper server-side (si pas de clé API)
app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Paramètre q requis' });
  if (process.env.YOUTUBE_API_KEY) {
    return res.status(400).json({ error: 'USE_CLIENT_API' });
  }
  try {
    const results = await YouTube.search(q, { limit: 10, type: 'video' });
    res.json(results.map(v => ({
      id: v.id,
      title: v.title,
      thumbnail: v.thumbnail?.url || `https://img.youtube.com/vi/${v.id}/mqdefault.jpg`,
      duration: v.durationFormatted || '',
      channel: v.channel?.name || '',
    })));
  } catch (e) {
    console.error('Search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Extract video ID from a YouTube URL (server-side validation only)
app.get('/api/lookup', (req, res) => {
  const url = req.query.url || '';
  const id = extractYouTubeId(url);
  if (!id) return res.status(400).json({ error: 'URL YouTube invalide' });
  res.json({ id, thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg` });
});

function extractYouTubeId(input) {
  input = input.trim();
  // Plain video ID (11 chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  try {
    const u = new URL(input);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
  } catch {}
  return null;
}

// Catch-all → SPA
app.get('*', (req, res) => res.sendFile(__dirname + '/public/index.html'));

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function advanceQueue(partyName) {
  const party = parties.get(partyName?.toLowerCase());
  if (!party) return;

  // Archive current song in history
  if (party.nowPlaying) {
    party.history.unshift({ ...party.nowPlaying, playedAt: new Date() });
    if (party.history.length > 50) party.history.pop(); // cap at 50
  }

  if (party.queue.length > 0) {
    const next = party.queue.shift();
    party.nowPlaying = next;
    io.to(partyName).emit('queue-updated', { queue: party.queue });
    io.to(partyName).emit('now-playing', next);
    io.to(partyName).emit('history-updated', { history: party.history });
    if (party.hostSocketId) io.to(party.hostSocketId).emit('play-song', next);
  } else {
    party.nowPlaying = null;
    io.to(partyName).emit('now-playing', null);
    io.to(partyName).emit('history-updated', { history: party.history });
  }
}

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  socket.on('join-party', ({ partyName, role, password, guestName }, cb) => {
    const party = parties.get(partyName?.toLowerCase());
    if (!party) return cb({ error: 'Party introuvable' });
    if (party.password && party.password !== password) return cb({ error: 'Mot de passe incorrect' });

    if (role === 'host') {
      if (party.hostSocketId && io.sockets.sockets.get(party.hostSocketId)) {
        return cb({ error: 'Un host est déjà connecté à cette party' });
      }
      party.hostSocketId = socket.id;
    }

    socket.join(partyName.toLowerCase());
    socket.data.partyName = partyName.toLowerCase();
    socket.data.role = role;
    socket.data.guestName = role === 'host' ? 'HOST' : (guestName?.trim().slice(0, 30) || 'Anonyme');

    cb({
      ok: true,
      queue: party.queue,
      history: party.history,
      nowPlaying: party.nowPlaying,
    });

    io.to(partyName.toLowerCase()).emit('presence', {
      hostOnline: !!party.hostSocketId,
      guestCount: (io.sockets.adapter.rooms.get(partyName.toLowerCase())?.size ?? 1) - 1,
    });
  });

  socket.on('add-to-queue', ({ partyName, song }, cb) => {
    const party = parties.get(partyName?.toLowerCase());
    if (!party) return cb?.({ error: 'Party introuvable' });

    const entry = { ...song, queueId: uuidv4(), addedBy: socket.data.guestName || 'Anonyme', addedAt: new Date() };
    party.queue.push(entry);

    io.to(partyName.toLowerCase()).emit('queue-updated', { queue: party.queue });

    // If nothing is playing, tell host to start
    if (!party.nowPlaying && party.hostSocketId) {
      const next = party.queue.shift();
      party.nowPlaying = next;
      io.to(partyName.toLowerCase()).emit('queue-updated', { queue: party.queue });
      io.to(party.hostSocketId).emit('play-song', next);
    }

    cb?.({ ok: true });
  });

  socket.on('song-ended', ({ partyName }) => {
    advanceQueue(partyName);
  });

  socket.on('remove-from-queue', ({ partyName, queueId }, cb) => {
    const party = parties.get(partyName?.toLowerCase());
    if (!party) return cb?.({ error: 'Party introuvable' });
    if (socket.data.role !== 'host') return cb?.({ error: 'Réservé au host' });
    party.queue = party.queue.filter(s => s.queueId !== queueId);
    io.to(partyName.toLowerCase()).emit('queue-updated', { queue: party.queue });
    cb?.({ ok: true });
  });

  socket.on('skip-song', ({ partyName }) => {
    const party = parties.get(partyName?.toLowerCase());
    if (!party || socket.data.role !== 'host') return;
    advanceQueue(partyName);
  });

  socket.on('disconnecting', () => {
    const partyName = socket.data.partyName;
    const party = parties.get(partyName);
    if (!party) return;

    if (party.hostSocketId === socket.id) {
      party.hostSocketId = null;
      io.to(partyName).emit('host-disconnected');
      io.to(partyName).emit('presence', { hostOnline: false });
    } else {
      setTimeout(() => {
        io.to(partyName).emit('presence', {
          hostOnline: !!party.hostSocketId,
          guestCount: (io.sockets.adapter.rooms.get(partyName)?.size ?? 1) - 1,
        });
      }, 200);
    }
  });
});

// Cleanup stale parties older than 24h with no host
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [name, party] of parties) {
    if (!party.hostSocketId && party.createdAt < cutoff) {
      parties.delete(name);
    }
  }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Jukebox running on http://localhost:${PORT}`);
  console.log(`YouTube search: ${process.env.YOUTUBE_API_KEY ? '✓ API officielle' : '⚠ scraper (pas de clé API)'}`);
});

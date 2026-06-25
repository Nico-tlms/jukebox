// ── Globals ──────────────────────────────────────────────────────────────────
const socket = io();
let currentParty = null;  // { name, role }
let ytPlayer = null;
let ytReady = false;

// ── Utils ─────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const app = () => $('app');

function toast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function html(strings, ...vals) {
  return strings.reduce((a, s, i) => a + s + (vals[i] !== undefined ? String(vals[i]) : ''), '');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Router ────────────────────────────────────────────────────────────────────
function route() {
  const path = window.location.pathname.replace(/^\//, '');
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role');

  if (!path) {
    renderHome();
  } else {
    const partyName = path.toLowerCase();
    if (role === 'host' || role === 'guest') {
      renderJoinForm(partyName, role);
    } else {
      renderJoinForm(partyName, null);
    }
  }
}

window.addEventListener('popstate', route);

function navigate(path, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  route();
}

// ── Home Page ─────────────────────────────────────────────────────────────────
function renderHome() {
  app().innerHTML = `
    <div class="page center">
      <div class="home-wrap">
        <div class="home-header">
          <div style="display:flex;align-items:center;gap:.75rem;justify-content:center;margin-bottom:.5rem">
            <span class="logo-icon">🎵</span>
            <span class="logo">Jukebox</span>
          </div>
          <p>Créez ou rejoignez une party musicale YouTube</p>
        </div>

        <div class="mode-cards">
          <div class="mode-card" id="card-host" onclick="selectMode('host')">
            <div class="icon">🎧</div>
            <h2>Mode HOST</h2>
            <p>Créez votre party, gérez la file d'attente et diffusez la musique</p>
          </div>
          <div class="mode-card" id="card-guest" onclick="selectMode('guest')">
            <div class="icon">🙋</div>
            <h2>Mode INVITÉ</h2>
            <p>Rejoignez une party et ajoutez des musiques à la file d'attente</p>
          </div>
        </div>

        <div class="panel" id="mode-panel"></div>
      </div>
    </div>
  `;
}

let selectedMode = null;

function selectMode(mode) {
  selectedMode = mode;
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
  $(`card-${mode}`).classList.add('active');

  if (mode === 'host') renderHostPanel();
  else renderGuestPanel();
}

function renderHostPanel() {
  $('mode-panel').innerHTML = `
    <div class="card">
      <div class="card-title">🎧 Créer une party</div>
      <div id="host-error"></div>
      <div class="form-group">
        <label>Nom de la party</label>
        <input type="text" id="host-name" placeholder="ex: SoiréeJuju" maxlength="30" autocomplete="off">
        <p style="font-size:.78rem;color:var(--muted);margin-top:.35rem">URL : <span id="url-preview" style="color:var(--text)">votre-domaine.fr/<em>NOMDELAPARTY</em></span></p>
      </div>
      <div class="form-group">
        <label>Mot de passe (optionnel)</label>
        <input type="password" id="host-pass" placeholder="Laisser vide = party publique" maxlength="50">
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="createParty()">Créer la party →</button>
    </div>
  `;
  $('host-name').addEventListener('input', e => {
    $('url-preview').textContent = `votre-domaine.fr/${e.target.value || '<em>NOMDELAPARTY</em>'}`;
  });
  $('host-name').addEventListener('keydown', e => { if (e.key === 'Enter') createParty(); });
}

async function createParty() {
  const name = $('host-name').value.trim();
  const password = $('host-pass').value;
  $('host-error').innerHTML = '';

  if (!name) return showError('host-error', 'Entrez un nom de party');

  try {
    const res = await fetch('/api/party/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    });
    const data = await res.json();
    if (!res.ok) return showError('host-error', data.error);
    navigate(`/${data.name}?role=host`);
  } catch {
    showError('host-error', 'Erreur réseau');
  }
}

async function renderGuestPanel() {
  let parties = [];
  try {
    const res = await fetch('/api/parties');
    parties = await res.json();
  } catch {}

  $('mode-panel').innerHTML = `
    <div class="card">
      <div class="card-title">🙋 Rejoindre une party</div>
      <div id="guest-error"></div>
      <div class="form-group">
        <label>Nom de la party</label>
        <input type="text" id="guest-name" placeholder="Nom de la party" maxlength="30" autocomplete="off">
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="joinPartyFromHome()">Rejoindre →</button>
      ${parties.length > 0 ? renderPartyList(parties) : ''}
    </div>
  `;
  $('guest-name').addEventListener('keydown', e => { if (e.key === 'Enter') joinPartyFromHome(); });
}

function renderPartyList(parties) {
  return `
    <div style="margin-top:1.5rem">
      <div style="font-size:.8rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:.75rem">Parties actives</div>
      <div class="party-list">
        ${parties.map(p => `
          <div class="party-item" onclick="document.getElementById('guest-name').value='${escHtml(p.name)}';joinPartyFromHome()">
            <div class="pi-name">${escHtml(p.displayName)}</div>
            <div class="pi-meta">${p.guestCount} invité(s)</div>
            <span class="pi-badge">${p.hasPassword ? '🔒' : '🔓'}</span>
            <span class="dot ${p.hostOnline ? 'online' : ''}" title="${p.hostOnline ? 'Host connecté' : 'Host hors ligne'}"></span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function joinPartyFromHome() {
  const name = $('guest-name').value.trim().toLowerCase();
  if (!name) return showError('guest-error', 'Entrez un nom de party');
  navigate(`/${name}?role=guest`);
}

function showError(containerId, msg) {
  $(containerId).innerHTML = `<div class="error-msg">${escHtml(msg)}</div>`;
}

// ── Join Form (password gate) ─────────────────────────────────────────────────
async function renderJoinForm(partyName, role) {
  app().innerHTML = `<div class="page center"><div class="card card-sm"><div class="spinner"></div></div></div>`;

  let party;
  try {
    const res = await fetch(`/api/party/${partyName}`);
    if (!res.ok) {
      app().innerHTML = `<div class="page center"><div class="card card-sm">
        <div class="card-title">Party introuvable</div>
        <p style="color:var(--muted);margin-bottom:1rem">La party "<strong>${escHtml(partyName)}</strong>" n'existe pas.</p>
        <button class="btn btn-ghost" onclick="navigate('/')">← Retour</button>
      </div></div>`;
      return;
    }
    party = await res.json();
  } catch {
    app().innerHTML = `<div class="page center"><div class="card card-sm"><p style="color:var(--accent)">Erreur réseau</p></div></div>`;
    return;
  }

  const effectiveRole = role || 'guest';

  if (!party.hasPassword || effectiveRole === 'host') {
    // No password needed (host already set one at creation, but must verify on join)
    if (!party.hasPassword) {
      renderPartyPage(party, effectiveRole, '');
      return;
    }
  }

  // Show password form
  app().innerHTML = `
    <div class="page center">
      <div class="card card-sm">
        <div class="card-title">🔒 ${escHtml(party.displayName)}</div>
        <div id="join-error"></div>
        <div class="form-group">
          <label>Mot de passe de la party</label>
          <input type="password" id="join-pass" placeholder="Mot de passe" autofocus>
        </div>
        <div style="display:flex;gap:.75rem">
          <button class="btn btn-ghost" onclick="navigate('/')">Annuler</button>
          <button class="btn btn-primary" style="flex:1" onclick="submitPassword('${escHtml(party.name)}','${escHtml(effectiveRole)}')">Entrer →</button>
        </div>
      </div>
    </div>
  `;
  $('join-pass').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitPassword(party.name, effectiveRole);
  });
}

function submitPassword(partyName, role) {
  const password = $('join-pass').value;
  // We'll verify via socket join
  fetchPartyAndRender(partyName, role, password);
}

async function fetchPartyAndRender(partyName, role, password) {
  const res = await fetch(`/api/party/${partyName}`);
  const party = await res.json();
  renderPartyPage(party, role, password);
}

// ── Party Page ────────────────────────────────────────────────────────────────
function renderPartyPage(party, role, password) {
  currentParty = { name: party.name, role };

  const isHost = role === 'host';

  app().innerHTML = `
    <div class="party-page">
      <div class="offline-banner" id="offline-banner">⚠️ Host hors ligne — la musique est en pause</div>
      <div class="topbar">
        <span class="topbar-logo">🎵</span>
        <span class="topbar-party">${escHtml(party.displayName)}</span>
        <span class="topbar-badge ${isHost ? 'badge-host' : 'badge-guest'}">${isHost ? 'HOST' : 'INVITÉ'}</span>
        <div class="topbar-spacer"></div>
        <div class="presence">
          <span class="dot" id="host-dot"></span>
          <span id="presence-text">—</span>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="leaveParty()" style="font-size:.82rem;padding:.4rem .8rem">Quitter</button>
      </div>

      <div class="party-body">
        <!-- Queue column -->
        <div class="queue-panel">
          <div class="queue-header">
            <div>
              <div class="queue-title">File d'attente</div>
              <div class="queue-count" id="queue-count">0 musique(s)</div>
            </div>
            <button class="btn-add-big" onclick="openSearch()" title="Ajouter une musique">＋</button>
          </div>
          <div class="queue-list" id="queue-list">
            ${renderQueueEmpty()}
          </div>
        </div>

        <!-- Player column -->
        <div class="player-panel">
          <div class="now-playing-card">
            <div class="np-label">En cours</div>
            <div id="now-playing-content">
              <div class="np-empty">Aucune musique en cours</div>
            </div>
          </div>

          ${isHost ? `
          <div class="yt-container" id="yt-wrap">
            <div id="yt-player"></div>
          </div>
          <div class="player-controls">
            <button class="btn btn-ghost" style="flex:1" onclick="skipSong()" id="btn-skip">⏭ Suivant</button>
          </div>
          ` : `
          <div class="card" style="text-align:center;padding:1.25rem">
            <div style="font-size:2rem;margin-bottom:.5rem">🔊</div>
            <p style="font-size:.85rem;color:var(--muted)">La musique se diffuse uniquement<br>sur les haut-parleurs du HOST</p>
          </div>
          `}
        </div>
      </div>
    </div>

    <!-- Search Modal -->
    <div class="modal-overlay" id="search-modal" style="display:none" onclick="closeSearchIfOverlay(event)">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">🎵 Ajouter une musique</span>
          <button class="btn-icon" onclick="closeSearch()">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:.82rem;color:var(--muted);margin-bottom:.85rem">Colle un lien YouTube ou un ID de vidéo</p>
          <div class="search-bar">
            <input type="text" id="search-input" placeholder="https://youtube.com/watch?v=... ou youtu.be/..." autocomplete="off">
            <button class="btn btn-primary" onclick="doSearch()">Ajouter</button>
          </div>
          <div id="search-results"></div>
        </div>
      </div>
    </div>
  `;

  // Connect socket
  socket.emit('join-party', { partyName: party.name, role, password }, (res) => {
    if (res.error) {
      toast(res.error, 'error');
      navigate('/');
      return;
    }
    updateQueue(res.queue || []);
    updateNowPlaying(res.nowPlaying);
  });

  // Setup search input
  document.getElementById('search-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });

  // Load YouTube API for host
  if (isHost && !window.YT) {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = initYTPlayer;
  } else if (isHost && window.YT && window.YT.Player) {
    initYTPlayer();
  }
}

function leaveParty() {
  socket.emit('leave-party');
  navigate('/');
}

// ── YouTube Player ────────────────────────────────────────────────────────────
function initYTPlayer() {
  ytPlayer = new YT.Player('yt-player', {
    height: '100%',
    width: '100%',
    playerVars: { autoplay: 1, controls: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: () => { ytReady = true; },
      onStateChange: e => {
        // YT.PlayerState.ENDED = 0
        if (e.data === 0) {
          socket.emit('song-ended', { partyName: currentParty.name });
        }
      },
    },
  });
}

socket.on('play-song', (song) => {
  if (!currentParty || currentParty.role !== 'host') return;
  updateNowPlaying(song);
  if (ytPlayer && ytReady) {
    ytPlayer.loadVideoById(song.id);
  }
});

socket.on('now-playing', (song) => {
  updateNowPlaying(song);
});

socket.on('queue-updated', ({ queue }) => {
  updateQueue(queue);
});

socket.on('presence', ({ hostOnline, guestCount }) => {
  const dot = $('host-dot');
  const text = $('presence-text');
  const banner = $('offline-banner');
  if (!dot) return;
  dot.className = `dot ${hostOnline ? 'online' : ''}`;
  text.textContent = hostOnline
    ? `Host en ligne · ${guestCount ?? 0} invité(s)`
    : `Host hors ligne · ${guestCount ?? 0} invité(s)`;
  banner?.classList.toggle('show', !hostOnline && currentParty?.role === 'guest');
});

socket.on('host-disconnected', () => {
  $('offline-banner')?.classList.add('show');
});

// ── Queue rendering ───────────────────────────────────────────────────────────
function renderQueueEmpty() {
  return `<div class="queue-empty">
    <div class="empty-icon">🎶</div>
    <p>La file d'attente est vide.<br>Cliquez sur <strong>＋</strong> pour ajouter une musique.</p>
  </div>`;
}

function updateQueue(queue) {
  const list = $('queue-list');
  const count = $('queue-count');
  if (!list) return;

  count.textContent = `${queue.length} musique(s)`;

  if (queue.length === 0) {
    list.innerHTML = renderQueueEmpty();
    return;
  }

  const isHost = currentParty?.role === 'host';

  list.innerHTML = queue.map((song, i) => `
    <div class="queue-item">
      <span class="qi-num">${i + 1}</span>
      <img class="qi-thumb" src="${escHtml(song.thumbnail)}" alt="" loading="lazy">
      <div class="qi-info">
        <div class="qi-title">${escHtml(song.title)}</div>
        <div class="qi-meta">${escHtml(song.channel || '')}</div>
      </div>
      <span class="qi-dur">${escHtml(song.duration || '')}</span>
      ${isHost ? `<button class="btn-icon" title="Retirer" onclick="removeFromQueue('${escHtml(song.queueId)}')">✕</button>` : ''}
    </div>
  `).join('');
}

function updateNowPlaying(song) {
  const el = $('now-playing-content');
  if (!el) return;
  if (!song) {
    el.innerHTML = '<div class="np-empty">Aucune musique en cours</div>';
    return;
  }
  el.innerHTML = `
    <div class="np-content">
      <img class="np-thumb" src="${escHtml(song.thumbnail)}" alt="">
      <div class="np-info">
        <div class="np-title">${escHtml(song.title)}</div>
        <div class="np-channel">${escHtml(song.channel || '')}</div>
      </div>
    </div>
  `;
}

function removeFromQueue(queueId) {
  socket.emit('remove-from-queue', { partyName: currentParty.name, queueId }, (res) => {
    if (res?.error) toast(res.error, 'error');
  });
}

function skipSong() {
  socket.emit('skip-song', { partyName: currentParty.name });
}

// ── Search Modal ──────────────────────────────────────────────────────────────
function openSearch() {
  $('search-modal').style.display = 'flex';
  setTimeout(() => $('search-input')?.focus(), 50);
}

function closeSearch() {
  $('search-modal').style.display = 'none';
  $('search-results').innerHTML = '';
  $('search-input').value = '';
}

function closeSearchIfOverlay(e) {
  if (e.target === $('search-modal')) closeSearch();
}

function extractYouTubeId(input) {
  input = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  try {
    const u = new URL(input);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v') || u.pathname.split('/').pop();
  } catch {}
  return null;
}

async function doSearch() {
  const input = $('search-input').value.trim();
  if (!input) return;

  const videoId = extractYouTubeId(input);
  if (!videoId) {
    $('search-results').innerHTML = `<div class="search-empty" style="color:var(--accent)">URL invalide. Ex: https://youtube.com/watch?v=dQw4w9WgXcQ</div>`;
    return;
  }

  $('search-results').innerHTML = `<div class="search-loading"><div class="spinner"></div>Récupération des infos…</div>`;

  try {
    // Use YouTube oEmbed from the browser (works client-side)
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl);
    let title = `Vidéo YouTube (${videoId})`;
    let channel = '';
    if (res.ok) {
      const data = await res.json();
      title = data.title || title;
      channel = data.author_name || '';
    }

    const song = {
      id: videoId,
      title,
      channel,
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      duration: '',
    };

    $('search-results').innerHTML = `
      <div class="search-result" id="preview-result">
        <img class="sr-thumb" src="${escHtml(song.thumbnail)}" alt="">
        <div class="sr-info">
          <div class="sr-title">${escHtml(song.title)}</div>
          <div class="sr-meta">${escHtml(song.channel)}</div>
        </div>
        <button class="btn btn-primary sr-add">＋ Ajouter</button>
      </div>
    `;
    $('preview-result').querySelector('.sr-add').onclick = () => addSongDirect(song);
    $('preview-result').onclick = () => addSongDirect(song);

  } catch (err) {
    // oEmbed failed (CORS or network) — add with just the video ID
    const song = {
      id: videoId,
      title: `Vidéo YouTube`,
      channel: '',
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      duration: '',
    };
    $('search-results').innerHTML = `
      <div class="search-result" id="preview-result">
        <img class="sr-thumb" src="${escHtml(song.thumbnail)}" alt="">
        <div class="sr-info">
          <div class="sr-title">${escHtml(song.title)} <span style="color:var(--muted)">(${videoId})</span></div>
          <div class="sr-meta">Cliquer pour ajouter</div>
        </div>
        <button class="btn btn-primary sr-add">＋ Ajouter</button>
      </div>
    `;
    $('preview-result').querySelector('.sr-add').onclick = () => addSongDirect(song);
    $('preview-result').onclick = () => addSongDirect(song);
  }
}

function addSongDirect(song) {
  socket.emit('add-to-queue', { partyName: currentParty.name, song }, (res) => {
    if (res?.error) { toast(res.error, 'error'); return; }
    toast(`"${song.title}" ajouté à la file !`, 'success');
    closeSearch();
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
route();

// ── Globals ──────────────────────────────────────────────────────────────────
const socket = io();
let currentParty = null;  // { name, role, guestName }
let ytPlayer = null;
let ytReady = false;
let searchTab = 'search'; // 'search' | 'url'
let selectedTheme = 'dark';
let logoDataUrl = null;

// Invidious public instances to try for client-side search
const INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://inv.tux.pizza',
  'https://invidious.privacydev.net',
  'https://invidious.perennialte.ch',
  'https://iv.ggtyler.dev',
  'https://yt.jagrg.org',
  'https://invidious.io.lol',
];

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
    renderJoinForm(path.toLowerCase(), role);
  }
}

window.addEventListener('popstate', route);

function navigate(path) {
  history.pushState(null, '', path);
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

function selectMode(mode) {
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
  $(`card-${mode}`).classList.add('active');
  if (mode === 'host') renderHostPanel();
  else renderGuestPanel();
}

const THEMES = [
  { id: 'dark',    label: '🌑 Dark',    cls: 'th-dark'    },
  { id: 'ibiza',   label: '🌴 Ibiza',   cls: 'th-ibiza'   },
  { id: 'neon',    label: '💜 Neon',    cls: 'th-neon'    },
  { id: 'minimal', label: '☀️ Minimal', cls: 'th-minimal' },
];

function renderHostPanel() {
  selectedTheme = 'dark';
  logoDataUrl = null;

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
      <div class="form-group">
        <label>Thème</label>
        <div class="theme-picker">
          ${THEMES.map(t => `
            <div class="theme-opt ${t.id === 'dark' ? 'selected' : ''}" onclick="selectTheme('${t.id}')" id="theme-opt-${t.id}">
              <div class="th-preview ${t.cls}"></div>
              <div class="th-name">${t.label}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>Logo de la party (optionnel)</label>
        <div class="logo-upload-area" id="logo-drop" onclick="$('logo-file').click()">
          <div id="logo-placeholder">📷 Cliquer pour choisir une image</div>
          <div id="logo-preview-wrap" style="display:none" class="logo-preview">
            <img id="logo-img-preview" src="" alt="logo">
            <div>
              <div style="font-size:.85rem;font-weight:600" id="logo-filename"></div>
              <button class="btn btn-ghost" style="font-size:.75rem;padding:.25rem .6rem;margin-top:.25rem" onclick="event.stopPropagation();removeLogo()">✕ Supprimer</button>
            </div>
          </div>
        </div>
        <input type="file" id="logo-file" accept="image/*" style="display:none">
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:.5rem" onclick="createParty()">Créer la party →</button>
    </div>
  `;

  $('host-name').addEventListener('input', e => {
    $('url-preview').textContent = `votre-domaine.fr/${e.target.value || '<em>NOMDELAPARTY</em>'}`;
  });
  $('host-name').addEventListener('keydown', e => { if (e.key === 'Enter') createParty(); });

  $('logo-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { toast('Image trop grande (max 500 Ko)', 'error'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      logoDataUrl = ev.target.result;
      $('logo-img-preview').src = logoDataUrl;
      $('logo-filename').textContent = file.name;
      $('logo-placeholder').style.display = 'none';
      $('logo-preview-wrap').style.display = 'flex';
    };
    reader.readAsDataURL(file);
  });
}

function selectTheme(id) {
  selectedTheme = id;
  document.querySelectorAll('.theme-opt').forEach(el => el.classList.remove('selected'));
  $(`theme-opt-${id}`).classList.add('selected');
}

function removeLogo() {
  logoDataUrl = null;
  $('logo-file').value = '';
  $('logo-placeholder').style.display = '';
  $('logo-preview-wrap').style.display = 'none';
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
      body: JSON.stringify({ name, password, theme: selectedTheme, logo: logoDataUrl }),
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

// ── Join Form ─────────────────────────────────────────────────────────────────
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
  const needsPassword = party.hasPassword;
  const needsName = effectiveRole === 'guest';

  // Preview theme on join screen
  applyTheme(party.theme || 'dark');

  if (!needsPassword && !needsName) {
    renderPartyPage(party, effectiveRole, '', '');
    return;
  }

  app().innerHTML = `
    <div class="page center">
      <div class="card card-sm">
        <div class="card-title">${needsPassword ? '🔒' : '🎵'} ${escHtml(party.displayName)}</div>
        <div id="join-error"></div>
        ${needsName ? `
        <div class="form-group">
          <label>Votre prénom / pseudo</label>
          <input type="text" id="join-display-name" placeholder="ex: Juju, Marie…" maxlength="30" autofocus>
        </div>` : ''}
        ${needsPassword ? `
        <div class="form-group">
          <label>Mot de passe de la party</label>
          <input type="password" id="join-pass" placeholder="Mot de passe" ${needsName ? '' : 'autofocus'}>
        </div>` : ''}
        <div style="display:flex;gap:.75rem">
          <button class="btn btn-ghost" onclick="navigate('/')">Annuler</button>
          <button class="btn btn-primary" style="flex:1" onclick="submitJoin('${escHtml(party.name)}','${escHtml(effectiveRole)}')">Entrer →</button>
        </div>
      </div>
    </div>
  `;
  const firstInput = $('join-display-name') || $('join-pass');
  firstInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitJoin(party.name, effectiveRole);
  });
  $('join-pass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitJoin(party.name, effectiveRole);
  });
}

async function submitJoin(partyName, role) {
  const password = $('join-pass')?.value || '';
  const guestName = $('join-display-name')?.value.trim() || '';
  if (role === 'guest' && !guestName) {
    showError('join-error', 'Entrez votre prénom ou pseudo');
    return;
  }
  const res = await fetch(`/api/party/${partyName}`);
  const party = await res.json();
  renderPartyPage(party, role, password, guestName);
}

// ── Theme application ─────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.className = document.body.className
    .replace(/\btheme-\S+/g, '').trim();
  if (theme && theme !== 'dark') document.body.classList.add(`theme-${theme}`);

  // Remove old Ibiza decorations
  document.querySelectorAll('.ibiza-sea,.ibiza-palms,.ibiza-reflection,.ibiza-stars').forEach(el => el.remove());

  if (theme === 'ibiza') {
    // Stars
    const stars = document.createElement('div');
    stars.className = 'ibiza-stars';
    for (let i = 0; i < 60; i++) {
      const s = document.createElement('span');
      const size = Math.random() * 2 + 1;
      s.style.cssText = `width:${size}px;height:${size}px;top:${Math.random()*65}%;left:${Math.random()*100}%;--d:${2+Math.random()*4}s;animation-delay:${Math.random()*4}s`;
      stars.appendChild(s);
    }
    document.body.appendChild(stars);

    // Sea
    const sea = document.createElement('div');
    sea.className = 'ibiza-sea';
    document.body.appendChild(sea);

    // Palm trees (SVG)
    const palms = document.createElement('div');
    palms.className = 'ibiza-palms';
    palms.innerHTML = palmSVG(1) + palmSVG(-1);
    document.body.appendChild(palms);

    // Sun reflection
    const ref = document.createElement('div');
    ref.className = 'ibiza-reflection';
    document.body.appendChild(ref);
  }
}

function palmSVG(flip) {
  const f = flip < 0 ? 'transform="scale(-1,1) translate(-200,0)"' : '';
  return `<svg width="200" height="220" viewBox="0 0 200 220" fill="none" xmlns="http://www.w3.org/2000/svg" ${f}>
    <!-- trunk -->
    <path d="M95 220 Q88 180 82 150 Q78 120 80 90 Q82 60 90 30" stroke="#4a3520" stroke-width="10" stroke-linecap="round" fill="none"/>
    <!-- leaves -->
    <path d="M90 30 Q60 10 20 20 Q50 35 75 55" fill="#2d6a2d"/>
    <path d="M90 30 Q110 5 150 15 Q120 32 95 52" fill="#3a8c3a"/>
    <path d="M90 30 Q75 0 90 -20 Q95 10 100 40" fill="#2d6a2d"/>
    <path d="M90 30 Q55 25 30 45 Q60 45 85 58" fill="#3a8c3a"/>
    <path d="M90 30 Q120 20 145 40 Q115 42 92 56" fill="#2d6a2d"/>
    <!-- coconuts -->
    <circle cx="88" cy="42" r="5" fill="#8B6914"/>
    <circle cx="96" cy="38" r="4" fill="#7a5c10"/>
  </svg>`;
}

// ── Party Page ────────────────────────────────────────────────────────────────
function renderPartyPage(party, role, password, guestName) {
  currentParty = { name: party.name, role, guestName };

  const isHost = role === 'host';
  const partyUrl = `${window.location.origin}/${party.name}`;

  applyTheme(party.theme || 'dark');

  app().innerHTML = `
    <div class="party-page">
      <div class="offline-banner" id="offline-banner">⚠️ Host hors ligne — la musique est en pause</div>
      <div class="topbar">
        ${party.logo
          ? `<img class="topbar-party-logo" src="${escHtml(party.logo)}" alt="logo">`
          : `<span class="topbar-logo">🎵</span>`}
        <span class="topbar-party">${escHtml(party.displayName)}</span>
        <span class="topbar-badge ${isHost ? 'badge-host' : 'badge-guest'}">${isHost ? 'HOST' : escHtml(guestName || 'INVITÉ')}</span>
        <div class="topbar-spacer"></div>
        <div class="presence">
          <span class="dot" id="host-dot"></span>
          <span id="presence-text">—</span>
        </div>
        <button class="btn btn-ghost" onclick="leaveParty()" style="font-size:.82rem;padding:.4rem .8rem">Quitter</button>
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
            <button class="btn btn-ghost" style="flex:1" onclick="skipSong()">⏭ Suivant</button>
          </div>

          <!-- QR Code card -->
          <div class="card qr-card">
            <div style="font-size:.8rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:.5rem">📱 Inviter des amis</div>
            <div class="qr-wrap" id="qr-wrap"></div>
            <div class="qr-url">${escHtml(partyUrl)}</div>
            <button class="btn btn-ghost" style="margin-top:.75rem;font-size:.8rem;padding:.4rem .8rem" onclick="copyPartyUrl('${escHtml(partyUrl)}')">📋 Copier le lien</button>
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
          <div class="search-tabs">
            <button class="search-tab active" id="tab-search" onclick="switchTab('search')">🔍 Rechercher</button>
            <button class="search-tab" id="tab-url" onclick="switchTab('url')">🔗 Coller un lien</button>
          </div>
          <div id="tab-search-content">
            <div class="search-bar">
              <input type="search" id="search-input" placeholder="Rechercher une musique…" autocomplete="off">
              <button class="btn btn-primary" onclick="doSearch()">Chercher</button>
            </div>
          </div>
          <div id="tab-url-content" style="display:none">
            <div class="search-bar">
              <input type="text" id="url-input" placeholder="https://youtube.com/watch?v=… ou youtu.be/…" autocomplete="off">
              <button class="btn btn-primary" onclick="doUrlLookup()">Ajouter</button>
            </div>
          </div>
          <div id="search-results"></div>
        </div>
      </div>
    </div>
  `;

  // Socket join
  socket.emit('join-party', { partyName: party.name, role, password, guestName }, (res) => {
    if (res.error) {
      toast(res.error, 'error');
      navigate('/');
      return;
    }
    updateQueue(res.queue || []);
    updateNowPlaying(res.nowPlaying);
  });

  $('search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  $('url-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') doUrlLookup(); });

  // QR code
  if (isHost) {
    generateQR(partyUrl);
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = initYTPlayer;
    } else if (window.YT?.Player) {
      initYTPlayer();
    }
  }
}

function leaveParty() {
  applyTheme('dark');
  navigate('/');
}

function copyPartyUrl(url) {
  navigator.clipboard?.writeText(url).then(() => toast('Lien copié !', 'success'));
}

// ── QR Code ───────────────────────────────────────────────────────────────────
async function generateQR(url) {
  const wrap = $('qr-wrap');
  if (!wrap) return;

  // Load qrcode.js from CDN
  if (!window.QRCode) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    }).catch(() => null);
  }

  if (window.QRCode) {
    wrap.innerHTML = '';
    new QRCode(wrap, {
      text: url,
      width: 160,
      height: 160,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
  } else {
    // Fallback: use a QR API
    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}`;
    img.width = 160; img.height = 160;
    wrap.appendChild(img);
  }
}

// ── YouTube Player ────────────────────────────────────────────────────────────
function initYTPlayer() {
  ytPlayer = new YT.Player('yt-player', {
    height: '100%', width: '100%',
    playerVars: { autoplay: 1, controls: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: () => { ytReady = true; },
      onStateChange: e => {
        if (e.data === 0) socket.emit('song-ended', { partyName: currentParty.name });
      },
    },
  });
}

socket.on('play-song', (song) => {
  if (!currentParty || currentParty.role !== 'host') return;
  updateNowPlaying(song);
  if (ytPlayer && ytReady) ytPlayer.loadVideoById(song.id);
});

socket.on('now-playing', (song) => updateNowPlaying(song));
socket.on('queue-updated', ({ queue }) => updateQueue(queue));

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

socket.on('host-disconnected', () => $('offline-banner')?.classList.add('show'));

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
  if (queue.length === 0) { list.innerHTML = renderQueueEmpty(); return; }

  const isHost = currentParty?.role === 'host';
  list.innerHTML = queue.map((song, i) => `
    <div class="queue-item">
      <span class="qi-num">${i + 1}</span>
      <img class="qi-thumb" src="${escHtml(song.thumbnail)}" alt="" loading="lazy">
      <div class="qi-info">
        <div class="qi-title">${escHtml(song.title)}</div>
        <div class="qi-meta">${escHtml(song.channel || '')}</div>
      </div>
      <span class="qi-addedby">👤 ${escHtml(song.addedBy || 'Anonyme')}</span>
      <span class="qi-dur">${escHtml(song.duration || '')}</span>
      ${isHost ? `<button class="btn-icon" title="Retirer" onclick="removeFromQueue('${escHtml(song.queueId)}')">✕</button>` : ''}
    </div>
  `).join('');
}

function updateNowPlaying(song) {
  const el = $('now-playing-content');
  if (!el) return;
  if (!song) { el.innerHTML = '<div class="np-empty">Aucune musique en cours</div>'; return; }
  el.innerHTML = `
    <div class="np-content">
      <img class="np-thumb" src="${escHtml(song.thumbnail)}" alt="">
      <div class="np-info">
        <div class="np-title">${escHtml(song.title)}</div>
        <div class="np-channel">${escHtml(song.channel || '')}${song.addedBy ? ` · 👤 ${escHtml(song.addedBy)}` : ''}</div>
      </div>
    </div>
  `;
}

function removeFromQueue(queueId) {
  socket.emit('remove-from-queue', { partyName: currentParty.name, queueId }, res => {
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
  if ($('search-input')) $('search-input').value = '';
  if ($('url-input')) $('url-input').value = '';
}

function closeSearchIfOverlay(e) {
  if (e.target === $('search-modal')) closeSearch();
}

function switchTab(tab) {
  searchTab = tab;
  $('tab-search').classList.toggle('active', tab === 'search');
  $('tab-url').classList.toggle('active', tab === 'url');
  $('tab-search-content').style.display = tab === 'search' ? '' : 'none';
  $('tab-url-content').style.display = tab === 'url' ? '' : 'none';
  $('search-results').innerHTML = '';
  setTimeout(() => (tab === 'search' ? $('search-input') : $('url-input'))?.focus(), 50);
}

// ── YouTube Search via Invidious (client-side) ─────────────────────────────────
async function tryInvidiousSearch(query) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const url = `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video&fields=videoId,title,author,lengthSeconds,videoThumbnails`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    } catch {}
  }
  return null;
}

async function doSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;

  $('search-results').innerHTML = `<div class="search-loading"><div class="spinner"></div>Recherche en cours…</div>`;

  // Try server-side search first (youtube-sr)
  let songs = null;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) songs = data;
    }
  } catch {}

  // Fallback: Invidious client-side
  if (!songs) {
    const inv = await tryInvidiousSearch(q);
    if (inv) {
      songs = inv.slice(0, 8).map(v => ({
        id: v.videoId,
        title: v.title,
        channel: v.author,
        thumbnail: (v.videoThumbnails?.find(t => t.quality === 'medium') || v.videoThumbnails?.[0])?.url
          || `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`,
        duration: formatDuration(v.lengthSeconds),
      }));
    }
  }

  if (!songs) {
    $('search-results').innerHTML = `
      <div class="search-empty" style="color:var(--accent)">
        Recherche indisponible.<br>
        <button class="btn btn-ghost" style="margin-top:.75rem;font-size:.82rem" onclick="switchTab('url')">Utiliser un lien YouTube →</button>
      </div>`;
    return;
  }

  if (songs.length === 0) {
    $('search-results').innerHTML = `<div class="search-empty">Aucun résultat trouvé.</div>`;
    return;
  }

  $('search-results').innerHTML = `<div class="search-results">
    ${songs.map((v, i) => `
      <div class="search-result" data-idx="${i}">
        <img class="sr-thumb" src="${escHtml(v.thumbnail)}" alt="" loading="lazy" onerror="this.src='https://img.youtube.com/vi/${escHtml(v.id)}/mqdefault.jpg'">
        <div class="sr-info">
          <div class="sr-title">${escHtml(v.title)}</div>
          <div class="sr-meta">${escHtml(v.channel || '')} · ${escHtml(v.duration || '')}</div>
        </div>
        <button class="btn btn-primary sr-add" data-idx="${i}">＋</button>
      </div>
    `).join('')}
  </div>`;

  document.querySelectorAll('.search-result').forEach(el => {
    const song = songs[+el.dataset.idx];
    el.onclick = () => addSongDirect(song);
    el.querySelector('.sr-add').onclick = e => { e.stopPropagation(); addSongDirect(song); };
  });
}

function formatDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── URL lookup ────────────────────────────────────────────────────────────────
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

async function doUrlLookup() {
  const input = $('url-input').value.trim();
  if (!input) return;
  const videoId = extractYouTubeId(input);
  if (!videoId) {
    $('search-results').innerHTML = `<div class="search-empty" style="color:var(--accent)">URL invalide. Ex: https://youtube.com/watch?v=dQw4w9WgXcQ</div>`;
    return;
  }

  $('search-results').innerHTML = `<div class="search-loading"><div class="spinner"></div>Récupération des infos…</div>`;

  let title = `Vidéo YouTube`;
  let channel = '';
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (res.ok) {
      const d = await res.json();
      title = d.title || title;
      channel = d.author_name || '';
    }
  } catch {}

  const song = { id: videoId, title, channel, thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`, duration: '' };
  showSongPreview(song);
}

function showSongPreview(song) {
  $('search-results').innerHTML = `
    <div class="search-result" id="preview-result">
      <img class="sr-thumb" src="${escHtml(song.thumbnail)}" alt="">
      <div class="sr-info">
        <div class="sr-title">${escHtml(song.title)}</div>
        <div class="sr-meta">${escHtml(song.channel || '')}</div>
      </div>
      <button class="btn btn-primary sr-add">＋ Ajouter</button>
    </div>
  `;
  $('preview-result').onclick = () => addSongDirect(song);
  $('preview-result').querySelector('.sr-add').onclick = e => { e.stopPropagation(); addSongDirect(song); };
}

function addSongDirect(song) {
  socket.emit('add-to-queue', { partyName: currentParty.name, song }, res => {
    if (res?.error) { toast(res.error, 'error'); return; }
    toast(`"${song.title}" ajouté à la file !`, 'success');
    closeSearch();
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
route();

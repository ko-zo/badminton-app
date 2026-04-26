'use strict';

// ============================================================
// 定数・設定
// ============================================================
const STORAGE_KEY  = 'badminton_v1_members';
const PRIORITY_KEY = 'badminton_v1_priority';

// ============================================================
// 状態
// ============================================================
let members         = [];         // { id, name, active, rest, gender }
let courtTypes      = ['doubles']; // 'doubles' | 'singles' — コートごとの種別
let lastWaitingIds  = [];          // 前回待機だったメンバーID
let lastRestingIds  = [];          // 前回休憩希望だったメンバーID
let currentPriorityIds = [];       // 今ラウンドのシャッフル優先ID（リシャッフル用）
let matchPreference = 'random';    // 'random' | 'mixed' | 'same-gender'

// ============================================================
// ストレージ
// ============================================================
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) members = JSON.parse(raw);
  } catch { members = []; }
  try {
    const raw = localStorage.getItem(PRIORITY_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      lastWaitingIds = p.waiting || [];
      lastRestingIds = p.resting || [];
    }
  } catch {}
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(members)); } catch {}
}

function savePriority() {
  try {
    localStorage.setItem(PRIORITY_KEY, JSON.stringify({
      waiting: lastWaitingIds,
      resting: lastRestingIds,
    }));
  } catch {}
}

// ============================================================
// メンバー操作
// ============================================================
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function addMember(name) {
  const trimmed = name.trim();
  if (!trimmed) return false;
  members.push({ id: generateId(), name: trimmed, active: true, rest: false, gender: null });
  saveState();
  return true;
}

function deleteMember(id) {
  members = members.filter(m => m.id !== id);
  saveState();
}

function toggleActive(id) {
  const m = members.find(m => m.id === id);
  if (!m) return;
  m.active = !m.active;
  if (!m.active) m.rest = false;
  saveState();
}

function toggleRest(id) {
  const m = members.find(m => m.id === id);
  if (!m || !m.active) return;
  m.rest = !m.rest;
  saveState();
}

function cycleGender(id) {
  const m = members.find(m => m.id === id);
  if (!m) return;
  if (m.gender === null)  m.gender = 'M';
  else if (m.gender === 'M') m.gender = 'F';
  else                    m.gender = null;
  saveState();
}

// ============================================================
// 計算
// ============================================================
function getActiveMembers()   { return members.filter(m => m.active); }
function getEligiblePlayers() { return members.filter(m => m.active && !m.rest); }
function getRestPlayers()     { return members.filter(m => m.active && m.rest); }

function totalPlayersNeeded() {
  return courtTypes.reduce((sum, t) => sum + (t === 'singles' ? 2 : 4), 0);
}

function canAddCourt() {
  return getEligiblePlayers().length >= totalPlayersNeeded() + 2;
}

// ============================================================
// 組み合わせアルゴリズム
// ============================================================
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 優先IDのプレイヤーを3倍の重みで並べ、重複を除いて返す
function weightedShuffle(players, priorityIds) {
  const pool = [];
  players.forEach(p => {
    const weight = priorityIds.includes(p.id) ? 3 : 1;
    for (let i = 0; i < weight; i++) pool.push(p);
  });
  const shuffled = shuffleArray(pool);
  const seen = new Set();
  return shuffled.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// 性別優先に応じてプレイヤー順序を調整する
function applyGenderOrdering(players, preference) {
  if (preference === 'random') return players;

  const males    = players.filter(p => p.gender === 'M');
  const females  = players.filter(p => p.gender === 'F');
  const ungended = players.filter(p => !p.gender);

  if (preference === 'mixed') {
    // M,F,M,F,... と交互に並べる → 各ペアが自然にM+Fになる（ダブルスのみ有効）
    const result = [];
    const len = Math.max(males.length, females.length);
    for (let i = 0; i < len; i++) {
      if (i < males.length)   result.push(males[i]);
      if (i < females.length) result.push(females[i]);
    }
    return [...result, ...ungended];
  }

  if (preference === 'same-gender') {
    // M全員 → F全員 → 性別未設定 の順に並べる → 同性グループがコートに固まりやすい
    return [...males, ...females, ...ungended];
  }

  return players;
}

// isNewRound=true のときだけ優先IDを更新する（リシャッフル時は引き継ぐ）
function generateMatches(isNewRound = true) {
  const eligible = getEligiblePlayers();
  const resting  = getRestPlayers();

  if (isNewRound) {
    currentPriorityIds = [...lastWaitingIds, ...lastRestingIds];
  }

  let players = weightedShuffle(eligible, currentPriorityIds);
  players = applyGenderOrdering(players, matchPreference);

  const courts = [];
  let idx = 0;

  for (let i = 0; i < courtTypes.length; i++) {
    const type   = courtTypes[i];
    const needed = type === 'singles' ? 2 : 4;
    if (idx + needed > players.length) break;
    const slice = players.slice(idx, idx + needed);
    idx += needed;

    if (type === 'singles') {
      courts.push({ type: 'singles', player1: slice[0], player2: slice[1] });
    } else {
      courts.push({ type: 'doubles', pair1: [slice[0], slice[1]], pair2: [slice[2], slice[3]] });
    }
  }

  const waiting = players.slice(idx);

  if (isNewRound) {
    lastWaitingIds = waiting.map(p => p.id);
    lastRestingIds = resting.map(p => p.id);
    savePriority();
  }

  return { courts, waiting, resting };
}

// ============================================================
// ユーティリティ
// ============================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function genderClass(gender) {
  if (gender === 'M') return 'gender-m';
  if (gender === 'F') return 'gender-f';
  return '';
}

function genderLabel(gender) {
  if (gender === 'M') return 'M';
  if (gender === 'F') return 'F';
  return '−';
}

// ============================================================
// レンダリング
// ============================================================

function renderRoster() {
  const list  = document.getElementById('roster-list');
  const empty = document.getElementById('roster-empty');
  const badge = document.getElementById('roster-badge');

  list.innerHTML = '';

  if (members.length === 0) {
    empty.hidden = false;
    badge.hidden = true;
    return;
  }

  empty.hidden = true;
  badge.textContent = members.length;
  badge.hidden = false;

  members.forEach(m => {
    const gc = genderClass(m.gender);
    const li = document.createElement('li');
    li.className = `member-item${gc ? ' ' + gc : ''}`;
    li.innerHTML = `
      <button
        class="gender-btn gender-btn-${m.gender || 'none'}"
        data-action="cycle-gender"
        data-id="${escapeHtml(m.id)}"
        aria-label="性別切り替え"
      >${escapeHtml(genderLabel(m.gender))}</button>
      <span class="member-name">${escapeHtml(m.name)}</span>
      <label class="toggle" title="今回参加">
        <input type="checkbox" data-action="toggle-active" data-id="${escapeHtml(m.id)}"${m.active ? ' checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <button
        class="delete-btn"
        data-action="delete"
        data-id="${escapeHtml(m.id)}"
        data-name="${escapeHtml(m.name)}"
        aria-label="${escapeHtml(m.name)}を削除"
      >✕</button>
    `;
    list.appendChild(li);
  });
}

function renderStatus() {
  const list   = document.getElementById('status-list');
  const empty  = document.getElementById('status-empty');
  const badge  = document.getElementById('status-badge');
  const active = getActiveMembers();

  list.innerHTML = '';

  if (active.length === 0) {
    empty.hidden = false;
    badge.hidden = true;
    return;
  }

  empty.hidden = true;
  badge.textContent = active.length;
  badge.hidden = false;

  active.forEach(m => {
    const gc = genderClass(m.gender);
    const li = document.createElement('li');
    li.className = `member-item${gc ? ' ' + gc : ''}`;
    li.innerHTML = `
      <span class="member-name">${escapeHtml(m.name)}</span>
      <label class="rest-label">
        <input type="checkbox" data-action="toggle-rest" data-id="${escapeHtml(m.id)}"${m.rest ? ' checked' : ''}>
        休憩希望
      </label>
    `;
    list.appendChild(li);
  });
}

function renderCourtTypes() {
  const container = document.getElementById('court-type-list');
  container.innerHTML = '';

  courtTypes.forEach((type, i) => {
    const row = document.createElement('div');
    row.className = 'court-type-row';
    row.innerHTML = `
      <span class="court-type-label">コート ${i + 1}</span>
      <div class="court-type-toggle">
        <button
          class="court-type-btn${type === 'doubles' ? ' active' : ''}"
          data-action="set-court-type"
          data-index="${i}"
          data-type="doubles"
        >ダブルス</button>
        <button
          class="court-type-btn${type === 'singles' ? ' active' : ''}"
          data-action="set-court-type"
          data-index="${i}"
          data-type="singles"
        >シングル</button>
      </div>
    `;
    container.appendChild(row);
  });
}

function updateSettings() {
  const eligible = getEligiblePlayers().length;
  const needed   = totalPlayersNeeded();
  const generateBtn = document.getElementById('generate-btn');
  const hint        = document.getElementById('generate-hint');
  const minusBtn    = document.getElementById('court-minus');
  const plusBtn     = document.getElementById('court-plus');
  const display     = document.getElementById('court-display');

  display.textContent = courtTypes.length;
  minusBtn.disabled = courtTypes.length <= 1;
  plusBtn.disabled  = !canAddCourt();

  if (eligible < 2) {
    generateBtn.disabled = true;
    hint.textContent = `あと ${2 - eligible} 人参加（または休憩解除）で作成できます`;
  } else if (needed > eligible) {
    generateBtn.disabled = true;
    hint.textContent = `選手が足りません（必要: ${needed}人 / 対象: ${eligible}人）`;
  } else {
    generateBtn.disabled = false;
    hint.textContent = `${eligible} 人対象 / ${courtTypes.length} コート`;
  }

  renderCourtTypes();
}

function playerHtml(player) {
  const gc = genderClass(player.gender);
  return `<div class="pair-player${gc ? ' ' + gc : ''}">${escapeHtml(player.name)}</div>`;
}

function renderMatches(result) {
  const section         = document.getElementById('matches-section');
  const courtsContainer = document.getElementById('courts-container');
  const restContainer   = document.getElementById('rest-container');

  courtsContainer.innerHTML = '';
  restContainer.innerHTML   = '';

  result.courts.forEach((court, i) => {
    const card = document.createElement('div');
    card.className = 'court-card';

    if (court.type === 'singles') {
      card.innerHTML = `
        <div class="court-card-title">コート ${i + 1} <span class="court-type-tag">シングル</span></div>
        <div class="match-row singles-row">
          ${playerHtml(court.player1)}
          <div class="vs-badge">VS</div>
          ${playerHtml(court.player2)}
        </div>
      `;
    } else {
      card.innerHTML = `
        <div class="court-card-title">コート ${i + 1} <span class="court-type-tag">ダブルス</span></div>
        <div class="match-row">
          <div class="pair">
            ${playerHtml(court.pair1[0])}
            ${playerHtml(court.pair1[1])}
          </div>
          <div class="vs-badge">VS</div>
          <div class="pair">
            ${playerHtml(court.pair2[0])}
            ${playerHtml(court.pair2[1])}
          </div>
        </div>
      `;
    }

    courtsContainer.appendChild(card);
  });

  if (result.waiting.length > 0) {
    const div = document.createElement('div');
    div.className = 'rest-block waiting';
    div.innerHTML = `
      <div class="rest-block-title">待機 (${result.waiting.length}人)</div>
      <ul class="rest-chips">
        ${result.waiting.map(m => {
          const gc = genderClass(m.gender);
          return `<li class="rest-chip${gc ? ' ' + gc : ''}">${escapeHtml(m.name)}</li>`;
        }).join('')}
      </ul>
    `;
    restContainer.appendChild(div);
  }

  if (result.resting.length > 0) {
    const div = document.createElement('div');
    div.className = 'rest-block hoping';
    div.innerHTML = `
      <div class="rest-block-title">希望休憩 (${result.resting.length}人)</div>
      <ul class="rest-chips">
        ${result.resting.map(m => {
          const gc = genderClass(m.gender);
          return `<li class="rest-chip${gc ? ' ' + gc : ''}">${escapeHtml(m.name)}</li>`;
        }).join('')}
      </ul>
    `;
    restContainer.appendChild(div);
  }

  section.hidden = false;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderAll() {
  renderRoster();
  renderStatus();
  updateSettings();
}

// ============================================================
// 削除確認ダイアログ
// ============================================================
let pendingDeleteId = null;

function showDeleteDialog(id, name) {
  pendingDeleteId = id;
  document.getElementById('dialog-message').textContent = `「${name}」を削除しますか？`;
  document.getElementById('dialog-overlay').hidden = false;
}

function hideDeleteDialog() {
  pendingDeleteId = null;
  document.getElementById('dialog-overlay').hidden = true;
}

// ============================================================
// イベントバインド
// ============================================================
function setupEvents() {

  // ---- メンバー追加 ----
  const memberInput = document.getElementById('member-input');
  const addBtn      = document.getElementById('add-btn');

  addBtn.addEventListener('click', () => {
    if (addMember(memberInput.value)) {
      memberInput.value = '';
      memberInput.focus();
      renderAll();
    }
  });

  memberInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addBtn.click();
  });

  // ---- 登録簿（イベント委譲） ----
  document.getElementById('roster-list').addEventListener('change', e => {
    if (e.target.dataset.action === 'toggle-active') {
      toggleActive(e.target.dataset.id);
      renderAll();
    }
  });

  document.getElementById('roster-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'delete') {
      showDeleteDialog(btn.dataset.id, btn.dataset.name);
    } else if (btn.dataset.action === 'cycle-gender') {
      cycleGender(btn.dataset.id);
      renderAll();
    }
  });

  // ---- ステータス（イベント委譲） ----
  document.getElementById('status-list').addEventListener('change', e => {
    if (e.target.dataset.action === 'toggle-rest') {
      toggleRest(e.target.dataset.id);
      renderAll();
    }
  });

  // ---- コート数 ± ----
  document.getElementById('court-minus').addEventListener('click', () => {
    if (courtTypes.length > 1) {
      courtTypes.pop();
      updateSettings();
    }
  });

  document.getElementById('court-plus').addEventListener('click', () => {
    if (canAddCourt()) {
      courtTypes.push('doubles');
      updateSettings();
    }
  });

  // ---- コートタイプ切り替え（イベント委譲） ----
  document.getElementById('court-type-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="set-court-type"]');
    if (!btn) return;
    const idx  = parseInt(btn.dataset.index, 10);
    const type = btn.dataset.type;
    if (courtTypes[idx] === type) return;
    courtTypes[idx] = type;
    updateSettings();
  });

  // ---- 組み合わせ優先 ----
  document.getElementById('preference-group').addEventListener('change', e => {
    if (e.target.name === 'match-pref') {
      matchPreference = e.target.value;
    }
  });

  // ---- 組み合わせ作成（新ラウンド：優先IDを更新） ----
  document.getElementById('generate-btn').addEventListener('click', () => {
    const result = generateMatches(true);
    renderMatches(result);
  });

  // ---- もう一度シャッフル（同ラウンド：優先IDを引き継ぐ） ----
  document.getElementById('reshuffle-btn').addEventListener('click', () => {
    const result = generateMatches(false);
    renderMatches(result);
  });

  // ---- 削除ダイアログ ----
  document.getElementById('dialog-cancel').addEventListener('click', hideDeleteDialog);

  document.getElementById('dialog-ok').addEventListener('click', () => {
    if (pendingDeleteId) {
      deleteMember(pendingDeleteId);
      renderAll();
    }
    hideDeleteDialog();
  });

  document.getElementById('dialog-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('dialog-overlay')) hideDeleteDialog();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('dialog-overlay').hidden) {
      hideDeleteDialog();
    }
  });
}

// ============================================================
// PWA: Service Worker 登録
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ============================================================
// 初期化
// ============================================================
loadState();
setupEvents();
renderAll();

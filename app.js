'use strict';

// ============================================================
// 定数・設定
// ============================================================
const STORAGE_KEY = 'badminton_v1_members';
const PLAYERS_PER_COURT = 4; // ダブルス固定（将来のシングルス対応のため定数化）

// ============================================================
// 状態
// ============================================================
let members = [];       // { id: string, name: string, active: boolean, rest: boolean }
let courtCount = 1;     // 現在のコート数

// ============================================================
// ストレージ
// ============================================================
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) members = JSON.parse(raw);
  } catch {
    members = [];
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
  } catch {
    // ストレージ容量超過などは無視
  }
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
  members.push({ id: generateId(), name: trimmed, active: true, rest: false });
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
  if (!m.active) m.rest = false; // 非参加時は休憩希望をリセット
  saveState();
}

function toggleRest(id) {
  const m = members.find(m => m.id === id);
  if (!m || !m.active) return;
  m.rest = !m.rest;
  saveState();
}

// ============================================================
// 計算
// ============================================================
function getActiveMembers()   { return members.filter(m => m.active); }
function getEligiblePlayers() { return members.filter(m => m.active && !m.rest); }
function getRestPlayers()     { return members.filter(m => m.active && m.rest); }
function getMaxCourts()       { return Math.floor(getEligiblePlayers().length / PLAYERS_PER_COURT); }

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

function generateMatches() {
  const eligible = getEligiblePlayers();
  const resting  = getRestPlayers();
  const shuffled = shuffleArray(eligible);
  const courts   = [];

  for (let i = 0; i < courtCount; i++) {
    const slice = shuffled.slice(i * PLAYERS_PER_COURT, (i + 1) * PLAYERS_PER_COURT);
    if (slice.length < PLAYERS_PER_COURT) break;
    courts.push({
      pair1: [slice[0], slice[1]],
      pair2: [slice[2], slice[3]],
    });
  }

  const assigned = courts.length * PLAYERS_PER_COURT;
  const waiting  = shuffled.slice(assigned); // 余剰者 → 待機

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

// ============================================================
// レンダリング
// ============================================================

/** 登録簿エリア */
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
    const li = document.createElement('li');
    li.className = 'member-item';
    li.innerHTML = `
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

/** ステータスエリア */
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
    const li = document.createElement('li');
    li.className = 'member-item';
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

/** コート数・ボタン状態を更新 */
function updateSettings() {
  const maxCourts  = getMaxCourts();
  const eligible   = getEligiblePlayers().length;
  const generateBtn = document.getElementById('generate-btn');
  const hint        = document.getElementById('generate-hint');
  const minusBtn    = document.getElementById('court-minus');
  const plusBtn     = document.getElementById('court-plus');
  const display     = document.getElementById('court-display');

  // コート数を有効範囲内に収める
  if (maxCourts < 1) {
    courtCount = 1;
  } else {
    courtCount = Math.min(courtCount, maxCourts);
    courtCount = Math.max(courtCount, 1);
  }
  display.textContent = courtCount;

  // ± ボタンの有効・無効
  minusBtn.disabled = courtCount <= 1;
  plusBtn.disabled  = courtCount >= maxCourts || maxCourts < 1;

  // 作成ボタン & ヒントメッセージ
  if (eligible < PLAYERS_PER_COURT) {
    generateBtn.disabled = true;
    const need = PLAYERS_PER_COURT - eligible;
    hint.textContent = `あと ${need} 人参加（または休憩解除）で作成できます`;
  } else {
    generateBtn.disabled = false;
    hint.textContent = `${eligible} 人対象 / 最大 ${maxCourts} コート`;
  }
}

/** 対戦表エリアを描画 */
function renderMatches(result) {
  const section        = document.getElementById('matches-section');
  const courtsContainer = document.getElementById('courts-container');
  const restContainer  = document.getElementById('rest-container');

  courtsContainer.innerHTML = '';
  restContainer.innerHTML   = '';

  // コートカード
  result.courts.forEach((court, i) => {
    const card = document.createElement('div');
    card.className = 'court-card';
    card.innerHTML = `
      <div class="court-card-title">コート ${i + 1}</div>
      <div class="match-row">
        <div class="pair">
          <div class="pair-player">${escapeHtml(court.pair1[0].name)}</div>
          <div class="pair-player">${escapeHtml(court.pair1[1].name)}</div>
        </div>
        <div class="vs-badge">VS</div>
        <div class="pair">
          <div class="pair-player">${escapeHtml(court.pair2[0].name)}</div>
          <div class="pair-player">${escapeHtml(court.pair2[1].name)}</div>
        </div>
      </div>
    `;
    courtsContainer.appendChild(card);
  });

  // 待機（コートに入れなかった余剰者）
  if (result.waiting.length > 0) {
    const div = document.createElement('div');
    div.className = 'rest-block waiting';
    div.innerHTML = `
      <div class="rest-block-title">待機 (${result.waiting.length}人)</div>
      <ul class="rest-chips">
        ${result.waiting.map(m => `<li class="rest-chip">${escapeHtml(m.name)}</li>`).join('')}
      </ul>
    `;
    restContainer.appendChild(div);
  }

  // 希望休憩
  if (result.resting.length > 0) {
    const div = document.createElement('div');
    div.className = 'rest-block hoping';
    div.innerHTML = `
      <div class="rest-block-title">希望休憩 (${result.resting.length}人)</div>
      <ul class="rest-chips">
        ${result.resting.map(m => `<li class="rest-chip">${escapeHtml(m.name)}</li>`).join('')}
      </ul>
    `;
    restContainer.appendChild(div);
  }

  section.hidden = false;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 全エリアを再描画 */
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
    const btn = e.target.closest('[data-action="delete"]');
    if (btn) showDeleteDialog(btn.dataset.id, btn.dataset.name);
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
    if (courtCount > 1) {
      courtCount--;
      updateSettings();
    }
  });

  document.getElementById('court-plus').addEventListener('click', () => {
    const max = getMaxCourts();
    if (courtCount < max) {
      courtCount++;
      updateSettings();
    }
  });

  // ---- 組み合わせ作成 ----
  document.getElementById('generate-btn').addEventListener('click', () => {
    const result = generateMatches();
    renderMatches(result);
  });

  // ---- もう一度シャッフル ----
  document.getElementById('reshuffle-btn').addEventListener('click', () => {
    const result = generateMatches();
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

  // オーバーレイ外クリックでキャンセル
  document.getElementById('dialog-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('dialog-overlay')) hideDeleteDialog();
  });

  // ESCキーでキャンセル
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
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Service Worker 未対応環境は無視
    });
  });
}

// ============================================================
// 初期化
// ============================================================
loadState();
setupEvents();
renderAll();

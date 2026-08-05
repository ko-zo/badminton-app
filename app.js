'use strict';

// ============================================================
// 定数・設定
// ============================================================
const STORAGE_KEY  = 'badminton_v1_members';
const SETTINGS_KEY = 'badminton_v1_settings';

// 対戦記録と未確定の組み合わせは必ず1つのキーへまとめて書く。
// 別々に書くと片方だけ成功したときに状態が食い違い、
// 「記録済みなのに未確定が残る」＝二重計上、または
// 「未確定が消えたのに記録されていない」＝試合の消失が起きるため。
const LOG_KEY = 'badminton_v1_log';

// 旧バージョンのキー。読み込み時に移行して削除する。
const LEGACY_SESSIONS_KEY = 'badminton_v1_sessions';
const LEGACY_PENDING_KEY  = 'badminton_v1_pending';
// 「前回待機者を3倍の重みで優先」用。試合数ベースの公平化に置き換え済み。
const LEGACY_PRIORITY_KEY = 'badminton_v1_priority';

const COURT_TYPES = ['doubles', 'singles'];
const PREFERENCES = ['random', 'mixed', 'same-gender'];
const TABS        = ['members', 'match', 'log'];

const MAX_SESSIONS   = 100; // 保持する練習会の数（1回あたり約5KBなので上限5MBに対して十分小さい）
const ARRANGE_TRIES  = 200; // 組み方の候補を何通り試すか

// 組み方スコアの重み（小さいほど良い組み合わせ）
const W_PAIR   = 3;   // 同じペアの再結成
const W_OPP    = 1;   // 同じ対戦の再戦
// 組み合わせ優先はユーザーが明示的に選んだ設定なので、重複回避より必ず優先させる。
// 履歴が溜まると重複の減点が積み上がるため、それを確実に上回る値にしている。
const W_GENDER = 100;

// ============================================================
// 状態
// ============================================================
let members         = [];          // { id, name, active, rest, gender }
let courtTypes      = ['doubles']; // 'doubles' | 'singles' — コートごとの種別
let matchPreference = 'random';    // 'random' | 'mixed' | 'same-gender'
let activeTab       = 'members';
let sessions        = [];          // [{ date, names: {id:name}, rounds: [...] }]
let pendingRound    = null;        // 表示中で未確定の組み合わせ（確定するまで記録されない）

// ============================================================
// ストレージ
// ============================================================

// 保存に失敗したものを覚えておき、画面に警告として出す。
// 例外を握りつぶすと「確定したのに保存されていない」状態に気づけないため。
const failedWrites = new Map(); // key -> 表示用ラベル

function renderStorageWarning() {
  const el = document.getElementById('storage-warning');
  if (!el) return;
  if (failedWrites.size === 0) {
    el.hidden = true;
    return;
  }
  el.textContent =
    `${[...failedWrites.values()].join('・')}を保存できませんでした。`
    + '端末の空き容量やブラウザの設定を確認してください。'
    + 'このままアプリを閉じると、この内容は失われます。';
  el.hidden = false;
}

function writeStore(key, value, label) {
  try {
    localStorage.setItem(key, value);
    failedWrites.delete(key);
    renderStorageWarning();
    return true;
  } catch {
    failedWrites.set(key, label);
    renderStorageWarning();
    return false;
  }
}

// 壊れた値が入っていても落ちないよう、読み込み時に構造を検証する
function sanitizeSessions(parsed) {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(s => s && typeof s.date === 'string' && Array.isArray(s.rounds))
    .map(s => ({
      date:   s.date,
      names:  (s.names && typeof s.names === 'object') ? s.names : {},
      rounds: s.rounds.filter(r => r && Array.isArray(r.courts)),
    }));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) members = parsed.filter(m => m && typeof m.id === 'string');
  } catch { members = []; }

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const types = (s.courtTypes || []).filter(t => COURT_TYPES.includes(t));
      if (types.length > 0) courtTypes = types;
      if (PREFERENCES.includes(s.matchPreference)) matchPreference = s.matchPreference;
      if (TABS.includes(s.activeTab)) activeTab = s.activeTab;
    }
  } catch {}

  loadLog();

  try { localStorage.removeItem(LEGACY_PRIORITY_KEY); } catch {}
}

function loadLog() {
  let sessionsRaw = null;
  let pendingRaw  = null;

  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        sessionsRaw = parsed.sessions;
        pendingRaw  = parsed.pending;
      }
    }
  } catch {}

  // 旧バージョン（別キー保存）からの移行
  let migrated = false;
  if (sessionsRaw === null && pendingRaw === null) {
    try {
      const rawSessions = localStorage.getItem(LEGACY_SESSIONS_KEY);
      if (rawSessions) { sessionsRaw = JSON.parse(rawSessions); migrated = true; }
    } catch {}
    try {
      const rawPending = localStorage.getItem(LEGACY_PENDING_KEY);
      if (rawPending) { pendingRaw = JSON.parse(rawPending); migrated = true; }
    } catch {}
  }

  sessions = sanitizeSessions(sessionsRaw);

  // 日付が変わっていたら前日の未確定分は捨てる
  if (pendingRaw && pendingRaw.date === todayKey() && Array.isArray(pendingRaw.courts)) {
    pendingRound = hydrateRound(pendingRaw);
  }

  if (migrated && saveLog()) {
    try {
      localStorage.removeItem(LEGACY_SESSIONS_KEY);
      localStorage.removeItem(LEGACY_PENDING_KEY);
    } catch {}
  }
}

function saveState() {
  return writeStore(STORAGE_KEY, JSON.stringify(members), 'メンバー');
}

function saveSettings() {
  return writeStore(SETTINGS_KEY, JSON.stringify({
    courtTypes,
    matchPreference,
    activeTab,
  }), '設定');
}

// 対戦記録と未確定の組み合わせを1回の書き込みで保存する
function saveLog() {
  const payload = JSON.stringify({
    sessions,
    pending: pendingRound ? { date: todayKey(), ...serializeRound(pendingRound) } : null,
  });
  return writeStore(LOG_KEY, payload, '対戦記録');
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
  if (m.gender === null)     m.gender = 'M';
  else if (m.gender === 'M') m.gender = 'F';
  else                       m.gender = null;
  saveState();
}

// ============================================================
// セッション（練習会 = 1日）と対戦ログ
// ============================================================
function todayKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// 公平性の計算は「当日のセッション」だけを見る。
// 日が変わればメンバーも変わるため、過去日と混ぜると不公平になる。
function getCurrentSession() {
  return sessions.find(s => s.date === todayKey()) || null;
}

function getOrCreateCurrentSession() {
  let s = getCurrentSession();
  if (!s) {
    s = { date: todayKey(), names: {}, rounds: [] };
    sessions.push(s);
    if (sessions.length > MAX_SESSIONS) sessions = sessions.slice(-MAX_SESSIONS);
  }
  return s;
}

function serializeRound(round) {
  return {
    courts: round.courts.map(c => c.type === 'singles'
      ? { type: 'singles', player1: c.player1.id, player2: c.player2.id }
      : { type: 'doubles', pair1: c.pair1.map(p => p.id), pair2: c.pair2.map(p => p.id) }),
    waiting: round.waiting.map(p => p.id),
    resting: round.resting.map(p => p.id),
  };
}

function hydrateRound(record) {
  const find = id => members.find(m => m.id === id) || { id, name: '(削除済み)', gender: null };
  return {
    courts: (record.courts || []).map(c => c.type === 'singles'
      ? { type: 'singles', player1: find(c.player1), player2: find(c.player2) }
      : { type: 'doubles', pair1: (c.pair1 || []).map(find), pair2: (c.pair2 || []).map(find) }),
    waiting: (record.waiting || []).map(find),
    resting: (record.resting || []).map(find),
  };
}

// 保存できなかった場合はメモリ上の変更も巻き戻す。
// 「確定したように見えるのに保存されていない」状態を作らないため。
function confirmPendingRound() {
  if (!pendingRound) return true;

  const existed     = !!getCurrentSession();
  const session     = getOrCreateCurrentSession();
  const roundsCount = session.rounds.length;
  const namesBackup = { ...session.names };
  const saved       = pendingRound;

  // 名前を控えておくと、あとでメンバーを削除しても履歴が読める
  members.forEach(m => { session.names[m.id] = m.name; });
  session.rounds.push({ at: Date.now(), ...serializeRound(pendingRound) });
  pendingRound = null;

  if (saveLog()) return true;

  session.rounds.length = roundsCount;
  session.names         = namesBackup;
  if (!existed) sessions = sessions.filter(s => s !== session);
  pendingRound = saved;
  return false;
}

function clearPendingRound() {
  const saved = pendingRound;
  pendingRound = null;
  if (saveLog()) return true;
  pendingRound = saved;
  return false;
}

function deleteRound(index) {
  const session = getCurrentSession();
  if (!session || index < 0 || index >= session.rounds.length) return false;
  const removed = session.rounds.splice(index, 1);
  if (saveLog()) return true;
  session.rounds.splice(index, 0, ...removed);
  return false;
}

// そのラウンドで実際にコートに立った人のID
function playersInRound(record) {
  const ids = [];
  (record.courts || []).forEach(c => {
    if (c.type === 'singles') ids.push(c.player1, c.player2);
    else ids.push(...(c.pair1 || []), ...(c.pair2 || []));
  });
  return ids;
}

// 当日の確定済みラウンドから各メンバーの試合数を数える
function getMatchCounts() {
  const counts = {};
  const session = getCurrentSession();
  if (session) {
    session.rounds.forEach(r => {
      playersInRound(r).forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    });
  }
  return counts;
}

function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

// 当日の確定済みラウンドから、ペアの回数と対戦の回数を数える
function getPairHistory() {
  const pair = {};
  const opp  = {};
  const bump = (map, a, b) => { const k = pairKey(a, b); map[k] = (map[k] || 0) + 1; };
  const session = getCurrentSession();

  if (session) {
    session.rounds.forEach(r => (r.courts || []).forEach(c => {
      if (c.type === 'singles') {
        bump(opp, c.player1, c.player2);
      } else {
        const [a, b] = c.pair1 || [];
        const [x, y] = c.pair2 || [];
        if (a && b) bump(pair, a, b);
        if (x && y) bump(pair, x, y);
        (c.pair1 || []).forEach(p => (c.pair2 || []).forEach(q => bump(opp, p, q)));
      }
    }));
  }
  return { pair, opp };
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

// 先頭から順にコートを埋めたとき、実際に出場する人数
function playingCount(available) {
  let count = 0;
  for (const type of courtTypes) {
    const needed = type === 'singles' ? 2 : 4;
    if (count + needed > available) break;
    count += needed;
  }
  return count;
}

// ＋ボタンは常にダブルス（4人）を追加するため、4人分の余裕がなければ増やせない
function canAddCourt() {
  return getEligiblePlayers().length >= totalPlayersNeeded() + 4;
}

function canGenerate() {
  const eligible = getEligiblePlayers().length;
  return eligible >= 2 && totalPlayersNeeded() <= eligible;
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

// 組み合わせ優先に反していれば減点する。
// 混合優先はペアの概念があるダブルスのみ、同性対戦優先はシングルスにも効かせる。
function genderPenalty(side1, side2) {
  if (matchPreference === 'mixed') {
    let penalty = 0;
    [side1, side2].forEach(side => {
      if (side.length === 2 && side[0].gender && side[1].gender && side[0].gender === side[1].gender) {
        penalty += W_GENDER;
      }
    });
    return penalty;
  }
  if (matchPreference === 'same-gender') {
    const genders = [...side1, ...side2].map(p => p.gender).filter(Boolean);
    return genders.includes('M') && genders.includes('F') ? W_GENDER : 0;
  }
  return 0;
}

// 並び順どおりにコートへ割り当てた場合の「悪さ」を採点する
function scoreArrangement(players, history) {
  let score = 0;
  let idx   = 0;

  for (const type of courtTypes) {
    const needed = type === 'singles' ? 2 : 4;
    if (idx + needed > players.length) break;

    if (type === 'singles') {
      const [a, b] = players.slice(idx, idx + 2);
      score += (history.opp[pairKey(a.id, b.id)] || 0) * W_OPP;
      score += genderPenalty([a], [b]);
    } else {
      const [a, b, c, d] = players.slice(idx, idx + 4);
      score += (history.pair[pairKey(a.id, b.id)] || 0) * W_PAIR;
      score += (history.pair[pairKey(c.id, d.id)] || 0) * W_PAIR;
      [[a, c], [a, d], [b, c], [b, d]].forEach(([x, y]) => {
        score += (history.opp[pairKey(x.id, y.id)] || 0) * W_OPP;
      });
      score += genderPenalty([a, b], [c, d]);
    }
    idx += needed;
  }
  return score;
}

// 候補を何通りか試して、ペア・対戦の重複と性別優先の点で最良の並びを選ぶ
function bestArrangement(playing) {
  if (playing.length === 0) return playing;
  const history = getPairHistory();

  let best      = playing;
  let bestScore = Infinity;

  for (let i = 0; i < ARRANGE_TRIES; i++) {
    const candidate = shuffleArray(playing);
    const score     = scoreArrangement(candidate, history);
    if (score < bestScore) {
      bestScore = score;
      best      = candidate;
      if (score === 0) break; // これ以上良くならない
    }
  }
  return best;
}

function buildCourts(players) {
  const courts = [];
  let idx = 0;

  for (const type of courtTypes) {
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
  return { courts, used: idx };
}

function generateMatches() {
  const eligible = getEligiblePlayers();
  const resting  = getRestPlayers();
  const counts   = getMatchCounts();

  // 誰が出るか: 当日の試合数が少ない人から順に選ぶ（同数の中はランダム）。
  // 先にシャッフルしてから安定ソートすることで、同数グループの順序がランダムになる。
  const ordered = shuffleArray(eligible)
    .sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0));

  const playCount = playingCount(ordered.length);
  const playing   = ordered.slice(0, playCount);
  const waiting   = ordered.slice(playCount);

  // どう組むか: 出場者の中だけで、重複が少なく優先設定に沿う並びを選ぶ
  const { courts } = buildCourts(bestArrangement(playing));

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

function formatTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function nameOf(id, names) {
  const m = members.find(x => x.id === id);
  if (m) return m.name;
  return (names && names[id]) || '(削除済み)';
}

// ============================================================
// タブ
// ============================================================
function switchTab(tab) {
  if (!TABS.includes(tab)) return;
  activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.hidden = panel.id !== `panel-${tab}`;
  });

  if (tab === 'log') renderLog();
  saveSettings();
  window.scrollTo(0, 0);
}

// ============================================================
// レンダリング：メンバータブ
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

// 本日の参加者はチップで表示し、タップで休憩を切り替える。
// 試合中に何度も触る操作なので、試合タブの一番上に置いて縦幅も抑えている。
function renderStatus() {
  const list   = document.getElementById('status-list');
  const empty  = document.getElementById('status-empty');
  const badge  = document.getElementById('status-badge');
  const hint   = document.getElementById('status-hint');
  const active = getActiveMembers();

  list.innerHTML = '';

  if (active.length === 0) {
    empty.hidden = false;
    badge.hidden = true;
    hint.textContent = '';
    return;
  }

  empty.hidden = true;
  badge.textContent = active.length;
  badge.hidden = false;

  active.forEach(m => {
    const gc  = genderClass(m.gender);
    const btn = document.createElement('button');
    btn.className     = `player-chip${gc ? ' ' + gc : ''}${m.rest ? ' resting' : ''}`;
    btn.dataset.action = 'toggle-rest';
    btn.dataset.id     = m.id;
    btn.textContent    = m.name;
    btn.setAttribute('aria-pressed', m.rest ? 'true' : 'false');
    btn.setAttribute('aria-label', `${m.name}：${m.rest ? '休憩中。タップで復帰' : '参加中。タップで休憩'}`);
    list.appendChild(btn);
  });

  const resting = getRestPlayers().length;
  hint.textContent = resting > 0
    ? `タップで休憩の切り替え　／　休憩中 ${resting} 人・抽選対象 ${active.length - resting} 人`
    : 'タップで休憩の切り替え';
}

// ============================================================
// レンダリング：試合タブ
// ============================================================
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

// 保存された組み合わせ優先をラジオボタンに反映する（コート設定は renderCourtTypes が描画する）
function renderPreference() {
  const radio = document.querySelector(`input[name="match-pref"][value="${matchPreference}"]`);
  if (radio) radio.checked = true;
}

function updateSettings() {
  const eligible     = getEligiblePlayers().length;
  const needed       = totalPlayersNeeded();
  const mainBtn      = document.getElementById('main-btn');
  const reshuffleBtn = document.getElementById('reshuffle-btn');
  const secondaryRow = document.getElementById('secondary-row');
  const hint         = document.getElementById('generate-hint');
  const minusBtn     = document.getElementById('court-minus');
  const plusBtn      = document.getElementById('court-plus');
  const display      = document.getElementById('court-display');
  const ready        = canGenerate();

  display.textContent = courtTypes.length;
  minusBtn.disabled = courtTypes.length <= 1;
  plusBtn.disabled  = !canAddCourt();

  secondaryRow.hidden   = !pendingRound;
  reshuffleBtn.disabled = !ready;

  // 主ボタンは常に「次にすべきこと」を示す。組み合わせが出ているときは確定が
  // その位置に来るので、試合後に押したくなる操作がそのまま記録につながる。
  if (pendingRound) {
    mainBtn.textContent = ready ? '確定して次の組み合わせへ' : '確定する';
    mainBtn.classList.remove('mode-generate');
    mainBtn.classList.add('mode-confirm');
    mainBtn.disabled = false;   // 次を作れなくても確定だけはできる
  } else {
    mainBtn.textContent = '組み合わせ作成';
    mainBtn.classList.remove('mode-confirm');
    mainBtn.classList.add('mode-generate');
    mainBtn.disabled = !ready;
  }

  if (pendingRound) {
    hint.textContent = ready
      ? '試合をしたら上のボタンで確定。していなければ「取り消し」'
      : `確定はできます（次を作るには 必要: ${needed}人 / 対象: ${eligible}人）`;
  } else if (eligible < 2) {
    hint.textContent = `あと ${2 - eligible} 人参加（または休憩解除）で作成できます`;
  } else if (needed > eligible) {
    hint.textContent = `選手が足りません（必要: ${needed}人 / 対象: ${eligible}人）`;
  } else {
    hint.textContent = `${eligible} 人対象 / ${courtTypes.length} コート`;
  }

  renderCourtTypes();
}

function playerHtml(player) {
  const gc = genderClass(player.gender);
  return `<div class="pair-player${gc ? ' ' + gc : ''}">${escapeHtml(player.name)}</div>`;
}

function renderMatches() {
  const section         = document.getElementById('matches-section');
  const courtsContainer = document.getElementById('courts-container');
  const restContainer   = document.getElementById('rest-container');

  if (!pendingRound) {
    section.hidden = true;
    return;
  }

  courtsContainer.innerHTML = '';
  restContainer.innerHTML   = '';

  pendingRound.courts.forEach((court, i) => {
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

  const chipBlock = (title, list, cls) => {
    if (list.length === 0) return;
    const div = document.createElement('div');
    div.className = `rest-block ${cls}`;
    div.innerHTML = `
      <div class="rest-block-title">${title} (${list.length}人)</div>
      <ul class="rest-chips">
        ${list.map(m => {
          const gc = genderClass(m.gender);
          return `<li class="rest-chip${gc ? ' ' + gc : ''}">${escapeHtml(m.name)}</li>`;
        }).join('')}
      </ul>
    `;
    restContainer.appendChild(div);
  };

  chipBlock('待機', pendingRound.waiting, 'waiting');
  chipBlock('希望休憩', pendingRound.resting, 'hoping');

  section.hidden = false;
}

// ============================================================
// レンダリング：記録タブ
// ============================================================
function renderCounts() {
  const list   = document.getElementById('count-list');
  const empty  = document.getElementById('count-empty');
  const badge  = document.getElementById('today-badge');
  const counts = getMatchCounts();
  const shown  = getActiveMembers();
  const session = getCurrentSession();
  const total   = session ? session.rounds.length : 0;

  list.innerHTML = '';
  badge.textContent = `${total} ラウンド`;
  badge.hidden = total === 0;

  if (shown.length === 0 || total === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  // 試合数が少ない順＝次に出やすい順。最少の人は色を変えて分かるようにする
  const sorted = [...shown].sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0));
  const min    = counts[sorted[0].id] || 0;

  sorted.forEach(m => {
    const n  = counts[m.id] || 0;
    const gc = genderClass(m.gender);
    const li = document.createElement('li');
    li.className = `count-item${gc ? ' ' + gc : ''}${n === min ? ' count-min' : ''}`;
    li.innerHTML = `
      <span class="count-name">${escapeHtml(m.name)}</span>
      <span class="count-value">${n} 試合</span>
    `;
    list.appendChild(li);
  });
}

function renderHistory() {
  const container = document.getElementById('history-list');
  const empty     = document.getElementById('history-empty');
  const session   = getCurrentSession();

  container.innerHTML = '';

  if (!session || session.rounds.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  // 新しいものを上に出す。削除するときは元の配列の位置が要るので index を持たせる
  session.rounds.forEach((round, index) => {
    const div = document.createElement('div');
    div.className = 'history-round';

    const lines = (round.courts || []).map((c, i) => {
      const tag  = c.type === 'singles' ? 'シングル' : 'ダブルス';
      const text = c.type === 'singles'
        ? `${nameOf(c.player1, session.names)} vs ${nameOf(c.player2, session.names)}`
        : `${c.pair1.map(id => nameOf(id, session.names)).join('・')} vs ${c.pair2.map(id => nameOf(id, session.names)).join('・')}`;
      return `<div class="history-line">
        <span class="history-court-tag">${escapeHtml(tag)}</span>${escapeHtml(`コート${i + 1}　${text}`)}
      </div>`;
    }).join('');

    div.innerHTML = `
      <div class="history-head">
        <span class="history-title">${escapeHtml(formatTime(round.at))} の試合</span>
        <button class="delete-btn" data-action="delete-round" data-index="${index}"
                aria-label="この試合の記録を削除">✕</button>
      </div>
      ${lines}
    `;
    container.prepend(div);
  });
}

function renderPast() {
  const list  = document.getElementById('past-list');
  const empty = document.getElementById('past-empty');
  const past  = sessions.filter(s => s.date !== todayKey());

  list.innerHTML = '';

  if (past.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  [...past].reverse().forEach(s => {
    const li = document.createElement('li');
    li.className = 'past-item';
    li.innerHTML = `
      <span class="past-date">${escapeHtml(s.date)}</span>
      <span class="past-count">${s.rounds.length} ラウンド</span>
    `;
    list.appendChild(li);
  });
}

function renderLog() {
  renderCounts();
  renderHistory();
  renderPast();
}

function renderAll() {
  renderRoster();
  renderStatus();
  updateSettings();
  renderMatches();
  if (activeTab === 'log') renderLog();
}

// ============================================================
// 記録の書き出し
// ============================================================
function exportSessions() {
  try {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), members, sessions }, null, 2);
    const url  = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `badminton-log-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {}
}

// ============================================================
// 確認ダイアログ（メンバー削除・記録削除で共用）
// ============================================================
let confirmAction = null;

function showConfirm(message, onOk) {
  confirmAction = onOk;
  document.getElementById('dialog-message').textContent = message;
  document.getElementById('dialog-overlay').hidden = false;
}

function hideConfirm() {
  confirmAction = null;
  document.getElementById('dialog-overlay').hidden = true;
}

// ============================================================
// イベントバインド
// ============================================================
function setupEvents() {

  // ---- タブ ----
  document.querySelector('.tab-bar').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (btn) switchTab(btn.dataset.tab);
  });

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
      const id = btn.dataset.id;
      showConfirm(`「${btn.dataset.name}」を削除しますか？`, () => {
        deleteMember(id);
        renderAll();
      });
    } else if (btn.dataset.action === 'cycle-gender') {
      cycleGender(btn.dataset.id);
      renderAll();
    }
  });

  // ---- 本日の参加者チップ（イベント委譲） ----
  document.getElementById('status-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="toggle-rest"]');
    if (!btn) return;
    toggleRest(btn.dataset.id);
    renderAll();
  });

  // ---- コート数 ± ----
  document.getElementById('court-minus').addEventListener('click', () => {
    if (courtTypes.length > 1) {
      courtTypes.pop();
      saveSettings();
      updateSettings();
    }
  });

  document.getElementById('court-plus').addEventListener('click', () => {
    if (canAddCourt()) {
      courtTypes.push('doubles');
      saveSettings();
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
    saveSettings();
    updateSettings();
  });

  // ---- 組み合わせ優先 ----
  document.getElementById('preference-group').addEventListener('change', e => {
    if (e.target.name === 'match-pref') {
      matchPreference = e.target.value;
      saveSettings();
    }
  });

  // ---- 主ボタン: 表示中のものがあれば確定し、続けて次を引く ----
  document.getElementById('main-btn').addEventListener('click', () => {
    // 確定に失敗した場合は次を引かない（未確定のまま残して気づけるようにする）
    if (pendingRound && !confirmPendingRound()) {
      renderAll();
      return;
    }
    if (canGenerate()) {
      pendingRound = generateMatches();
      saveLog();
    }
    renderAll();
    if (pendingRound) {
      document.getElementById('matches-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // ---- 引き直す（記録せずに引き直すだけ） ----
  document.getElementById('reshuffle-btn').addEventListener('click', () => {
    if (!canGenerate()) return;
    pendingRound = generateMatches();
    saveLog();
    renderAll();
  });

  // ---- 取り消し（記録せず破棄） ----
  document.getElementById('clear-btn').addEventListener('click', () => {
    clearPendingRound();
    renderAll();
  });

  // ---- 記録の削除（イベント委譲） ----
  document.getElementById('history-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="delete-round"]');
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    showConfirm('この試合の記録を削除しますか？', () => {
      deleteRound(index);
      renderLog();
    });
  });

  // ---- 書き出し ----
  document.getElementById('export-btn').addEventListener('click', exportSessions);

  // ---- 確認ダイアログ ----
  document.getElementById('dialog-cancel').addEventListener('click', hideConfirm);

  document.getElementById('dialog-ok').addEventListener('click', () => {
    const action = confirmAction;
    hideConfirm();
    if (action) action();
  });

  document.getElementById('dialog-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('dialog-overlay')) hideConfirm();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('dialog-overlay').hidden) {
      hideConfirm();
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
renderPreference();
setupEvents();
switchTab(activeTab);
renderAll();

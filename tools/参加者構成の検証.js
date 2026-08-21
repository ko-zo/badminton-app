// 実際の練習会の顔ぶれで、組み合わせがどうなるかを確かめる。
//
// 人数や男女比が偏ると、希望どおりに組めないことがある。
// 例：男4・女6で8人が出る場合、男女ペアを4組作るには男が4人とも出る必要があるが、
//     出場者は試合数で決まるので、男が3人しか出ないラウンドが普通に起きる。
// そういう「構成そのものから来る限界」を、実際の app.js を動かして測る。
//
// 実行：node tools/参加者構成の検証.js
//
// ROSTER を書き換えれば、自分のクラブの顔ぶれで試せる。
// skill は「真の実力 0〜100」で、本人にもアプリにも見えない値。
// アプリにはこれを1〜5に丸めたレベルだけを渡し、結果は真の実力で採点する。

const ROSTER = [
  { name: '男A', gender: 'M', skill: 90 },
  { name: '男B', gender: 'M', skill: 72 },
  { name: '男C', gender: 'M', skill: 55 },
  { name: '男D', gender: 'M', skill: 35 },
  { name: '女A', gender: 'F', skill: 78 },
  { name: '女B', gender: 'F', skill: 58 },
  { name: '女C', gender: 'F', skill: 50 },
  { name: '女D', gender: 'F', skill: 38 },
  { name: '女E', gender: 'F', skill: 30 },
  { name: '女F', gender: 'F', skill: 15 },
];

const COURT_CASES = [1, 2];
const ROUNDS = 20;
const TRIALS = 200;

// ============================================================
const fs = require('fs'), path = require('path'), vm = require('vm');
const noop = () => {};
const stubEl = new Proxy({}, { get: (t, k) => {
  if (k === 'classList') return { add: noop, remove: noop, toggle: noop };
  if (k === 'dataset' || k === 'style') return {};
  if (k === 'appendChild' || k === 'setAttribute' || k === 'addEventListener') return noop;
  if (k === 'hidden' || k === 'disabled' || k === 'checked') return false;
  if (k === 'textContent' || k === 'innerHTML' || k === 'className') return '';
  return undefined;
}, set: () => true });

const store = new Map();
const sandbox = {
  console, Math, Date, JSON, Number, Object, Array, String, Set, Map, Infinity,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  document: { getElementById: () => stubEl, querySelector: () => stubEl, querySelectorAll: () => [], createElement: () => stubEl, addEventListener: noop, readyState: 'loading' },
  window: { addEventListener: noop, scrollTo: noop },
  navigator: { serviceWorker: null },
  URL: { createObjectURL: () => '', revokeObjectURL: noop }, Blob: function () {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
const run = src => vm.runInContext(src, sandbox);

const toLevel = s => (s < 20 ? 1 : s < 40 ? 2 : s < 60 ? 3 : s < 80 ? 4 : 5);
const skillOf = {};
ROSTER.forEach((r, i) => { skillOf['p' + i] = r.skill; });

function play(courts, gender, level, rounds) {
  sandbox.__in = {
    members: ROSTER.map((r, i) => ({
      id: 'p' + i, name: r.name, active: true, rest: false,
      gender: r.gender, level: toLevel(r.skill),
    })),
    courtTypes: Array(courts).fill('doubles'),
    gender, level,
  };
  run(`members = __in.members; courtTypes = __in.courtTypes;
       genderPreference = __in.gender; levelPreference = __in.level;
       sessions = []; pendingRound = null;`);
  sandbox.__n = rounds;
  return run(`(() => {
    const t = todayKey(); const out = [];
    for (let i = 0; i < __n; i++) { const r = generateMatches(); commitRoundToDate(t, r); out.push(r); }
    return out;
  })()`);
}

function measure(log) {
  let mixed = 0, pairs = 0, sideDiff = 0, courtRange = 0, n = 0;
  const pairCount = {}, matches = {};
  const sk = x => skillOf[x.id];

  log.forEach(round => round.courts.forEach(c => {
    const p1 = c.pair1, p2 = c.pair2;
    pairs += 2;
    [p1, p2].forEach(p => {
      if (p[0].gender !== p[1].gender) mixed++;
      const k = [p[0].id, p[1].id].sort().join('|');
      pairCount[k] = (pairCount[k] || 0) + 1;
    });
    sideDiff += Math.abs((sk(p1[0]) + sk(p1[1])) - (sk(p2[0]) + sk(p2[1]))) / 2;
    const all = [...p1, ...p2].map(sk);
    courtRange += Math.max(...all) - Math.min(...all);
    n++;
    [...p1, ...p2].forEach(m => { matches[m.id] = (matches[m.id] || 0) + 1; });
  }));

  ROSTER.forEach((_, i) => { matches['p' + i] = matches['p' + i] || 0; });
  const cnts = Object.values(matches), reps = Object.values(pairCount);

  return {
    mixedRate: (mixed / pairs) * 100,
    sideDiff: sideDiff / n,
    courtRange: courtRange / n,
    distinctPairs: reps.length,
    maxPairRepeat: Math.max(...reps),
    fairGap: Math.max(...cnts) - Math.min(...cnts),
    minMatches: Math.min(...cnts),
    maxMatches: Math.max(...cnts),
  };
}

function average(courts, gender, level) {
  const acc = {};
  for (let t = 0; t < TRIALS; t++) {
    const m = measure(play(courts, gender, level, ROUNDS));
    for (const k in m) acc[k] = (acc[k] || 0) + m[k];
  }
  const o = {}; for (const k in acc) o[k] = acc[k] / TRIALS; return o;
}

// ============================================================
const men = ROSTER.filter(r => r.gender === 'M').length;
const women = ROSTER.length - men;
const f = (x, d = 1) => x.toFixed(d).padStart(6);
const possiblePairs = (ROSTER.length * (ROSTER.length - 1)) / 2;

console.log(`\n参加者 ${ROSTER.length}人（男${men}・女${women}）／ ${ROUNDS}ラウンド × ${TRIALS}回の平均`);
console.log('レベル内訳：' + [5, 4, 3, 2, 1].map(l => `Lv${l}が${ROSTER.filter(r => toLevel(r.skill) === l).length}人`).join('、'));

COURT_CASES.forEach(courts => {
  const slots = courts * 4;
  const waiting = ROSTER.length - slots;
  console.log(`\n■ ${courts}コート（毎回 ${slots}人が出場・${waiting}人が待機）`);
  console.log('  ' + '希望'.padEnd(24) + '男女ペア  対戦差  コート幅 ペア種類 最多再結成 試合数');
  console.log('  ' + '-'.repeat(82));

  [['random', 'random', '指定なし × 指定なし'],
   ['mixed', 'random', '男女ペア × 指定なし'],
   ['random', 'balanced', '指定なし × バランス型'],
   ['random', 'same-level', '指定なし × 同レベル'],
   ['mixed', 'balanced', '男女ペア × バランス型'],
   ['mixed', 'same-level', '男女ペア × 同レベル']].forEach(([g, l, label]) => {
    const r = average(courts, g, l);
    console.log('  ' + label.padEnd(22) + f(r.mixedRate) + '%' + f(r.sideDiff) + '  ' + f(r.courtRange) +
      '  ' + f(r.distinctPairs) + '  ' + f(r.maxPairRepeat) +
      ('  ' + r.minMatches.toFixed(1) + '〜' + r.maxMatches.toFixed(1)).padStart(12));
  });
});

console.log(`\n※ 男女ペア＝ペアが男女だった割合　※ 対戦差＝対戦する2ペアの実力平均の差（小さいほど五分）`);
console.log(`※ コート幅＝コート内の最強と最弱の実力差　※ ペア種類＝成立した異なるペアの数（全${possiblePairs}通り）`);
console.log(`※ 試合数＝${ROUNDS}ラウンド後の最少〜最多。差が小さいほど公平`);

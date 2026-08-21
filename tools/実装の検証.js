// 実装した app.js の組み合わせロジックを、そのまま読み込んで検証する。
//
// シミュレーター（組み合わせ検証.js / 基準の干渉検証.js）は「こう作れば効くはず」を
// 確かめるためのもので、app.js とは別に書いたコードだった。こちらは app.js の実物を
// 動かして、シミュレーションと同じ数字が出るかを見る。食い違えば実装がどこかで違う。
//
// 実行：node tools/実装の検証.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- app.js をブラウザのふりをして読み込む ----
const noop = () => {};
const stubEl = new Proxy({}, {
  get: (t, k) => {
    if (k === 'classList') return { add: noop, remove: noop, toggle: noop };
    if (k === 'dataset' || k === 'style') return {};
    if (k === 'appendChild' || k === 'setAttribute' || k === 'addEventListener') return noop;
    if (k === 'hidden' || k === 'disabled' || k === 'checked') return false;
    if (k === 'textContent' || k === 'innerHTML' || k === 'className') return '';
    return undefined;
  },
  set: () => true,
});

const store = new Map();
const sandbox = {
  console, Math, Date, JSON, Number, Object, Array, String, Set, Map, Infinity,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  },
  document: {
    getElementById: () => stubEl,
    querySelector: () => stubEl,
    querySelectorAll: () => [],
    createElement: () => stubEl,
    addEventListener: noop,
    readyState: 'loading',
  },
  window: { addEventListener: noop, scrollTo: noop },
  navigator: { serviceWorker: null },
  URL: { createObjectURL: () => '', revokeObjectURL: noop },
  Blob: function () {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });

// app.js の状態は let 宣言なので、sandbox のプロパティからは触れない。
// 同じコンテキストでコードを走らせて読み書きする。
const run = src => vm.runInContext(src, sandbox);

// ---- 検証用の参加者（真の実力は本人にも見えない値） ----
const ROSTER = [
  { g: 'M', s: 92 }, { g: 'F', s: 85 }, { g: 'M', s: 78 }, { g: 'F', s: 70 },
  { g: 'M', s: 62 }, { g: 'F', s: 55 }, { g: 'M', s: 48 }, { g: 'F', s: 40 },
  { g: 'M', s: 33 }, { g: 'F', s: 25 }, { g: 'M', s: 18 }, { g: 'F', s: 10 },
];
const toLevel = s => (s < 20 ? 1 : s < 40 ? 2 : s < 60 ? 3 : s < 80 ? 4 : 5);
const skillOf = {};

function setup({ courts, gender, level, withLevels = true, count = 12 }) {
  sandbox.__in = {
    members: ROSTER.slice(0, count).map((r, i) => {
      skillOf['p' + i] = r.s;
      return {
        id: 'p' + i, name: 'P' + i, active: true, rest: false,
        gender: r.g, level: withLevels ? toLevel(r.s) : null,
      };
    }),
    courtTypes: Array(courts).fill('doubles'),
    gender, level,
  };
  run(`members = __in.members;
       courtTypes = __in.courtTypes;
       genderPreference = __in.gender;
       levelPreference  = __in.level;
       sessions = [];
       pendingRound = null;`);
}

// 確定と同じ経路でラウンドを記録する（実装の commitRoundToDate をそのまま使う）
function playRounds(rounds) {
  return run(`(() => {
    const today = todayKey();
    const log = [];
    for (let i = 0; i < ${rounds}; i++) {
      const round = generateMatches();
      commitRoundToDate(today, round);
      log.push(round);
    }
    return log;
  })()`);
}

function measure(log) {
  let sideDiff = 0, courtRange = 0, n = 0, mixed = 0, pairs = 0;
  const pairCount = {}, matches = {};
  const sk = x => skillOf[x.id];

  log.forEach(round => round.courts.forEach(c => {
    const p1 = c.pair1, p2 = c.pair2;
    sideDiff += Math.abs((sk(p1[0]) + sk(p1[1])) - (sk(p2[0]) + sk(p2[1]))) / 2;
    const all = [...p1, ...p2].map(sk);
    courtRange += Math.max(...all) - Math.min(...all);
    n++;
    [p1, p2].forEach(p => {
      pairs++;
      if (p[0].gender !== p[1].gender) mixed++;
      const k = [p[0].id, p[1].id].sort().join('|');
      pairCount[k] = (pairCount[k] || 0) + 1;
    });
    [...p1, ...p2].forEach(m => { matches[m.id] = (matches[m.id] || 0) + 1; });
  }));

  sandbox.__in.members.forEach(m => { matches[m.id] = matches[m.id] || 0; });
  const cnts = Object.values(matches), reps = Object.values(pairCount);

  return {
    sideDiff: sideDiff / n,
    courtRange: courtRange / n,
    mixedRate: (mixed / pairs) * 100,
    distinctPairs: reps.length,
    maxPairRepeat: Math.max(...reps),
    fairGap: Math.max(...cnts) - Math.min(...cnts),
  };
}

function average(cfg, rounds, trials = 100) {
  const acc = {};
  for (let t = 0; t < trials; t++) {
    setup(cfg);
    const m = measure(playRounds(rounds));
    for (const k in m) acc[k] = (acc[k] || 0) + m[k];
  }
  const out = {};
  for (const k in acc) out[k] = acc[k] / trials;
  return out;
}

// ============================================================
const f = (x, d = 1) => x.toFixed(d).padStart(6);
const results = [];
const assert = (name, pass) => results.push([name, pass]);

function check(label, cfg, rounds, expectations) {
  const r = average(cfg, rounds);
  console.log(
    label.padEnd(30) + f(r.mixedRate) + '%' + f(r.sideDiff) + '  ' + f(r.courtRange) +
    '  ' + f(r.distinctPairs) + '  ' + f(r.maxPairRepeat) + '  ' + f(r.fairGap, 2)
  );
  expectations.forEach(([name, ok]) => assert(`${label} / ${name}`, ok(r)));
  return r;
}

console.log('\n実装した app.js を直接動かした結果（12人・男6女6・20ラウンド・100回平均）');
console.log(''.padEnd(30) + '男女ペア  対戦差  コート幅 ペア種類 最多再結成 試合数差');
console.log('-'.repeat(88));

const R = 20;
check('指定なし × 指定なし (2面)', { courts: 2, gender: 'random', level: 'random' }, R, [
  ['公平性 0〜1', r => r.fairGap <= 1],
  ['ペア種類 60以上', r => r.distinctPairs >= 60],
]);
check('指定なし × バランス型 (2面)', { courts: 2, gender: 'random', level: 'balanced' }, R, [
  ['対戦差が半分以下', r => r.sideDiff < 11],
  ['ペア種類 50以上', r => r.distinctPairs >= 50],
  ['公平性 0〜1', r => r.fairGap <= 1],
]);
check('指定なし × 同レベル (2面)', { courts: 2, gender: 'random', level: 'same-level' }, R, [
  ['コート幅が大幅に縮む', r => r.courtRange < 42],
  ['公平性 0〜1', r => r.fairGap <= 1],
]);
check('男女ペア × 指定なし (2面)', { courts: 2, gender: 'mixed', level: 'random' }, R, [
  ['男女ペア率 80%以上', r => r.mixedRate >= 80],
]);
check('男女ペア × バランス型 (2面)', { courts: 2, gender: 'mixed', level: 'balanced' }, R, [
  ['男女ペア率 80%以上（併用しても落ちない）', r => r.mixedRate >= 80],
  ['対戦差が単独時と同水準', r => r.sideDiff < 11],
]);
check('男女ペア × 同レベル (2面)', { courts: 2, gender: 'mixed', level: 'same-level' }, R, [
  ['男女ペア率 80%以上', r => r.mixedRate >= 80],
  ['コート幅が大幅に縮む', r => r.courtRange < 42],
]);
check('指定なし × 同レベル (3面)', { courts: 3, gender: 'random', level: 'same-level' }, R, [
  ['3面でもコート幅が縮む（種が効いている）', r => r.courtRange < 32],
  ['ペアが固定されていない', r => r.maxPairRepeat <= 8],
  ['公平性 0', r => r.fairGap === 0],
]);
check('指定なし × バランス型 (3面)', { courts: 3, gender: 'random', level: 'balanced' }, R, [
  ['対戦差が半分以下', r => r.sideDiff < 11],
  ['公平性 0', r => r.fairGap === 0],
]);
const noLv = check('レベル全員未設定 × バランス型', { courts: 2, gender: 'random', level: 'balanced', withLevels: false }, R, [
  ['指定なしと同じ振る舞い（ペア種類60以上）', r => r.distinctPairs >= 60],
  ['公平性 0〜1', r => r.fairGap <= 1],
]);
assert('レベル全員未設定なら対戦差もランダム並み', noLv.sideDiff > 15);

// ---- 途中参加・休憩明けの扱い ----
// 素の試合数で並べると、途中から参加した人がずっと「最少」のままになり、
// 追いつくまで連続で出場してしまう。以前の実装で実際に起きていた回帰。
function joinScenario({ people, courts, before, after, restId = null, restRounds = 0 }) {
  const ids = 'ABCDEFGHIJKL'.slice(0, people).split('');
  sandbox.__in = {
    members: ids.map(n => ({ id: n, name: n, active: true, rest: false, gender: null, level: null }))
      .concat([{ id: 'Z', name: 'Z', active: false, rest: false, gender: null, level: null }]),
    courtTypes: Array(courts).fill('doubles'),
  };
  run(`members = __in.members; courtTypes = __in.courtTypes;
       genderPreference = 'random'; levelPreference = 'random';
       sessions = []; pendingRound = null;`);

  const play = n => {
    sandbox.__n = n;
    return run(`(() => {
      const t = todayKey(); const out = [];
      for (let i = 0; i < __n; i++) {
        const r = generateMatches();
        commitRoundToDate(t, r);
        out.push(playersInRound(serializeRound(r)).join(''));
      }
      return out;
    })()`);
  };

  const setFlag = (id, key, val) => {
    sandbox.__f = { id, key, val };
    run('members.find(m => m.id === __f.id)[__f.key] = __f.val;');
  };

  play(before);

  let watch, pool;
  if (restId) {
    setFlag(restId, 'rest', true);
    play(restRounds);
    setFlag(restId, 'rest', false);
    watch = restId;
    pool = people;              // Z は参加しないまま
  } else {
    setFlag('Z', 'active', true);
    watch = 'Z';
    pool = people + 1;
  }

  const rounds = play(after);
  let max = 0, cur = 0;
  rounds.forEach(r => { if (r.includes(watch)) { cur++; max = Math.max(max, cur); } else cur = 0; });

  return {
    played: rounds.filter(r => r.includes(watch)).length,
    streak: max,
    share: (after * courts * 4) / pool,
  };
}

console.log('\n途中から参加した人・休憩明けの人がコートを独占しないか');
console.log('-'.repeat(88));
[
  ['8人1コート：10R後に参加',  { people: 8,  courts: 1, before: 10, after: 10 }],
  ['12人2コート：10R後に参加', { people: 12, courts: 2, before: 10, after: 10 }],
  ['12人2コート：15R後に参加', { people: 12, courts: 2, before: 15, after: 15 }],
  ['12人2コート：8R休憩して復帰', { people: 12, courts: 2, before: 5, after: 10, restId: 'A', restRounds: 8 }],
].forEach(([label, cfg]) => {
  const r = joinScenario(cfg);
  const okShare  = Math.abs(r.played - r.share) <= Math.max(2, r.share * 0.4);
  const okStreak = r.streak <= 3;
  console.log(`  ${label.padEnd(26)} 出場 ${String(r.played).padStart(2)}回（取り分 ${r.share.toFixed(1)}回） 連続 ${r.streak}回  ${okShare && okStreak ? 'OK' : 'NG'}`);
  assert(`${label} / 取り分どおりに出場する`, okShare);
  assert(`${label} / 連続出場しない（独占しない）`, okStreak);
});

// ---- 古い設定からの移行 ----
console.log('\n古い設定からの移行');
console.log('-'.repeat(88));
[
  ['mixed', 'mixed', 'random'],
  ['same-gender', 'random', 'random'],
  ['random', 'random', 'random'],
  ['こわれた値', 'random', 'random'],
].forEach(([old, expG, expL]) => {
  store.clear();
  store.set('badminton_v1_settings', JSON.stringify({ courtTypes: ['doubles'], matchPreference: old }));
  run("genderPreference = 'random'; levelPreference = 'random'; loadState();");
  const g = run('genderPreference'), l = run('levelPreference');
  const ok = g === expG && l === expL;
  console.log(`  ${String(old).padEnd(14)} → 性別:${String(g).padEnd(7)} 実力:${String(l).padEnd(11)} ${ok ? 'OK' : 'NG'}`);
  assert(`移行 ${old}`, ok);
});

// 新しい形式で保存し直せているか
store.clear();
store.set('badminton_v1_settings', JSON.stringify({ courtTypes: ['doubles'], matchPreference: 'mixed' }));
run('loadState(); saveSettings();');
const saved = JSON.parse(store.get('badminton_v1_settings'));
console.log(`  保存し直した内容 → ${JSON.stringify(saved)}`);
assert('保存が新形式（genderPreference / levelPreference）', saved.genderPreference === 'mixed' && saved.levelPreference === 'random' && saved.matchPreference === undefined);

// ---- レベルの値の検証 ----
console.log('\n読み込み時のレベル検証（1〜5の整数以外は未設定へ）');
console.log('-'.repeat(88));
[[3, 3], [1, 1], [5, 5], [0, null], [6, null], ['3', null], [2.5, null], [-1, null], [undefined, null], [null, null]]
  .forEach(([input, expected]) => {
    store.clear();
    store.set('badminton_v1_members', JSON.stringify([{ id: 'x', name: 'A', level: input }]));
    run('loadState();');
    const got = run('members[0].level');
    const ok = got === expected;
    console.log(`  ${JSON.stringify(input) === undefined ? 'undefined' : String(JSON.stringify(input)).padEnd(11)} → ${String(got).padEnd(6)} ${ok ? 'OK' : 'NG'}`);
    assert(`レベル検証 ${JSON.stringify(input)}`, ok);
  });

// level を持たない旧メンバー（キーそのものが無い）
store.clear();
store.set('badminton_v1_members', JSON.stringify([{ id: 'y', name: 'B', gender: 'M', active: true, rest: false }]));
run('loadState();');
const legacy = run('members[0].level');
console.log(`  キー無し（旧メンバー）  → ${String(legacy).padEnd(6)} ${legacy === null ? 'OK' : 'NG'}`);
assert('level キーを持たない旧メンバーが null になる', legacy === null);

// ---- 未設定は3として扱われるか ----
sandbox.__x = [{ level: null }, { level: 3 }, { level: undefined }, { level: 1 }];
const lvOut = run('__x.map(levelOf)');
console.log(`\n未設定の扱い： [null, 3, undefined, 1] → [${lvOut.join(', ')}]`);
assert('未設定は3として計算される', lvOut[0] === 3 && lvOut[2] === 3 && lvOut[1] === 3 && lvOut[3] === 1);

// ============================================================
console.log('\n判定');
console.log('-'.repeat(88));
const ng = results.filter(([, pass]) => !pass);
ng.forEach(([name]) => console.log(`  NG  ${name}`));
console.log(ng.length === 0 ? `  すべて合格（${results.length}項目）` : `  ${ng.length} / ${results.length} 件が不合格`);
process.exit(ng.length === 0 ? 0 : 1);

// 基準どうしの干渉を測る：性別の希望（3通り）× レベルの希望（3通り）＝ 9通り
// 「5択にして1つだけ選ぶ」ことで、実際どれだけ損をしているのかを数値で出す。

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = Math.random;
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 12人：男女6人ずつ。実力と性別が偏らないよう交互に配置
const ROSTER = [
  { g: 'M', s: 92 }, { g: 'F', s: 85 }, { g: 'M', s: 78 }, { g: 'F', s: 70 },
  { g: 'M', s: 62 }, { g: 'F', s: 55 }, { g: 'M', s: 48 }, { g: 'F', s: 40 },
  { g: 'M', s: 33 }, { g: 'F', s: 25 }, { g: 'M', s: 18 }, { g: 'F', s: 10 },
];
const toLevel = s => (s < 20 ? 1 : s < 40 ? 2 : s < 60 ? 3 : s < 80 ? 4 : 5);
const makeMembers = () => ROSTER.map((r, i) => ({ id: 'p' + i, gender: r.g, skill: r.s, level: toLevel(r.s) }));

const W_PAIR = 3, W_OPP = 1;
const W_GENDER = 100, W_LV_SIDE = 100, W_LV_SPREAD = 10, W_LV_SAME = 100;
const FIRST_PAIR_HIT = 30;   // 未組みペア優先（第3版 3.9）

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const pairCost = c => (c === 0 ? 0 : FIRST_PAIR_HIT + (c - 1) * W_PAIR);

// --- 性別の減点（既存 app.js と同じ判定） ---
function genderPenalty(pref, side1, side2) {
  if (pref === 'mixed') {
    let p = 0;
    [side1, side2].forEach(side => {
      if (side.length === 2 && side[0].gender === side[1].gender) p += W_GENDER;
    });
    return p;
  }
  if (pref === 'same-gender') {
    const gs = [...side1, ...side2].map(m => m.gender);
    return gs.includes('M') && gs.includes('F') ? W_GENDER : 0;
  }
  return 0;
}

// --- レベルの減点（要件定義 3.4 / 3.5） ---
function levelPenalty(pref, side1, side2) {
  if (pref === 'same-level') {
    const all = [...side1, ...side2].map(m => m.level);
    return (Math.max(...all) - Math.min(...all)) * W_LV_SAME;
  }
  if (pref === 'balanced') {
    const s1 = side1.reduce((t, m) => t + m.level, 0);
    const s2 = side2.reduce((t, m) => t + m.level, 0);
    let sc = Math.abs(s1 - s2) * W_LV_SIDE;
    [side1, side2].forEach(side => {
      if (side.length === 2) sc += (4 - Math.abs(side[0].level - side[1].level)) * W_LV_SPREAD;
    });
    return sc;
  }
  return 0;
}

function score(players, hist, courts, gPref, lPref) {
  let sc = 0;
  for (let c = 0; c < courts; c++) {
    const [a, b, x, y] = players.slice(c * 4, c * 4 + 4);
    sc += pairCost(hist.pair[pairKey(a.id, b.id)] || 0);
    sc += pairCost(hist.pair[pairKey(x.id, y.id)] || 0);
    [[a, x], [a, y], [b, x], [b, y]].forEach(([p, q]) => { sc += (hist.opp[pairKey(p.id, q.id)] || 0) * W_OPP; });
    sc += genderPenalty(gPref, [a, b], [x, y]);   // 性別とレベルは足し算で分離（要件定義 4.4）
    sc += levelPenalty(lPref, [a, b], [x, y]);
  }
  return sc;
}

function seeds(playing, lPref, courts, n) {
  if (lPref !== 'same-level') return [];
  const out = [];
  for (let k = 0; k < n; k++) {
    const sorted = shuffle(playing).sort((a, b) => b.level - a.level);
    const arr = [];
    for (let c = 0; c < courts; c++) arr.push(...shuffle(sorted.slice(c * 4, c * 4 + 4)));
    arr.push(...sorted.slice(courts * 4));
    out.push(arr);
  }
  return out;
}

function runSession(gPref, lPref, courts, rounds) {
  const members = makeMembers();
  const need = courts * 4;
  const counts = {}, pair = {}, opp = {};
  members.forEach(m => { counts[m.id] = 0; });
  const log = [];

  for (let r = 0; r < rounds; r++) {
    const playing = shuffle(members).sort((a, b) => counts[a.id] - counts[b.id]).slice(0, need);
    const cands = seeds(playing, lPref, courts, 30);
    for (let i = 0; i < 200; i++) cands.push(shuffle(playing));

    let best = playing, bestScore = Infinity;
    for (const c of cands) {
      const s = score(c, { pair, opp }, courts, gPref, lPref);
      if (s < bestScore) { bestScore = s; best = c; if (s === 0) break; }
    }

    const rc = [];
    for (let c = 0; c < courts; c++) {
      const s = best.slice(c * 4, c * 4 + 4);
      rc.push({ p1: [s[0], s[1]], p2: [s[2], s[3]] });
    }
    rc.forEach(({ p1, p2 }) => {
      pair[pairKey(p1[0].id, p1[1].id)] = (pair[pairKey(p1[0].id, p1[1].id)] || 0) + 1;
      pair[pairKey(p2[0].id, p2[1].id)] = (pair[pairKey(p2[0].id, p2[1].id)] || 0) + 1;
      p1.forEach(x => p2.forEach(y => { opp[pairKey(x.id, y.id)] = (opp[pairKey(x.id, y.id)] || 0) + 1; }));
      [...p1, ...p2].forEach(m => { counts[m.id]++; });
    });
    log.push(rc);
  }
  return { members, counts, pair, log };
}

function measure(res) {
  let mixedPairs = 0, pairs = 0, sameCourts = 0, courtsN = 0;
  let sideDiff = 0, courtRange = 0;

  res.log.forEach(rc => rc.forEach(({ p1, p2 }) => {
    [p1, p2].forEach(p => { pairs++; if (p[0].gender !== p[1].gender) mixedPairs++; });
    const gs = [...p1, ...p2].map(m => m.gender);
    courtsN++;
    if (!(gs.includes('M') && gs.includes('F'))) sameCourts++;
    sideDiff += Math.abs((p1[0].skill + p1[1].skill) - (p2[0].skill + p2[1].skill)) / 2;
    const sk = [...p1, ...p2].map(m => m.skill);
    courtRange += Math.max(...sk) - Math.min(...sk);
  }));

  const pc = Object.values(res.pair), cn = Object.values(res.counts);
  return {
    mixedRate: (mixedPairs / pairs) * 100,
    sameCourtRate: (sameCourts / courtsN) * 100,
    sideDiff: sideDiff / courtsN,
    courtRange: courtRange / courtsN,
    distinctPairs: pc.length,
    fairGap: Math.max(...cn) - Math.min(...cn),
  };
}

function average(gPref, lPref, courts, rounds, trials = 300) {
  const acc = {};
  for (let t = 0; t < trials; t++) {
    rnd = mulberry32(5000 + t);
    const m = measure(runSession(gPref, lPref, courts, rounds));
    for (const k in m) acc[k] = (acc[k] || 0) + m[k];
  }
  const o = {}; for (const k in acc) o[k] = acc[k] / trials; return o;
}

const G = [['random', '指定なし'], ['mixed', '混合優先'], ['same-gender', '同性対戦']];
const L = [['random', '指定なし'], ['balanced', 'バランス型'], ['same-level', '同レベル']];

const f = (x, d = 1) => x.toFixed(d).padStart(6);

[[2, 20], [3, 20]].forEach(([courts, rounds]) => {
  console.log(`\n■ 12人（男6女6）・${courts}コート・${rounds}ラウンド ─ 性別の希望 × レベルの希望`);
  console.log('組み合わせ'.padEnd(26) + '男女ペア率 同性コート率  対戦差  コート幅 ペア種類 試合数差');
  console.log('-'.repeat(88));
  G.forEach(([g, gn]) => {
    L.forEach(([l, ln]) => {
      const r = average(g, l, courts, rounds);
      console.log(
        `${gn} × ${ln}`.padEnd(26) +
        f(r.mixedRate) + '%' + f(r.sameCourtRate) + '%  ' +
        f(r.sideDiff) + '  ' + f(r.courtRange) + '  ' + f(r.distinctPairs) + '  ' + f(r.fairGap, 2)
      );
    });
  });
});

console.log('\n※ 男女ペア率＝ペアが男女だった割合（混合優先の達成度。100%が理想）');
console.log('※ 同性コート率＝コート4人が同性だけだった割合（同性対戦の達成度。100%が理想）');
console.log('※ 対戦差＝対戦する2ペアの実力平均の差（バランス型の達成度。小さいほど良い）');
console.log('※ コート幅＝コート内の最強と最弱の実力差（同レベルの達成度。小さいほど良い）');
console.log('※ ペア種類＝その日に成立した異なるペアの数（全66通り）');

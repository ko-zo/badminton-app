// バドミントン組み合わせアルゴリズムのシミュレーター
// app.js の generateMatches / bestArrangement / scoreArrangement / getFairnessCounts を再現し、
// (1) レベル 1-5 と 1-3 の比較  (2) 未組みペア優先の効果  を数値で確かめる。

// ---------- 乱数（再現できるように種を固定） ----------
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
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 参加者（真の実力 0-100 は本人にも見えない前提の値） ----------
// A: きれいに散らばった club / B: 中位に固まった club（3段階で 4/4/4 に割れない）
const DISTS = {
  A: [92, 85, 78, 70, 62, 55, 48, 40, 33, 25, 18, 10],
  B: [95, 88, 72, 68, 60, 58, 55, 52, 45, 30, 22, 15],
};
let TRUE_SKILL = DISTS.A;

function toLevel(skill, steps) {
  if (steps === 5) return skill < 20 ? 1 : skill < 40 ? 2 : skill < 60 ? 3 : skill < 80 ? 4 : 5;
  return skill < 100 / 3 ? 1 : skill < 200 / 3 ? 2 : 3;
}

function makeMembers(steps, count) {
  const src = count ? TRUE_SKILL.filter((_, i) => i % 12 < count).slice(0, count) : TRUE_SKILL;
  return src.map((s, i) => ({
    id: 'p' + i, name: 'P' + i, skill: s,
    level: steps === 0 ? null : toLevel(s, steps),
  }));
}

// ---------- 重み（要件定義 第2版） ----------
const W_PAIR = 3;
const W_OPP = 1;
const W_LV_SIDE = 100;
const W_LV_SPREAD = 10;
const W_LV_SAME = 100;

const lv = (m, steps) => (m.level == null ? Math.ceil(steps / 2) : m.level);

function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

// ---------- 採点 ----------
function levelPenalty(mode, side1, side2, steps) {
  if (mode !== 'balanced' && mode !== 'same-level') return 0;
  const all = [...side1, ...side2].map(m => lv(m, steps));

  if (mode === 'same-level') {
    return (Math.max(...all) - Math.min(...all)) * W_LV_SAME;
  }
  // balanced
  const s1 = side1.reduce((t, m) => t + lv(m, steps), 0);
  const s2 = side2.reduce((t, m) => t + lv(m, steps), 0);
  let score = Math.abs(s1 - s2) * W_LV_SIDE;
  const maxSpread = steps - 1; // 5段階なら4、3段階なら2
  [side1, side2].forEach(side => {
    if (side.length === 2) {
      score += (maxSpread - Math.abs(lv(side[0], steps) - lv(side[1], steps))) * W_LV_SPREAD;
    }
  });
  return score;
}

// pairPolicy: 'linear'（現状 count*3） | 'unpaired'（初回同席に大きな減点）
function pairCost(count, policy, firstHit) {
  if (count === 0) return 0;
  if (policy === 'linear') return count * W_PAIR;
  return firstHit + (count - 1) * W_PAIR; // 1回でも組んでいたら firstHit、以降は加算
}

function scoreArrangement(players, history, courtTypes, mode, steps, policy, firstHit) {
  let score = 0, idx = 0;
  for (const type of courtTypes) {
    const needed = type === 'singles' ? 2 : 4;
    if (idx + needed > players.length) break;
    if (type === 'singles') {
      const [a, b] = players.slice(idx, idx + 2);
      score += (history.opp[pairKey(a.id, b.id)] || 0) * W_OPP;
      score += levelPenalty(mode, [a], [b], steps);
    } else {
      const [a, b, c, d] = players.slice(idx, idx + 4);
      score += pairCost(history.pair[pairKey(a.id, b.id)] || 0, policy, firstHit);
      score += pairCost(history.pair[pairKey(c.id, d.id)] || 0, policy, firstHit);
      [[a, c], [a, d], [b, c], [b, d]].forEach(([x, y]) => {
        score += (history.opp[pairKey(x.id, y.id)] || 0) * W_OPP;
      });
      score += levelPenalty(mode, [a, b], [c, d], steps);
    }
    idx += needed;
  }
  return score;
}

// ---------- 「種」候補（要件定義 3.6） ----------
function seedCandidates(playing, mode, steps, courtTypes, n) {
  if (mode !== 'balanced' && mode !== 'same-level') return [];
  const allDoubles = courtTypes.every(t => t === 'doubles');
  const out = [];

  for (let k = 0; k < n; k++) {
    // 同じレベルの人どうしの順序は毎回シャッフルしてから、レベル順に安定ソート
    const sorted = shuffle(playing).sort((a, b) => lv(b, steps) - lv(a, steps));

    if (mode === 'same-level') {
      // コート内の4人の並びをさらにシャッフルする。
      // 同レベルの採点（最大-最小）はこれで変わらないが、誰と誰がペアになるかは変わる。
      const arr = [];
      let idx = 0;
      for (const t of courtTypes) {
        const need = t === 'singles' ? 2 : 4;
        arr.push(...shuffle(sorted.slice(idx, idx + need)));
        idx += need;
      }
      arr.push(...sorted.slice(idx));
      out.push(arr);
    } else if (!allDoubles) {
      out.push(sorted);
    } else {
      // balanced: 両端から1人ずつ取ってペアを作る
      const arr = [];
      let i = 0, j = sorted.length - 1;
      while (i < j) { arr.push(sorted[i++], sorted[j--]); }
      if (i === j) arr.push(sorted[i]);
      out.push(arr);
    }
  }
  return out;
}

const ARRANGE_TRIES = 200;

function bestArrangement(playing, history, courtTypes, mode, steps, policy, firstHit, seeds) {
  if (playing.length === 0) return playing;
  let best = playing, bestScore = Infinity;

  const candidates = seedCandidates(playing, mode, steps, courtTypes, seeds);
  for (let i = 0; i < ARRANGE_TRIES; i++) candidates.push(shuffle(playing));

  for (const c of candidates) {
    const score = scoreArrangement(c, history, courtTypes, mode, steps, policy, firstHit);
    if (score < bestScore) { bestScore = score; best = c; if (score === 0) break; }
  }
  return best;
}

// ---------- 1セッション（1日）を回す ----------
function runSession({ steps, mode, courts, rounds, policy = 'linear', firstHit = W_PAIR, seeds = 30, dist = 'A', count = 0 }) {
  TRUE_SKILL = DISTS[dist];
  const members = makeMembers(steps, count);
  const courtTypes = Array(courts).fill('doubles');
  const need = courts * 4;

  const counts = {};            // 試合数
  const pair = {}, opp = {};    // その日の履歴
  members.forEach(m => { counts[m.id] = 0; });

  const log = [];

  for (let r = 0; r < rounds; r++) {
    // 誰が出るか：試合数の少ない順（同数はランダム）
    const ordered = shuffle(members).sort((a, b) => counts[a.id] - counts[b.id]);
    const playing = ordered.slice(0, need);

    const arranged = bestArrangement(playing, { pair, opp }, courtTypes, mode, steps, policy, firstHit, seeds);

    const roundCourts = [];
    for (let c = 0; c < courts; c++) {
      const s = arranged.slice(c * 4, c * 4 + 4);
      roundCourts.push({ p1: [s[0], s[1]], p2: [s[2], s[3]] });
    }

    roundCourts.forEach(({ p1, p2 }) => {
      pair[pairKey(p1[0].id, p1[1].id)] = (pair[pairKey(p1[0].id, p1[1].id)] || 0) + 1;
      pair[pairKey(p2[0].id, p2[1].id)] = (pair[pairKey(p2[0].id, p2[1].id)] || 0) + 1;
      p1.forEach(x => p2.forEach(y => { opp[pairKey(x.id, y.id)] = (opp[pairKey(x.id, y.id)] || 0) + 1; }));
      [...p1, ...p2].forEach(m => { counts[m.id]++; });
    });

    log.push(roundCourts);
  }

  return { members, counts, pair, opp, log };
}

// ---------- 指標 ----------
function measure(res) {
  let sideDiff = 0, courtRange = 0, pairSpread = 0, n = 0;

  res.log.forEach(rc => rc.forEach(({ p1, p2 }) => {
    const s1 = p1[0].skill + p1[1].skill;
    const s2 = p2[0].skill + p2[1].skill;
    sideDiff += Math.abs(s1 - s2) / 2;                       // 1人あたりに直した実力差
    const all = [...p1, ...p2].map(m => m.skill);
    courtRange += Math.max(...all) - Math.min(...all);
    pairSpread += (Math.abs(p1[0].skill - p1[1].skill) + Math.abs(p2[0].skill - p2[1].skill)) / 2;
    n++;
  }));

  const pairCounts = Object.values(res.pair);
  const cnts = Object.values(res.counts);

  const total = res.members.length;
  const possiblePairs = (total * (total - 1)) / 2;

  return {
    sideDiff: sideDiff / n,
    courtRange: courtRange / n,
    pairSpread: pairSpread / n,
    distinctPairs: pairCounts.length,
    possiblePairs,
    maxPairRepeat: Math.max(...pairCounts),
    pairings: pairCounts.reduce((a, b) => a + b, 0),
    fairGap: Math.max(...cnts) - Math.min(...cnts),
  };
}

function average(cfg, trials = 300) {
  const acc = {};
  for (let t = 0; t < trials; t++) {
    rnd = mulberry32(1000 + t);
    const m = measure(runSession(cfg));
    for (const k in m) acc[k] = (acc[k] || 0) + m[k];
  }
  const out = {};
  for (const k in acc) out[k] = acc[k] / trials;
  return out;
}

const f = (x, d = 1) => x.toFixed(d).padStart(6);

function row(label, r) {
  console.log(
    label.padEnd(30) +
    f(r.sideDiff) + '  ' + f(r.courtRange) + '  ' + f(r.pairSpread) + '  ' +
    f(r.distinctPairs) + '  ' + f(r.maxPairRepeat) + '  ' + f(r.fairGap, 2)
  );
}
function header(title) {
  console.log('\n' + title);
  console.log(''.padEnd(30) + '対戦差   コート幅  ペア内差  ペア種類  最多再結成  試合数差');
  console.log('-'.repeat(92));
}

// =========================================================
const BASE = { courts: 2, rounds: 20 };
const B3   = { courts: 3, rounds: 20 };

['A', 'B'].forEach(dist => {
  const label = dist === 'A' ? '実力が散らばったクラブ' : '中位に固まったクラブ';

  header(`【検証1】レベル 5段階 vs 3段階 ─ 12人・2コート・20ラウンド（${label}）`);
  row('レベルなし（ランダム）',    average({ ...BASE, dist, steps: 5, mode: 'random' }));
  row('バランス型・5段階',       average({ ...BASE, dist, steps: 5, mode: 'balanced' }));
  row('バランス型・3段階',       average({ ...BASE, dist, steps: 3, mode: 'balanced' }));
  row('同レベル・5段階',        average({ ...BASE, dist, steps: 5, mode: 'same-level' }));
  row('同レベル・3段階',        average({ ...BASE, dist, steps: 3, mode: 'same-level' }));

  header(`【検証1】同上 ─ 12人・3コート（全員出場）（${label}）`);
  row('レベルなし（ランダム）',    average({ ...B3, dist, steps: 5, mode: 'random' }));
  row('バランス型・5段階',       average({ ...B3, dist, steps: 5, mode: 'balanced' }));
  row('バランス型・3段階',       average({ ...B3, dist, steps: 3, mode: 'balanced' }));
  row('同レベル・5段階',        average({ ...B3, dist, steps: 5, mode: 'same-level' }));
  row('同レベル・3段階',        average({ ...B3, dist, steps: 3, mode: 'same-level' }));
});

header('【検証1-補】「種」は本当に要るか ─ 12人・3コート・実力が散らばったクラブ');
row('バランス型・種なし',        average({ ...B3, steps: 5, mode: 'balanced',   seeds: 0 }));
row('バランス型・種1本のみ',      average({ ...B3, steps: 5, mode: 'balanced',   seeds: 1 }));
row('バランス型・種30本',        average({ ...B3, steps: 5, mode: 'balanced',   seeds: 30 }));
row('同レベル・種なし',         average({ ...B3, steps: 5, mode: 'same-level', seeds: 0 }));
row('同レベル・種1本のみ',       average({ ...B3, steps: 5, mode: 'same-level', seeds: 1 }));
row('同レベル・種30本',         average({ ...B3, steps: 5, mode: 'same-level', seeds: 30 }));

// =========================================================
// 検証2：未組みペア優先
// =========================================================
const STRENGTHS = [['現状（count×3）', 3], ['初回30', 30], ['初回100', 100], ['初回300', 300]];

[['random', 'ランダム'], ['balanced', 'バランス型・5段階'], ['same-level', '同レベル・5段階']].forEach(([mode, name]) => {
  header(`【検証2】未組みペア優先の強さ × ${name} ─ 12人・2コート・20ラウンド`);
  STRENGTHS.forEach(([lab, fh]) => {
    row(lab, average({ ...BASE, steps: 5, mode, policy: fh === 3 ? 'linear' : 'unpaired', firstHit: fh }));
  });
});

[['balanced', 'バランス型'], ['random', 'ランダム']].forEach(([mode, name]) => {
  header(`【検証2-補】人数が少なく1日が長い ─ 8人・2コート・25ラウンド（全員出場）× ${name}`);
  STRENGTHS.forEach(([lab, fh]) => {
    row(lab, average({ courts: 2, rounds: 25, count: 8, steps: 5, mode, policy: fh === 3 ? 'linear' : 'unpaired', firstHit: fh }));
  });
});

console.log('\n※ 対戦差＝対戦する2ペアの実力平均の差（小さいほど五分）');
console.log('※ コート幅＝コート内の最強と最弱の実力差（同レベルでは小さいほど良い）');
console.log('※ ペア内差＝ペアを組んだ2人の実力差（バランス型では大きいほど狙いどおり）');
console.log('※ ペア種類＝その日に成立した異なるペアの数（12人＝全66通り／2コート20ラウンドでのべ80回組む）');
console.log('※ 最多再結成＝同じペアが最も多く組まれた回数');
console.log('※ 試合数差＝最多と最少の試合数の差（公平性。0が理想）');
console.log('※ すべて300セッションの平均。真の実力は 0-100 の連続値で、レベルはそれを段階に丸めたもの。');

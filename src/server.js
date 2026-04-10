const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Lịch sử cache ───────────────────────────────────────────────────────────
let historyCache = [];
const MAX_HISTORY = 200;

// ─── Fetch dữ liệu từ nguồn ──────────────────────────────────────────────────
async function fetchLatest(id = "https://luck8bot.com/api/GetNewLottery/TaixiuMd5?id=") {
  const url = ``;
  const res = await axios.get(url, { timeout: 8000 });
  return res.data;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseDice(raw) {
  try {
    const openCode = raw?.data?.OpenCode || "";
    if (openCode) return openCode.split(",").map((v) => parseInt(v.trim(), 10));
  } catch {}
  return [];
}

function parseTotal(dice) {
  return dice.reduce((s, v) => s + Number(v), 0);
}

function parsePienId(raw) {
  return raw?.data?.Expect || raw?.data?.ID || null;
}

function parseOpenTime(raw) {
  return raw?.data?.OpenTime || null;
}

function parseResult(dice) {
  const total = parseTotal(dice);
  if (total === 0) return null;
  return total >= 11 ? "T" : "X";
}

function resultLabel(code) {
  return code === "T" ? "Tài" : code === "X" ? "Xỉu" : null;
}

// ─── Cập nhật lịch sử ────────────────────────────────────────────────────────
function updateHistory(entry) {
  if (!entry.phien) return;
  const exists = historyCache.find((e) => e.phien === entry.phien);
  if (!exists) {
    historyCache.unshift(entry);
    if (historyCache.length > MAX_HISTORY) historyCache.pop();
  }
}

// ─── Pattern builder ─────────────────────────────────────────────────────────
function buildPattern(history, limit = 20) {
  return history
    .slice(0, limit)
    .map((e) => e.ketqua)
    .filter(Boolean)
    .reverse()
    .join("");
}

// ══════════════════════════════════════════════════════════════════════════════
//  THUẬT TOÁN CƠ BẢN (Nâng cấp)
// ══════════════════════════════════════════════════════════════════════════════

/** Cầu Bệt – theo streak hiện tại nhưng chống cầu quá dài */
function cauBet(history) {
  if (history.length < 2) return null;
  const last = history[0].ketqua;
  let streak = 1;
  for (let i = 1; i < history.length; i++) {
    if (history[i].ketqua === last) streak++;
    else break;
  }
  // Nếu streak quá dài (>= 6) → nghi ngờ sắp gãy → giảm weight
  const weight = streak >= 6 ? 0.4 : streak >= 4 ? 0.7 : 1.0;
  return { duDoan: last, loaiCau: `Cầu Bệt (${streak} phiên)`, streak, weight };
}

/** Cầu 1-1 xen kẽ */
function cau11(history) {
  if (history.length < 4) return null;
  const seq = history.slice(0, 4).map((e) => e.ketqua);
  const isAlternate = seq[0] !== seq[1] && seq[1] !== seq[2] && seq[2] !== seq[3];
  if (!isAlternate) return null;
  const next = seq[0] === "T" ? "X" : "T";
  return { duDoan: next, loaiCau: "Cầu 1-1 (Xen Kẽ)", weight: 1.0 };
}

/** Cầu 2-2 */
function cau22(history) {
  if (history.length < 4) return null;
  const seq = history.slice(0, 4).map((e) => e.ketqua);
  if (seq[0] === seq[1] && seq[2] === seq[3] && seq[0] !== seq[2]) {
    return { duDoan: seq[0], loaiCau: "Cầu 2-2", weight: 1.1 };
  }
  return null;
}

/** Cầu 3-3 */
function cau33(history) {
  if (history.length < 6) return null;
  const seq = history.slice(0, 6).map((e) => e.ketqua);
  if (
    seq[0] === seq[1] && seq[1] === seq[2] &&
    seq[3] === seq[4] && seq[4] === seq[5] &&
    seq[0] !== seq[3]
  ) {
    return { duDoan: seq[0], loaiCau: "Cầu 3-3", weight: 1.2 };
  }
  return null;
}

/** Cầu 1-2 */
function cau12(history) {
  if (history.length < 3) return null;
  const seq = history.slice(0, 3).map((e) => e.ketqua);
  if (seq[0] !== seq[1] && seq[1] === seq[2]) {
    return { duDoan: seq[1], loaiCau: "Cầu 1-2", weight: 0.9 };
  }
  return null;
}

/** Cầu 2-1 */
function cau21(history) {
  if (history.length < 3) return null;
  const seq = history.slice(0, 3).map((e) => e.ketqua);
  if (seq[0] === seq[1] && seq[1] !== seq[2]) {
    const next = seq[0] === "T" ? "X" : "T";
    return { duDoan: next, loaiCau: "Cầu 2-1", weight: 0.9 };
  }
  return null;
}

/** Thống kê 10 phiên */
function thongKe10(history) {
  const last10 = history.slice(0, 10);
  if (last10.length < 5) return null;
  const tai = last10.filter((e) => e.ketqua === "T").length;
  const xiu = last10.length - tai;
  const duDoan = tai > xiu ? "X" : "T"; // ngược lại để cân bằng
  const imbalance = Math.abs(tai - xiu) / last10.length;
  return {
    duDoan,
    loaiCau: `Thống Kê 10 Phiên (Tài:${tai} Xỉu:${xiu})`,
    tai, xiu,
    weight: 0.6 + imbalance * 0.8,
  };
}

/** Trung bình tổng xúc xắc */
function trungBinhTong(history) {
  const last5 = history.slice(0, 5).filter((e) => e.tong > 0);
  if (last5.length < 3) return null;
  const avg = last5.reduce((s, e) => s + e.tong, 0) / last5.length;
  const duDoan = avg >= 11 ? "T" : "X";
  return {
    duDoan,
    loaiCau: `Trung Bình Tổng (avg=${avg.toFixed(2)})`,
    avg: parseFloat(avg.toFixed(2)),
    weight: 0.7,
  };
}

/** Cầu Gãy */
function cauGay(history) {
  if (history.length < 5) return null;
  const last = history[0].ketqua;
  const prev = history[1].ketqua;
  if (last !== prev) {
    let oldStreak = 1;
    for (let i = 1; i < history.length - 1; i++) {
      if (history[i].ketqua === history[i + 1]?.ketqua) oldStreak++;
      else break;
    }
    if (oldStreak >= 3) {
      return {
        duDoan: last,
        loaiCau: `Cầu Gãy (streak cũ ${oldStreak}, theo chiều mới)`,
        oldStreak,
        weight: 1.0 + Math.min(oldStreak * 0.1, 0.4),
      };
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
//  THUẬT TOÁN NÂNG CAO MỚI
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Markov Chain – Tính xác suất chuyển trạng thái từ lịch sử
 * P(T|T), P(X|T), P(T|X), P(X|X)
 */
function markovChain(history) {
  if (history.length < 10) return null;

  const trans = { TT: 0, TX: 0, XT: 0, XX: 0 };
  for (let i = 0; i < history.length - 1; i++) {
    const cur = history[i].ketqua;
    const next = history[i + 1].ketqua;
    if (cur && next) {
      const key = cur + next;
      if (key in trans) trans[key]++;
    }
  }

  const last = history[0].ketqua;
  if (!last) return null;

  let pT, pX;
  if (last === "T") {
    const total = trans.TT + trans.TX || 1;
    pT = trans.TT / total;
    pX = trans.TX / total;
  } else {
    const total = trans.XT + trans.XX || 1;
    pT = trans.XT / total;
    pX = trans.XX / total;
  }

  const duDoan = pT >= pX ? "T" : "X";
  const confidence = Math.max(pT, pX);
  const weight = 0.5 + confidence * 1.0;

  return {
    duDoan,
    loaiCau: `Markov Chain (P(T)=${(pT * 100).toFixed(1)}% P(X)=${(pX * 100).toFixed(1)}%)`,
    pT: parseFloat(pT.toFixed(3)),
    pX: parseFloat(pX.toFixed(3)),
    trans,
    weight,
  };
}

/**
 * Pattern Matching – Tìm chuỗi N phiên giống nhất trong lịch sử
 * rồi xem phiên tiếp theo của chuỗi đó là gì
 */
function patternMatching(history, windowSize = 5) {
  if (history.length < windowSize * 2 + 1) return null;

  const recent = history.slice(0, windowSize).map((e) => e.ketqua).join("");
  let bestMatch = null;
  let bestScore = -1;

  for (let i = windowSize; i < history.length - 1; i++) {
    const candidate = history.slice(i, i + windowSize).map((e) => e.ketqua).join("");
    let score = 0;
    for (let j = 0; j < windowSize; j++) {
      if (recent[j] === candidate[j]) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        index: i,
        pattern: candidate,
        nextResult: history[i - 1]?.ketqua || null,
        score,
      };
    }
  }

  if (!bestMatch || !bestMatch.nextResult || bestMatch.score < Math.ceil(windowSize * 0.6)) {
    return null;
  }

  const confidence = bestMatch.score / windowSize;
  return {
    duDoan: bestMatch.nextResult,
    loaiCau: `Pattern Matching (khớp ${bestMatch.score}/${windowSize} phiên)`,
    matchScore: bestMatch.score,
    matchPattern: bestMatch.pattern,
    weight: 0.5 + confidence * 1.2,
  };
}

/**
 * Entropy & Momentum – Đo độ hỗn loạn chuỗi gần đây
 * Entropy cao → thị trường ngẫu nhiên → theo xu hướng gần nhất
 * Entropy thấp → cầu rõ ràng → tiếp tục hoặc gãy
 */
function entropyMomentum(history) {
  const n = Math.min(history.length, 20);
  if (n < 8) return null;

  const seq = history.slice(0, n).map((e) => e.ketqua).filter(Boolean);
  const tai = seq.filter((v) => v === "T").length;
  const xiu = seq.length - tai;
  const pT = tai / seq.length;
  const pX = xiu / seq.length;

  // Shannon entropy (0 = hoàn toàn dự đoán được, 1 = tối đa ngẫu nhiên)
  const eps = 1e-9;
  const entropy = -(pT * Math.log2(pT + eps) + pX * Math.log2(pX + eps));
  const normalizedEntropy = entropy; // max = 1 bit

  // Momentum: sum of recent changes (weighted by recency)
  let momentum = 0;
  for (let i = 0; i < Math.min(seq.length - 1, 8); i++) {
    const weight = Math.pow(0.8, i); // newer = heavier
    if (seq[i] !== seq[i + 1]) momentum -= weight; // change
    else momentum += weight; // continuation
  }

  let duDoan;
  if (normalizedEntropy < 0.7) {
    // Ít ngẫu nhiên → theo xu hướng momentum
    duDoan = momentum >= 0 ? seq[0] : (seq[0] === "T" ? "X" : "T");
  } else {
    // Rất ngẫu nhiên → dựa vào thống kê cân bằng
    duDoan = pT < pX ? "T" : "X"; // lấy mặt ít xuất hiện
  }

  return {
    duDoan,
    loaiCau: `Entropy & Momentum (H=${normalizedEntropy.toFixed(2)}, M=${momentum.toFixed(2)})`,
    entropy: parseFloat(normalizedEntropy.toFixed(3)),
    momentum: parseFloat(momentum.toFixed(3)),
    weight: 0.8 + (1 - normalizedEntropy) * 0.5,
  };
}

/**
 * Hot/Cold Dice – Phân tích mặt xúc xắc xuất hiện nhiều/ít
 * Dự đoán dựa trên "nhiệt độ" xúc xắc
 */
function hotColdDice(history) {
  const last20 = history.slice(0, 20).filter((e) => e.xucxac && e.xucxac.length > 0);
  if (last20.length < 8) return null;

  const freq = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let totalDice = 0;
  for (const entry of last20) {
    for (const face of entry.xucxac) {
      if (face >= 1 && face <= 6) { freq[face]++; totalDice++; }
    }
  }

  // Expected total based on hot dice probability
  let expectedTotal = 0;
  const baseProb = 1 / 6;
  for (let face = 1; face <= 6; face++) {
    const observedProb = freq[face] / (totalDice || 1);
    // Hot face → more likely to appear → weight toward it
    expectedTotal += face * (observedProb * 3); // 3 dice
  }

  const duDoan = expectedTotal >= 11 ? "T" : "X";
  const hotFaces = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([f]) => f);

  return {
    duDoan,
    loaiCau: `Hot/Cold Dice (hot: ${hotFaces.join(",")}, expTotal=${expectedTotal.toFixed(1)})`,
    hotFaces: hotFaces.map(Number),
    expectedTotal: parseFloat(expectedTotal.toFixed(2)),
    weight: 0.65,
  };
}

/**
 * Streak Momentum Nâng Cao – Phân tích cầu với decay
 * Cầu ngắn có trọng số cao, cầu dài giảm dần (gambler fallacy correction)
 */
function streakMomentumAdvanced(history) {
  if (history.length < 6) return null;

  const scores = { T: 0, X: 0 };

  for (let i = 0; i < Math.min(history.length - 1, 30); i++) {
    const cur = history[i].ketqua;
    if (!cur) continue;

    // Exponential decay: newer entries matter more
    const recencyWeight = Math.pow(0.85, i);

    // Streak at position i
    let streakLen = 1;
    for (let j = i + 1; j < history.length; j++) {
      if (history[j].ketqua === cur) streakLen++;
      else break;
    }

    // Optimal streak: 2-4 → high confidence, longer → mean reversion risk
    let streakMult;
    if (streakLen <= 1) streakMult = 0.8;
    else if (streakLen <= 3) streakMult = 1.2;
    else if (streakLen <= 5) streakMult = 0.9;
    else streakMult = 0.5; // very long streak → likely to break

    scores[cur] += recencyWeight * streakMult;
  }

  const duDoan = scores.T >= scores.X ? "T" : "X";
  const total = scores.T + scores.X || 1;
  const confidence = Math.max(scores.T, scores.X) / total;

  return {
    duDoan,
    loaiCau: `Streak Momentum (T=${scores.T.toFixed(2)}, X=${scores.X.toFixed(2)})`,
    scores: { T: parseFloat(scores.T.toFixed(3)), X: parseFloat(scores.X.toFixed(3)) },
    weight: 0.7 + confidence * 0.6,
  };
}

/**
 * Mean Reversion – Phát hiện độ lệch khỏi 50/50 và dự đoán hồi quy
 */
function meanReversion(history) {
  const n = Math.min(history.length, 30);
  if (n < 15) return null;

  const seq = history.slice(0, n).filter((e) => e.ketqua);
  const tai = seq.filter((e) => e.ketqua === "T").length;
  const pTai = tai / seq.length;
  const deviation = pTai - 0.5;

  // Only act if significant deviation
  if (Math.abs(deviation) < 0.1) return null;

  // Mean reversion: if too many Tài → predict Xỉu
  const duDoan = deviation > 0 ? "X" : "T";
  const strength = Math.min(Math.abs(deviation) * 2, 1);

  return {
    duDoan,
    loaiCau: `Mean Reversion (Tài ${(pTai * 100).toFixed(1)}%, lệch ${(deviation * 100).toFixed(1)}%)`,
    deviation: parseFloat(deviation.toFixed(3)),
    weight: 0.5 + strength * 0.7,
  };
}

/**
 * Sliding Window Accuracy – Theo dõi độ chính xác của từng thuật toán
 * và điều chỉnh trọng số tự động (Meta-learning)
 */
const algoAccuracy = {};
const ACCURACY_WINDOW = 30;

function updateAlgoAccuracy(algoName, predicted, actual) {
  if (!algoAccuracy[algoName]) {
    algoAccuracy[algoName] = { hits: 0, total: 0, recent: [] };
  }
  const acc = algoAccuracy[algoName];
  const correct = predicted === actual ? 1 : 0;
  acc.recent.push(correct);
  if (acc.recent.length > ACCURACY_WINDOW) acc.recent.shift();
  acc.hits = acc.recent.reduce((s, v) => s + v, 0);
  acc.total = acc.recent.length;
}

function getAlgoWeight(algoName, baseWeight) {
  const acc = algoAccuracy[algoName];
  if (!acc || acc.total < 5) return baseWeight;
  const accuracy = acc.hits / acc.total;
  // Scale: 40% accuracy → 0.5x weight, 60% → 1.5x weight
  const scale = 0.5 + (accuracy - 0.4) * 5;
  return baseWeight * Math.max(0.2, Math.min(2.0, scale));
}

// ══════════════════════════════════════════════════════════════════════════════
//  AI VOTING NÂNG CAO – Weighted Ensemble
// ══════════════════════════════════════════════════════════════════════════════

function aiVotingAdvanced(history) {
  const algos = [
    { name: "cauBet", fn: cauBet },
    { name: "cau11", fn: cau11 },
    { name: "cau22", fn: cau22 },
    { name: "cau33", fn: cau33 },
    { name: "cau12", fn: cau12 },
    { name: "cau21", fn: cau21 },
    { name: "thongKe10", fn: thongKe10 },
    { name: "trungBinhTong", fn: trungBinhTong },
    { name: "cauGay", fn: cauGay },
    { name: "markovChain", fn: markovChain },
    { name: "patternMatching", fn: patternMatching },
    { name: "entropyMomentum", fn: entropyMomentum },
    { name: "hotColdDice", fn: hotColdDice },
    { name: "streakMomentumAdvanced", fn: streakMomentumAdvanced },
    { name: "meanReversion", fn: meanReversion },
  ];

  const votes = { T: 0, X: 0 };
  const details = [];
  let totalWeight = 0;

  for (const { name, fn } of algos) {
    try {
      const r = fn(history);
      if (!r) continue;

      const baseWeight = r.weight || 1.0;
      const adjustedWeight = getAlgoWeight(name, baseWeight);

      votes[r.duDoan] += adjustedWeight;
      totalWeight += adjustedWeight;
      details.push({
        algo: r.loaiCau,
        vote: r.duDoan,
        weight: parseFloat(adjustedWeight.toFixed(3)),
        accuracy: algoAccuracy[name]
          ? `${((algoAccuracy[name].hits / algoAccuracy[name].total) * 100).toFixed(0)}%`
          : "N/A",
      });
    } catch {}
  }

  if (totalWeight === 0) return null;

  const duDoan = votes.T >= votes.X ? "T" : "X";
  const rawConfidence = Math.max(votes.T, votes.X) / totalWeight;

  // Calibrate confidence: avoid overconfidence
  // Raw 60% → ~55%, Raw 80% → ~70%
  const calibratedConfidence = 50 + (rawConfidence - 0.5) * 70;
  const confidence = Math.round(Math.max(51, Math.min(92, calibratedConfidence)));

  return {
    duDoan,
    loaiCau: "AI Ensemble (Weighted Voting)",
    votes: { T: parseFloat(votes.T.toFixed(3)), X: parseFloat(votes.X.toFixed(3)) },
    confidence,
    rawConfidence: parseFloat(rawConfidence.toFixed(3)),
    totalWeight: parseFloat(totalWeight.toFixed(3)),
    algoCount: details.length,
    details,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  PREDICT CHÍNH
// ══════════════════════════════════════════════════════════════════════════════

function predict(history) {
  if (history.length === 0) return null;

  const results = {};
  const advanced = [
    ["cauBet", cauBet],
    ["cau11", cau11],
    ["cau22", cau22],
    ["cau33", cau33],
    ["cau12", cau12],
    ["cau21", cau21],
    ["thongKe10", thongKe10],
    ["trungBinhTong", trungBinhTong],
    ["cauGay", cauGay],
    ["markovChain", markovChain],
    ["patternMatching", patternMatching],
    ["entropyMomentum", entropyMomentum],
    ["hotColdDice", hotColdDice],
    ["streakMomentumAdvanced", streakMomentumAdvanced],
    ["meanReversion", meanReversion],
  ];

  for (const [name, fn] of advanced) {
    try { results[name] = fn(history) || null; } catch { results[name] = null; }
  }

  try { results["aiVoting"] = aiVotingAdvanced(history); } catch { results["aiVoting"] = null; }

  const main = results.aiVoting || results.markovChain || results.cauBet || null;

  return { deXuat: main, tatCaThuat: results };
}

// ─── Track kết quả để cập nhật accuracy ──────────────────────────────────────
let lastPredictions = {}; // { phien: { algo: predicted } }

function recordPredictions(phien, tatCaThuat) {
  if (!phien) return;
  lastPredictions[phien] = {};
  for (const [name, r] of Object.entries(tatCaThuat)) {
    if (r) lastPredictions[phien][name] = r.duDoan;
  }
  // Clean old entries
  const keys = Object.keys(lastPredictions);
  if (keys.length > 50) delete lastPredictions[keys[0]];
}

function evaluatePredictions(phien, actual) {
  const preds = lastPredictions[phien];
  if (!preds || !actual) return;
  for (const [name, predicted] of Object.entries(preds)) {
    updateAlgoAccuracy(name, predicted, actual);
  }
  delete lastPredictions[phien];
}

// ─── Tính phiên tiếp theo ─────────────────────────────────────────────────────
function nextPhien(phien) {
  if (!phien) return null;
  const p = String(phien);
  const n = parseInt(p.slice(-4), 10);
  return p.slice(0, -4) + String(n + 1).padStart(4, "0");
}

// ══════════════════════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/taixiu?id=<id>&user=<@username>
app.get("/api/taixiu", async (req, res) => {
  try {
    const id = req.query.id || "";
    const userId = req.query.user || "@sewdangcap";

    const raw = await fetchLatest(id);
    const dice = parseDice(raw);
    const total = parseTotal(dice);
    const phien = parsePienId(raw);
    const ketquaCode = parseResult(dice);
    const openTime = parseOpenTime(raw);

    // Evaluate last phien's predictions before updating
    if (phien && ketquaCode) evaluatePredictions(phien, ketquaCode);

    const entry = { phien, ketqua: ketquaCode, tong: total, xucxac: dice, openTime };
    updateHistory(entry);

    const duDoan = predict(historyCache);
    const main = duDoan?.deXuat;
    const phienTiepTheo = nextPhien(phien);
    const pattern = buildPattern(historyCache, 20);

    // Record for next evaluation
    if (duDoan?.tatCaThuat && phienTiepTheo) {
      recordPredictions(phienTiepTheo, duDoan.tatCaThuat);
    }

    res.json({
      phien: phien,
      ketQua: resultLabel(ketquaCode),
      xucXac: dice,
      phienHienTai: phienTiepTheo,
      duDoan: main ? resultLabel(main.duDoan) : null,
      doTinCay: main ? `${main.confidence}%` : null,
      pattern: pattern,
      id: userId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/taixiu/history?limit=20
app.get("/api/taixiu/history", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const pattern = buildPattern(historyCache, limit);

  res.json({
    success: true,
    total: historyCache.length,
    pattern,
    data: historyCache.slice(0, limit).map((e) => ({
      phien: e.phien,
      ketQua: { code: e.ketqua, label: resultLabel(e.ketqua), tong: e.tong },
      xucXac: e.xucxac,
      openTime: e.openTime,
    })),
  });
});

// GET /api/taixiu/predict?user=<@username>
app.get("/api/taixiu/predict", (req, res) => {
  const userId = req.query.user || "@sewdangcap";

  if (historyCache.length < 2) {
    return res.json({ success: false, message: "Chưa đủ dữ liệu, hãy gọi /api/taixiu trước" });
  }

  const duDoan = predict(historyCache);
  const main = duDoan?.deXuat;
  const pattern = buildPattern(historyCache, 20);
  const phienTiepTheo = nextPhien(historyCache[0]?.phien);

  // Accuracy stats
  const accuracyStats = {};
  for (const [name, acc] of Object.entries(algoAccuracy)) {
    if (acc.total > 0) {
      accuracyStats[name] = {
        accuracy: `${((acc.hits / acc.total) * 100).toFixed(1)}%`,
        hits: acc.hits,
        total: acc.total,
      };
    }
  }

  res.json({
    id: userId,
    phienDuDoan: phienTiepTheo,
    soPhienPhanTich: historyCache.length,
    duDoan: main ? {
      ketQua: { code: main.duDoan, label: resultLabel(main.duDoan) },
      doTinCay: `${main.confidence}%`,
      cauHien: main.loaiCau,
      pattern,
      votes: main.votes,
      soThuatToan: main.algoCount,
      chiTiet: main.details,
    } : null,
    accuracyStats,
  });
});

// GET /api/taixiu/accuracy
app.get("/api/taixiu/accuracy", (req, res) => {
  const stats = {};
  for (const [name, acc] of Object.entries(algoAccuracy)) {
    stats[name] = {
      accuracy: acc.total > 0 ? parseFloat(((acc.hits / acc.total) * 100).toFixed(1)) : null,
      hits: acc.hits,
      total: acc.total,
    };
  }

  const sorted = Object.entries(stats)
    .filter(([, v]) => v.total >= 5)
    .sort((a, b) => (b[1].accuracy || 0) - (a[1].accuracy || 0));

  res.json({
    success: true,
    rankings: sorted.map(([name, data]) => ({ name, ...data })),
    raw: stats,
  });
});

// GET /api/taixiu/poll?interval=5&limit=50&user=<@username>
app.get("/api/taixiu/poll", async (req, res) => {
  const interval = Math.max(3, parseInt(req.query.interval) || 5) * 1000;
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const userId = req.query.user || "@sewdangcap";

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let count = 0;

  const tick = async () => {
    if (count >= limit || res.destroyed) { res.end(); return; }

    try {
      const raw = await fetchLatest("");
      const dice = parseDice(raw);
      const total = parseTotal(dice);
      const phien = parsePienId(raw);
      const ketquaCode = parseResult(dice);
      const openTime = parseOpenTime(raw);

      if (phien && ketquaCode) evaluatePredictions(phien, ketquaCode);

      const entry = { phien, ketqua: ketquaCode, tong: total, xucxac: dice, openTime };
      updateHistory(entry);

      const duDoan = predict(historyCache);
      const main = duDoan?.deXuat;
      const pattern = buildPattern(historyCache, 20);
      const phienTiepTheo = nextPhien(phien);

      if (duDoan?.tatCaThuat && phienTiepTheo) {
        recordPredictions(phienTiepTheo, duDoan.tatCaThuat);
      }

      const payload = {
        id: userId,
        tick: ++count,
        timestamp: new Date().toISOString(),
        phien,
        ketQua: { code: ketquaCode, label: resultLabel(ketquaCode), tong: total },
        xucXac: dice,
        phienTiepTheo,
        duDoan: main ? {
          phien: phienTiepTheo,
          ketQua: { code: main.duDoan, label: resultLabel(main.duDoan) },
          doTinCay: `${main.confidence}%`,
          cauHien: main.loaiCau,
          votes: main.votes,
          soThuatToan: main.algoCount,
          pattern,
        } : null,
      };

      res.write(JSON.stringify(payload) + "\n");
    } catch (err) {
      res.write(JSON.stringify({ error: err.message, tick: ++count }) + "\n");
    }

    if (count < limit && !res.destroyed) setTimeout(tick, interval);
    else res.end();
  };

  tick();
});

// GET /
app.get("/", (req, res) => {
  res.json({
    name: "Tài Xỉu Prediction API v2 – AI Ensemble",
    version: "2.0.0",
    algorithms: [
      "Cầu Bệt", "Cầu 1-1", "Cầu 2-2", "Cầu 3-3", "Cầu 1-2", "Cầu 2-1",
      "Thống Kê 10 Phiên", "Trung Bình Tổng", "Cầu Gãy",
      "Markov Chain", "Pattern Matching", "Entropy & Momentum",
      "Hot/Cold Dice", "Streak Momentum Advanced", "Mean Reversion",
      "AI Weighted Ensemble + Meta-learning Accuracy Tracker",
    ],
    endpoints: {
      "GET /api/taixiu?id=<id>&user=<@username>": "Lấy phiên mới + dự đoán AI Ensemble",
      "GET /api/taixiu/history?limit=20": "Xem lịch sử cache + pattern",
      "GET /api/taixiu/predict?user=<@username>": "Dự đoán chi tiết từ lịch sử",
      "GET /api/taixiu/accuracy": "Xếp hạng độ chính xác từng thuật toán",
      "GET /api/taixiu/poll?interval=5&limit=50&user=<@username>": "Stream liên tục (NDJSON)",
    },
  });
});

app.listen(PORT, () => {
  console.log(`✅ Tài Xỉu API v2 chạy tại http://localhost:${PORT}`);
});

const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Lịch sử cache ───────────────────────────────────────────────────────────
let historyCache = [];
const MAX_HISTORY = 100;

// ─── Fetch dữ liệu từ nguồn ──────────────────────────────────────────────────
async function fetchLatest(id = "") {
  const url = `https://luck8bot.com/api/GetNewLottery/TaixiuMd5?id=${id}`;
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
  return total >= 11 ? "T" : "X"; // T = Tài, X = Xỉu (dùng cho pattern)
}

function resultLabel(code) {
  return code === "T" ? "Tài" : code === "X" ? "Xỉu" : null;
}

// ─── Pattern builder ─────────────────────────────────────────────────────────
// Tạo chuỗi pattern từ lịch sử, ví dụ: "TXTTXT"
function buildPattern(history, limit = 20) {
  return history
    .slice(0, limit)
    .map((e) => e.ketqua)
    .filter(Boolean)
    .reverse() // cũ → mới
    .join("");
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

// ─── THUẬT TOÁN DỰ ĐOÁN ──────────────────────────────────────────────────────

function cauBet(history) {
  if (history.length < 2) return null;
  const last = history[0].ketqua;
  let streak = 1;
  for (let i = 1; i < history.length; i++) {
    if (history[i].ketqua === last) streak++;
    else break;
  }
  return { duDoan: last, loaiCau: `Cầu Bệt (${streak} phiên)`, streak };
}

function cau11(history) {
  if (history.length < 4) return null;
  const seq = history.slice(0, 4).map((e) => e.ketqua);
  const isAlternate =
    seq[0] !== seq[1] && seq[1] !== seq[2] && seq[2] !== seq[3];
  if (!isAlternate) return null;
  const next = seq[0] === "T" ? "X" : "T";
  return { duDoan: next, loaiCau: "Cầu 1-1 (Xen Kẽ)" };
}

function cau22(history) {
  if (history.length < 4) return null;
  const seq = history.slice(0, 4).map((e) => e.ketqua);
  if (seq[0] === seq[1] && seq[2] === seq[3] && seq[0] !== seq[2]) {
    return { duDoan: seq[0], loaiCau: "Cầu 2-2" };
  }
  return null;
}

function cau33(history) {
  if (history.length < 6) return null;
  const seq = history.slice(0, 6).map((e) => e.ketqua);
  if (
    seq[0] === seq[1] &&
    seq[1] === seq[2] &&
    seq[3] === seq[4] &&
    seq[4] === seq[5] &&
    seq[0] !== seq[3]
  ) {
    return { duDoan: seq[0], loaiCau: "Cầu 3-3" };
  }
  return null;
}

function cau12(history) {
  if (history.length < 3) return null;
  const seq = history.slice(0, 3).map((e) => e.ketqua);
  if (seq[0] !== seq[1] && seq[1] === seq[2]) {
    return { duDoan: seq[1], loaiCau: "Cầu 1-2" };
  }
  return null;
}

function cau21(history) {
  if (history.length < 3) return null;
  const seq = history.slice(0, 3).map((e) => e.ketqua);
  if (seq[0] === seq[1] && seq[1] !== seq[2]) {
    const next = seq[0] === "T" ? "X" : "T";
    return { duDoan: next, loaiCau: "Cầu 2-1" };
  }
  return null;
}

function thongKe10(history) {
  const last10 = history.slice(0, 10);
  if (last10.length < 5) return null;
  const tai = last10.filter((e) => e.ketqua === "T").length;
  const xiu = last10.length - tai;
  const duDoan = tai > xiu ? "X" : "T";
  return {
    duDoan,
    loaiCau: `Thống Kê 10 Phiên (Tài:${tai} Xỉu:${xiu})`,
    tai,
    xiu,
  };
}

function trungBinhTong(history) {
  const last5 = history.slice(0, 5).filter((e) => e.tong > 0);
  if (last5.length < 3) return null;
  const avg = last5.reduce((s, e) => s + e.tong, 0) / last5.length;
  const duDoan = avg >= 11 ? "T" : "X";
  return {
    duDoan,
    loaiCau: `Trung Bình Tổng (avg=${avg.toFixed(2)})`,
    avg: parseFloat(avg.toFixed(2)),
  };
}

function cauGay(history) {
  if (history.length < 5) return null;
  const last = history[0].ketqua;
  const prev = history[1].ketqua;
  if (last !== prev) {
    let oldStreak = 1;
    for (let i = 1; i < history.length - 1; i++) {
      if (history[i].ketqua === history[i + 1].ketqua) oldStreak++;
      else break;
    }
    if (oldStreak >= 3) {
      return {
        duDoan: last,
        loaiCau: `Cầu Gãy (streak cũ ${oldStreak}, theo chiều mới)`,
        oldStreak,
      };
    }
  }
  return null;
}

function aiVoting(history) {
  const algos = [cauBet, cau11, cau22, cau33, cau12, cau21, thongKe10, trungBinhTong, cauGay];
  const votes = { T: 0, X: 0 };
  const details = [];

  for (const fn of algos) {
    const r = fn(history);
    if (r) {
      votes[r.duDoan]++;
      details.push({ algo: r.loaiCau, vote: r.duDoan });
    }
  }

  const total = votes["T"] + votes["X"];
  if (total === 0) return null;

  const duDoan = votes["T"] >= votes["X"] ? "T" : "X";
  const confidence = Math.round((Math.max(votes["T"], votes["X"]) / total) * 100);

  return {
    duDoan,
    loaiCau: "AI Voting Tổng Hợp",
    votes,
    confidence,
    details,
  };
}

function predict(history) {
  if (history.length === 0) return null;

  const results = {};
  const run = (name, fn) => {
    try { results[name] = fn(history) || null; } catch { results[name] = null; }
  };

  run("cauBet", cauBet);
  run("cau11", cau11);
  run("cau22", cau22);
  run("cau33", cau33);
  run("cau12", cau12);
  run("cau21", cau21);
  run("thongKe10", thongKe10);
  run("trungBinhTong", trungBinhTong);
  run("cauGay", cauGay);
  run("aiVoting", aiVoting);

  const main = results.aiVoting || results.cauBet || null;

  return { deXuat: main, tatCaThuat: results };
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// GET /api/taixiu?id=<id>&user=<@username>
app.get("/api/taixiu", async (req, res) => {
  try {
    const id = req.query.id || "";
    const userId = req.query.user || "@sewdangcap"; // mặc định theo yêu cầu

    const raw = await fetchLatest(id);

    const dice = parseDice(raw);
    const total = parseTotal(dice);
    const phien = parsePienId(raw);
    const ketquaCode = parseResult(dice);
    const openTime = parseOpenTime(raw);

    const entry = {
      phien,
      ketqua: ketquaCode,      // "T" hoặc "X" – dùng cho pattern
      tong: total,
      xucxac: dice,
      openTime,
    };

    updateHistory(entry);

    // Tính phiên tiếp theo
    let phienTiepTheo = null;
    if (phien) {
      const n = parseInt(String(phien).slice(-4), 10);
      const prefix = String(phien).slice(0, -4);
      phienTiepTheo = prefix + String(n + 1).padStart(4, "0");
    }

    const duDoan = predict(historyCache);
    const main = duDoan?.deXuat;
    const pattern = buildPattern(historyCache, 20);

    res.json({
      phien: phien,
      ketQua: {
        code: ketquaCode,
        label: resultLabel(ketquaCode),
        tong: total,
      },
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

// GET /api/taixiu/history
app.get("/api/taixiu/history", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const pattern = buildPattern(historyCache, limit);

  res.json({
    success: true,
    total: historyCache.length,
    pattern: pattern,
    data: historyCache.slice(0, limit).map((e) => ({
      phien: e.phien,
      ketQua: { code: e.ketqua, label: resultLabel(e.ketqua), tong: e.tong },
      xucXac: e.xucxac,
      openTime: e.openTime,
    })),
  });
});

// GET /api/taixiu/predict
app.get("/api/taixiu/predict", (req, res) => {
  const userId = req.query.user || "@sewdangcap";

  if (historyCache.length < 2) {
    return res.json({
      success: false,
      message: "Chưa đủ dữ liệu, hãy gọi /api/taixiu trước",
    });
  }

  const duDoan = predict(historyCache);
  const main = duDoan?.deXuat;
  const pattern = buildPattern(historyCache, 20);
  const phienTiepTheo = historyCache[0]?.phien
    ? (() => {
        const p = String(historyCache[0].phien);
        const n = parseInt(p.slice(-4), 10);
        return p.slice(0, -4) + String(n + 1).padStart(4, "0");
      })()
    : null;

  res.json({
    id: userId,
    phienDuDoan: phienTiepTheo,
    duDoan: main
      ? {
          ketQua: { code: main.duDoan, label: resultLabel(main.duDoan) },
          doTinCay: `${main.confidence}%`,
          pattern: pattern,
          cauHien: main.loaiCau,
        }
      : null,
    soPhienPhanTich: historyCache.length,
  });
});

// GET /api/taixiu/poll?interval=5&limit=10
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
      const total = parseTotal(raw);
      const phien = parsePienId(raw);
      const ketquaCode = parseResult(dice);
      const openTime = parseOpenTime(raw);

      const entry = { phien, ketqua: ketquaCode, tong: total, xucxac: dice, openTime };
      updateHistory(entry);

      const duDoan = predict(historyCache);
      const main = duDoan?.deXuat;
      const pattern = buildPattern(historyCache, 20);

      let phienTiepTheo = null;
      if (phien) {
        const n = parseInt(String(phien).slice(-4), 10);
        const prefix = String(phien).slice(0, -4);
        phienTiepTheo = prefix + String(n + 1).padStart(4, "0");
      }

      const payload = {
        id: userId,
        tick: ++count,
        timestamp: new Date().toISOString(),
        phien: phien,
        ketQua: { code: ketquaCode, label: resultLabel(ketquaCode), tong: total },
        xucXac: dice,
        phienHienTai: phien,
        phienTiepTheo: phienTiepTheo,
        duDoan: main
          ? {
              phien: phienTiepTheo,
              ketQua: { code: main.duDoan, label: resultLabel(main.duDoan) },
              doTinCay: `${main.confidence}%`,
              pattern: pattern,
              cauHien: main.loaiCau,
            }
          : null,
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
    name: "Tài Xỉu Prediction API",
    endpoints: {
      "GET /api/taixiu?id=<id>&user=<@username>": "Lấy phiên mới + dự đoán",
      "GET /api/taixiu/history?limit=20": "Xem lịch sử cache + pattern",
      "GET /api/taixiu/predict?user=<@username>": "Dự đoán từ lịch sử hiện có",
      "GET /api/taixiu/poll?interval=5&limit=50&user=<@username>": "Stream liên tục (NDJSON)",
    },
  });
});

app.listen(PORT, () => {
  console.log(`✅ Tài Xỉu API chạy tại http://localhost:${PORT}`);
});

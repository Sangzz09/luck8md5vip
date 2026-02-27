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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseDice(data) {
  // Cố gắng lấy xúc xắc từ nhiều cấu trúc JSON khác nhau
  const d =
    data.dice ||
    data.Dice ||
    data.xucxac ||
    data.result?.dice ||
    data.data?.dice ||
    [];
  return Array.isArray(d) ? d : [];
}

function parseTotal(dice) {
  return dice.reduce((s, v) => s + Number(v), 0);
}

function parsePienId(data) {
  return (
    data.id ||
    data.Id ||
    data.phien ||
    data.sessionId ||
    data.result?.id ||
    data.data?.id ||
    null
  );
}

function parseResult(data, dice) {
  const r =
    data.result ||
    data.Result ||
    data.ketqua ||
    data.data?.result ||
    null;
  if (r) return String(r).toLowerCase().includes("tai") ? "Tài" : "Xỉu";
  const total = parseTotal(dice);
  if (total === 0) return null;
  return total >= 11 ? "Tài" : "Xỉu";
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

// 1. Cầu bệt (streak) – dự theo đà hiện tại
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

// 2. Cầu 1-1 (xen kẽ)
function cau11(history) {
  if (history.length < 4) return null;
  const seq = history.slice(0, 4).map((e) => e.ketqua);
  const isAlternate =
    seq[0] !== seq[1] && seq[1] !== seq[2] && seq[2] !== seq[3];
  if (!isAlternate) return null;
  const next = seq[0] === "Tài" ? "Xỉu" : "Tài";
  return { duDoan: next, loaiCau: "Cầu 1-1 (Xen Kẽ)" };
}

// 3. Cầu 2-2 (2 giống 2 giống)
function cau22(history) {
  if (history.length < 4) return null;
  const seq = history.slice(0, 4).map((e) => e.ketqua);
  if (seq[0] === seq[1] && seq[2] === seq[3] && seq[0] !== seq[2]) {
    return { duDoan: seq[0], loaiCau: "Cầu 2-2" };
  }
  return null;
}

// 4. Cầu 3-3
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

// 5. Cầu 1-2 (1 rồi 2)
function cau12(history) {
  if (history.length < 3) return null;
  const seq = history.slice(0, 3).map((e) => e.ketqua);
  if (seq[0] !== seq[1] && seq[1] === seq[2]) {
    return { duDoan: seq[1], loaiCau: "Cầu 1-2" };
  }
  return null;
}

// 6. Cầu 2-1 (2 rồi 1)
function cau21(history) {
  if (history.length < 3) return null;
  const seq = history.slice(0, 3).map((e) => e.ketqua);
  if (seq[0] === seq[1] && seq[1] !== seq[2]) {
    const next = seq[0] === "Tài" ? "Xỉu" : "Tài";
    return { duDoan: next, loaiCau: "Cầu 2-1" };
  }
  return null;
}

// 7. Thống kê tỷ lệ 10 phiên gần nhất
function thongKe10(history) {
  const last10 = history.slice(0, 10);
  if (last10.length < 5) return null;
  const tai = last10.filter((e) => e.ketqua === "Tài").length;
  const xiu = last10.length - tai;
  const duDoan = tai > xiu ? "Xỉu" : "Tài"; // ngược chiều xu hướng
  return {
    duDoan,
    loaiCau: `Thống Kê 10 Phiên (Tài:${tai} Xỉu:${xiu})`,
    tai,
    xiu,
  };
}

// 8. Phân tích tổng điểm xu hướng (trung bình)
function trungBinhTong(history) {
  const last5 = history.slice(0, 5).filter((e) => e.tong > 0);
  if (last5.length < 3) return null;
  const avg = last5.reduce((s, e) => s + e.tong, 0) / last5.length;
  const duDoan = avg >= 11 ? "Tài" : "Xỉu";
  return {
    duDoan,
    loaiCau: `Trung Bình Tổng (avg=${avg.toFixed(2)})`,
    avg: parseFloat(avg.toFixed(2)),
  };
}

// 9. Cầu gãy – phát hiện chuỗi dài bị gãy và dự đoán đổi chiều
function cauGay(history) {
  if (history.length < 5) return null;
  const last = history[0].ketqua;
  const prev = history[1].ketqua;
  if (last !== prev) {
    // vừa gãy cầu
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

// 10. AI - Voting tổng hợp nhiều thuật toán
function aiVoting(history) {
  const algos = [cauBet, cau11, cau22, cau33, cau12, cau21, thongKe10, trungBinhTong, cauGay];
  const votes = { Tài: 0, Xỉu: 0 };
  const details = [];

  for (const fn of algos) {
    const r = fn(history);
    if (r) {
      votes[r.duDoan]++;
      details.push({ algo: r.loaiCau, vote: r.duDoan });
    }
  }

  const total = votes["Tài"] + votes["Xỉu"];
  if (total === 0) return null;

  const duDoan = votes["Tài"] >= votes["Xỉu"] ? "Tài" : "Xỉu";
  const confidence = Math.round((Math.max(votes["Tài"], votes["Xỉu"]) / total) * 100);

  return {
    duDoan,
    loaiCau: "AI Voting Tổng Hợp",
    votes,
    confidence: `${confidence}%`,
    details,
  };
}

// ─── Hàm dự đoán chính ───────────────────────────────────────────────────────
function predict(history) {
  if (history.length === 0) return null;

  const results = {};

  const run = (name, fn) => {
    try {
      results[name] = fn(history) || null;
    } catch {
      results[name] = null;
    }
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

  // Kết quả đề xuất chính = AI Voting
  const main = results.aiVoting || results.cauBet || null;

  return {
    deXuat: main
      ? { duDoan: main.duDoan, loaiCau: main.loaiCau, confidence: main.confidence || null }
      : null,
    tatCaThuat: results,
  };
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// GET /api/taixiu?id=<id>
// Lấy phiên mới + dự đoán phiên tiếp theo
app.get("/api/taixiu", async (req, res) => {
  try {
    const id = req.query.id || "";
    const raw = await fetchLatest(id);

    const dice = parseDice(raw);
    const total = parseTotal(dice);
    const phien = parsePienId(raw);
    const ketqua = parseResult(raw, dice);

    const entry = {
      phien,
      ketqua,
      tong: total,
      xucxac: dice,
      raw,
    };

    updateHistory(entry);

    const nextPhien = phien ? phien + 1 : null;
    const duDoan = predict(historyCache);

    res.json({
      success: true,
      phienHienTai: {
        phien,
        ketqua,
        tong: total,
        xucxac: dice,
      },
      phienDuDoan: nextPhien,
      duDoan: duDoan?.deXuat || null,
      tatCaThuatToan: duDoan?.tatCaThuat || null,
      lichSu: historyCache.slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/taixiu/history – xem lịch sử cache
app.get("/api/taixiu/history", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({
    success: true,
    total: historyCache.length,
    data: historyCache.slice(0, limit),
  });
});

// GET /api/taixiu/predict – chỉ dự đoán từ lịch sử hiện có
app.get("/api/taixiu/predict", (req, res) => {
  if (historyCache.length < 2) {
    return res.json({
      success: false,
      message: "Chưa đủ dữ liệu, hãy gọi /api/taixiu trước",
    });
  }
  const duDoan = predict(historyCache);
  const nextPhien =
    historyCache[0]?.phien ? historyCache[0].phien + 1 : null;

  res.json({
    success: true,
    phienDuDoan: nextPhien,
    deXuat: duDoan?.deXuat || null,
    tatCaThuatToan: duDoan?.tatCaThuat || null,
    soPhienPhanTich: historyCache.length,
  });
});

// GET /api/taixiu/poll?interval=5&limit=10
// Treo API – tự động fetch liên tục và trả về stream JSON newline-delimited
app.get("/api/taixiu/poll", async (req, res) => {
  const interval = Math.max(3, parseInt(req.query.interval) || 5) * 1000;
  const limit = Math.min(200, parseInt(req.query.limit) || 50);

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let count = 0;

  const tick = async () => {
    if (count >= limit || res.destroyed) {
      res.end();
      return;
    }

    try {
      const raw = await fetchLatest("");
      const dice = parseDice(raw);
      const total = parseTotal(dice);
      const phien = parsePienId(raw);
      const ketqua = parseResult(raw, dice);

      const entry = { phien, ketqua, tong: total, xucxac: dice };
      updateHistory(entry);

      const duDoan = predict(historyCache);
      const nextPhien = phien ? phien + 1 : null;

      const payload = {
        tick: ++count,
        timestamp: new Date().toISOString(),
        phienHienTai: entry,
        phienDuDoan: nextPhien,
        deXuat: duDoan?.deXuat || null,
        confidence: duDoan?.deXuat?.confidence || null,
      };

      res.write(JSON.stringify(payload) + "\n");
    } catch (err) {
      res.write(JSON.stringify({ error: err.message, tick: ++count }) + "\n");
    }

    if (count < limit && !res.destroyed) {
      setTimeout(tick, interval);
    } else {
      res.end();
    }
  };

  tick();
});

// GET / – hướng dẫn
app.get("/", (req, res) => {
  res.json({
    name: "Tài Xỉu Prediction API",
    endpoints: {
      "GET /api/taixiu?id=<id>": "Lấy phiên mới + dự đoán",
      "GET /api/taixiu/history?limit=20": "Xem lịch sử cache",
      "GET /api/taixiu/predict": "Dự đoán từ lịch sử hiện có",
      "GET /api/taixiu/poll?interval=5&limit=50":
        "Treo API – stream liên tục (NDJSON)",
    },
    thuatToan: [
      "cauBet – Cầu bệt theo đà",
      "cau11 – Cầu 1-1 xen kẽ",
      "cau22 – Cầu 2-2",
      "cau33 – Cầu 3-3",
      "cau12 – Cầu 1-2",
      "cau21 – Cầu 2-1",
      "thongKe10 – Thống kê 10 phiên",
      "trungBinhTong – Trung bình tổng điểm",
      "cauGay – Cầu gãy đổi chiều",
      "aiVoting – AI tổng hợp vote các thuật toán",
    ],
  });
});

app.listen(PORT, () => {
  console.log(`✅ Tài Xỉu API chạy tại http://localhost:${PORT}`);
  console.log(`📡 Treo API: http://localhost:${PORT}/api/taixiu/poll?interval=5&limit=100`);
});

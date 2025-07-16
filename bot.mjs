// bot.mjs
import TelegramBot from 'node-telegram-bot-api';
import { initBrowser, fetchLatestCrashRounds } from './getLiveCrashData.mjs';

// ✅ Start Puppeteer
await initBrowser();

const token = '7947641286:AAHv2JW3GgbRI3BquUuO2Q0IYe9IMPm4H-o';
const bot = new TelegramBot(token, { polling: true });

console.log('🤖 Bot is running...');

// === STRATEGY HELPERS ===

// 🧮 Mean‑Reversion: avg(last5) ≤2.5 → GREEN, ≥6.0 → RED
function detectMeanReversion(history) {
  if (history.length < 5) return null;
  const slice = history.slice(-5);
  const avg = slice.reduce((s, v) => s + v, 0) / 5;
  if (avg <= 2.5) return '🟢 GREEN: Mean‑reversion bounce (low avg)';
  if (avg >= 6.0) return '🔴 RED: Mean‑reversion pullback (high avg)';
  return null;
}

// 🔴 Yellow → Green Combo
function shouldPredictRed(history) {
  if (history.length < 2) return false;
  const [penult, last] = history.slice(-2);
  return penult >= 20 && last >= 2 && last < 3;
}

// 🔴 Green → Spike Trap (2.0–2.5 → ≥5)
function isGreenTrap(history) {
  if (history.length < 2) return false;
  const [penult, last] = history.slice(-2);
  return penult >= 2 && penult <= 2.5 && last >= 5;
}

// 🔴 Stable Green Trap (3 greens 2–5 with diffs ≤0.5)
function isStableGreenTrap(history) {
  if (history.length < 3) return false;
  const [a, b, c] = history.slice(-3);
  return [a, b, c].every(v => v >= 2 && v <= 5)
    && Math.abs(a - b) <= 0.5 && Math.abs(b - c) <= 0.5;
}

// 🔴 Rising Greens (3 increasing greens)
function hasRisingGreenTrend(history) {
  if (history.length < 3) return false;
  const [x, y, z] = history.slice(-3);
  return x < y && y < z && x >= 2 && z < 10;
}

// 🔴 Zigzag Green Trap (High‑Low‑High or Low‑High‑Low)
function isZigzagGreenTrap(history) {
  if (history.length < 5) return false;
  const last5 = history.slice(-5);
  for (let i = 0; i <= 2; i++) {
    const [a, b, c] = last5.slice(i, i + 3);
    const isHigh = v => v >= 3 && v < 10;
    const isLow  = v => v >= 2 && v < 2.5;
    if ((isHigh(a) && isLow(b) && isHigh(c)) || (isLow(a) && isHigh(b) && isLow(c))) {
      return true;
    }
  }
  return false;
}

// 🟢 Red‑to‑Green Reversal (low→higher→lowest red)
function isRedToGreenReversal(history) {
  if (history.length < 3) return false;
  const [a, b, c] = history.slice(-3);
  return a <= 1.99 && b <= 1.99 && c <= 1.99 && a < b && c < a;
}

// 🟢 Green Streak (4 of last 5 green 2–10)
function hasGreenStreak(history) {
  if (history.length < 5) return false;
  return history.slice(-5).filter(v => v >= 2 && v < 10).length >= 4;
}

// 🟡 Spike Alert (any of last 3 ≥20)
function hasRecentSpike(history) {
  return history.slice(-3).some(v => v >= 20);
}

// 📈 EMA Crossover: dynamic periods down to 2 points
function detectEMACrossover(history, shortPeriod = 3, longPeriod = 6) {
  const N = history.length;
  const sp = Math.min(shortPeriod, N);
  const lp = Math.min(longPeriod, N);
  if (N < 2) return null;

  const calcEMA = (data, period) => {
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  };

  const shortEMA = calcEMA(history.slice(-sp), sp);
  const longEMA = calcEMA(history.slice(-lp), lp);

  if (shortEMA > longEMA) return '🟢 GREEN: EMA crossover bullish (short > long)';
  if (shortEMA < longEMA) return '🔴 RED: EMA crossover bearish (short < long)';
  return null;
}

// 🏁 Volatility‑Adjusted Cash‑Out Target
function computeCashoutTarget(history, windowSize = 6, sigmaMult = 1) {
  const N = Math.min(windowSize, history.length);
  if (N < 2) return 1.10;
  const slice = history.slice(-N).map(v => Math.log(v));
  const mean = slice.reduce((s, x) => s + x, 0) / N;
  const variance = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / N;
  const std = Math.sqrt(variance);
  const lowerLog = mean - sigmaMult * std;
  const raw = Math.exp(lowerLog);
  const safe = Math.max(raw, 1.10);
  return Math.round(safe * 100) / 100;
}

// === MAIN PREDICTION LOGIC ===
function getCrashPrediction(history) {
  if (history.length < 2) return '⚠️ Not enough data to predict';

  const mean = detectMeanReversion(history);
  if (mean) return mean;

  if (shouldPredictRed(history)) return '🔴 RED: Yellow spike → green (≥20× → 2–3×)';
  if (isGreenTrap(history)) return '🔴 RED: Green→spike trap (2–2.5× → ≥5×)';
  if (isStableGreenTrap(history)) return '🔴 RED: Stable green trap (2–5× close)';
  if (hasRisingGreenTrend(history)) return '🔴 RED: Rising green trend (3↑)';
  if (isZigzagGreenTrap(history)) return '🔴 RED: Zigzag trap (H–L–H or L–H–L)';
  if (isRedToGreenReversal(history)) return '🟢 GREEN: Red reversal (low→high→lowest)';
  if (hasGreenStreak(history)) return '🟢 GREEN: 4+ greens in last 5';
  if (hasRecentSpike(history)) return '🟡 YELLOW: Recent spike (≥20×)';
  
  // DEFAULT: EMA Crossover
  const ema = detectEMACrossover(history);
  return ema || '⚠️ No strong signal found';
}

// === TELEGRAM COMMANDS ===
bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id, `👋 Welcome to BC.Game Crash Predictor!
Available commands:
/predict – Current trend prediction
/history – Last 8 crash results
/suggest – Betting suggestion
/cashout – Recommended cash‑out multiplier`);
});

bot.onText(/\/predict/, async msg => {
  const data = await fetchLatestCrashRounds();
  if (!data) return bot.sendMessage(msg.chat.id, '❌ Could not fetch data.');
  const last8 = data.slice(-8);
  bot.sendMessage(msg.chat.id, `📈 Prediction: ${getCrashPrediction(last8)}`);
});

bot.onText(/\/history/, async msg => {
  const data = await fetchLatestCrashRounds();
  if (!data) return bot.sendMessage(msg.chat.id, '❌ Could not fetch data.');
  const last8 = data.slice(-8);
  const text = last8.map((v, i) =>
    `${i + 1}. ${v}x ${v >= 10 ? '🟡' : v <= 1.99 ? '🔴' : '🟢'}`
  ).join('\n');
  bot.sendMessage(msg.chat.id, `🕹️ Last 8 Crashes:\n${text}`);
});

bot.onText(/\/suggest/, async msg => {
  const data = await fetchLatestCrashRounds();
  if (!data) return bot.sendMessage(msg.chat.id, '❌ Could not fetch data.');
  const last8 = data.slice(-8);
  const pred = getCrashPrediction(last8);
  let suggest = '🤔 No clear pattern — wait.';
  if (pred.startsWith('🔴')) suggest = '🔻 Bet low or skip next round.';
  if (pred.startsWith('🟢')) suggest = '🟢 Medium bet next round.';
  if (pred.startsWith('🟡')) suggest = '⚠️ Skip next 2 rounds.';
  bot.sendMessage(msg.chat.id, `🎯 ${suggest}`);
});

bot.onText(/\/cashout/, async msg => {
  const data = await fetchLatestCrashRounds();
  if (!data) return bot.sendMessage(msg.chat.id, '❌ Could not fetch data.');
  const last8 = data.slice(-8);
  const target = computeCashoutTarget(last8);
  bot.sendMessage(
    msg.chat.id,
    `🏁 Cash‑Out Guide based on last ${Math.min(6, last8.length)} rounds:\n` +
    `Recommended: *${target.toFixed(2)}×*`,
    { parse_mode: 'Markdown' }
  );
});

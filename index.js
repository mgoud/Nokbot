const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const fs = require("fs");
const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const fetch = require("node-fetch");
const { Client, GatewayIntentBits, Events } = require("discord.js");

console.log("--- BOT STARTING UP: VERSION 6.1 (MULTI-CHANNEL DASHBOARD) ---");

// 1. CONFIG
const DISCORD_TOKEN = (process.env.DISCORD_TOKEN || "").trim();

// Keep this working for your current setup
const CHANNEL_ID = (process.env.CHANNEL_ID || "").trim();

// Optional: add more channel IDs here as comma-separated environment variable
// Example: CHANNEL_IDS=111111111111111111,222222222222222222
const CHANNEL_IDS_RAW = (process.env.CHANNEL_IDS || "").trim();

const SHEET_URL = (process.env.SHEET_URL || "").trim();
const MESSAGE_FILE = path.join(__dirname, "message.json");

const FONT_FILENAME = "Roboto-VariableFont_wdth,wght.ttf";
const FONT_PATH = path.join(__dirname, "fonts", FONT_FILENAME);

if (fs.existsSync(FONT_PATH)) {
  GlobalFonts.registerFromPath(FONT_PATH, "TornFont");
  console.log("✅ Font registered successfully: TornFont");
} else {
  console.log("⚠️ FONT NOT FOUND! Checked path: " + FONT_PATH);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 2. HELPERS

function getDashboardChannelIds() {
  const ids = [];

  if (CHANNEL_ID) {
    ids.push(CHANNEL_ID);
  }

  if (CHANNEL_IDS_RAW) {
    CHANNEL_IDS_RAW
      .split(",")
      .map(id => id.trim())
      .filter(Boolean)
      .forEach(id => ids.push(id));
  }

  // Remove duplicates
  return [...new Set(ids)];
}

function loadMessageCache() {
  let saved = {};

  if (fs.existsSync(MESSAGE_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(MESSAGE_FILE, "utf8"));
    } catch (e) {
      saved = {};
    }
  }

  // New format
  if (!saved.channels) {
    saved.channels = {};
  }

  // Backwards compatibility with your old message.json format:
  // { summaryMsgId: "...", betsMsgId: "..." }
  if ((saved.summaryMsgId || saved.betsMsgId) && CHANNEL_ID) {
    saved.channels[CHANNEL_ID] = {
      summaryMsgId: saved.summaryMsgId,
      betsMsgId: saved.betsMsgId
    };

    delete saved.summaryMsgId;
    delete saved.betsMsgId;
  }

  return saved;
}

function saveMessageCache(saved) {
  fs.writeFileSync(MESSAGE_FILE, JSON.stringify(saved, null, 2));
}

function getTornTime() {
  return new Date().toLocaleString("en-GB", {
    timeZone: "UTC",
    hour12: false
  }) + " TCT";
}

function formatCurrency(val) {
  const num = Number(val) || 0;
  if (num === 0) return "$0";

  const prefix = num < 0 ? "-$" : "$";
  const absoluteValue = Math.abs(num).toLocaleString("en-US");
  return `${prefix}${absoluteValue}`;
}

function drawSafeText(ctx, text, x, y, w, h, align = "left", isBold = false) {
  ctx.fillStyle = "#000000";
  ctx.font = isBold ? "bold 14px TornFont" : "14px TornFont";

  let tx = x + 8;

  if (align === "center") {
    const tw = ctx.measureText(text).width;
    tx = x + (w - tw) / 2;
  } else if (align === "right") {
    const tw = ctx.measureText(text).width;
    tx = x + w - tw - 8;
  }

  ctx.fillText(text, tx, y + (h / 2) + 5);
}

// Summary Image Generator
async function generateSummaryImage(summaryData) {
  const colWidths = [150, 90, 60, 75, 130, 120, 120, 120, 120, 120, 150];
  const width = colWidths.reduce((a, b) => a + b, 0) + 40;
  const height = 100 + (Math.max(summaryData.length, 1) * 35);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  let curY = 40;
  let curX = 20;

  const headers = [
    "Player",
    "Month",
    "Bets",
    "W / L",
    "Profit Today",
    "Week 1",
    "Week 2",
    "Week 3",
    "Week 4",
    "Week 5",
    "Month Profit"
  ];

  headers.forEach((h, i) => {
    const w = colWidths[i];
    ctx.fillStyle = "#e2efda";
    ctx.fillRect(curX, curY, w, 30);
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(curX, curY, w, 30);
    drawSafeText(ctx, h, curX, curY, w, 30, "center", true);
    curX += w;
  });

  curY += 30;

  if (summaryData.length === 0) {
    drawSafeText(ctx, "No ledger history recorded.", 20, curY, width - 40, 30, "left");
  } else {
    summaryData.forEach((row, rowIndex) => {
      curX = 20;
      const wlString = `${row.wins || 0}/${row.losses || 0}`;

      let cleanMonth = String(row.month || "—");

      if (cleanMonth.includes("T")) {
        cleanMonth = cleanMonth.split("T")[0];
      }

      if (cleanMonth.length > 7) {
        cleanMonth = cleanMonth.slice(0, 7);
      }

      const rowData = [
        row.player || "—",
        cleanMonth,
        String(row.bets || 0),
        wlString,
        formatCurrency(row.profitToday),
        formatCurrency(row.week1Profit),
        formatCurrency(row.week2Profit),
        formatCurrency(row.week3Profit),
        formatCurrency(row.week4Profit),
        formatCurrency(row.week5Profit),
        formatCurrency(row.monthProfit)
      ];

      rowData.forEach((val, i) => {
        const w = colWidths[i];

        ctx.fillStyle = rowIndex % 2 === 0 ? "#ffffff" : "#f5f9f3";
        ctx.fillRect(curX, curY, w, 30);

        ctx.strokeStyle = "#000000";
        ctx.strokeRect(curX, curY, w, 30);

        let align = "left";
        if (i === 1 || i === 2 || i === 3) align = "center";
        if (i >= 4) align = "right";

        ctx.font = "13px TornFont";
        drawSafeText(ctx, val, curX, curY, w, 30, align);

        curX += w;
      });

      curY += 30;
    });
  }

  const imgPath = path.join(__dirname, "summary.png");
  fs.writeFileSync(imgPath, canvas.toBuffer("image/png"));
  return imgPath;
}

// Active Bets Image Generator
async function generateActiveBetsImage(data) {
  const players = data.players || [];
  let bets = data.bets || [];

  bets.sort((a, b) => {
    const timeA = Number(a.eventStart) || 9999999999;
    const timeB = Number(b.eventStart) || 9999999999;
    return timeA - timeB;
  });

  const colWidths = [280, 180, 200, 80];
  const width = 820 + (players.length * 75);
  const height = 100 + (Math.max(bets.length, 1) * 35);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  let curY = 40;
  let curX = 20;

  const headers = ["Match", "Pick", "Start (DD/MM TCT)", "Odds", ...players];

  headers.forEach((h, i) => {
    const w = colWidths[i] || 75;

    ctx.fillStyle = "#d9eaf7";
    ctx.strokeStyle = "#000000";

    ctx.fillRect(curX, curY, w, 30);
    ctx.strokeRect(curX, curY, w, 30);

    drawSafeText(ctx, h, curX, curY, w, 30, "center", true);

    curX += w;
  });

  curY += 30;

  if (bets.length === 0) {
    drawSafeText(ctx, "No active bets found in sheet.", 20, curY, width - 40, 30, "left");
  } else {
    const nowMs = Date.now();

    bets.forEach((bet, rowIndex) => {
      curX = 20;

      let timeDisplayStr = "—";

      if (bet.eventStart && bet.eventStart > 0) {
        const startMs = bet.eventStart * 1000;
        const d = new Date(startMs);

        const day = d.getUTCDate().toString().padStart(2, "0");
        const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
        const hours = d.getUTCHours().toString().padStart(2, "0");
        const minutes = d.getUTCMinutes().toString().padStart(2, "0");

        const baseDate = `${day}/${month} ${hours}:${minutes}`;

        const diffMs = startMs - nowMs;
        let countdownStr = "";

        if (diffMs <= 0) {
          countdownStr = "(LIVE/STARTED)";
        } else {
          const diffHours = diffMs / (1000 * 60 * 60);

          if (diffHours >= 24) {
            const diffDays = Math.floor(diffHours / 24);
            countdownStr = `(${diffDays}d+ away)`;
          } else if (diffHours >= 1) {
            countdownStr = `(in ${Math.floor(diffHours)}h)`;
          } else {
            const diffMins = Math.floor(diffMs / (1000 * 60));
            countdownStr = `(in ${diffMins}m)`;
          }
        }

        timeDisplayStr = `${baseDate} ${countdownStr}`;
      }

      const rowData = [
        bet.eventName || "—",
        bet.selectionName || "—",
        timeDisplayStr,
        String(bet.odds || ""),
        ...players.map(p => (bet.players && bet.players[p]) ? "YES" : "-")
      ];

      rowData.forEach((val, i) => {
        const w = colWidths[i] || 75;

        ctx.fillStyle = rowIndex % 2 === 0 ? "#ffffff" : "#f9f9f9";
        ctx.fillRect(curX, curY, w, 30);

        ctx.strokeStyle = "#000000";
        ctx.strokeRect(curX, curY, w, 30);

        const align = i >= 2 ? "center" : "left";

        ctx.font = "13px TornFont";
        drawSafeText(ctx, String(val).slice(0, 60), curX, curY, w, 30, align);

        curX += w;
      });

      curY += 30;
    });
  }

  const imgPath = path.join(__dirname, "tracker.png");
  fs.writeFileSync(imgPath, canvas.toBuffer("image/png"));
  return imgPath;
}

// 3. MAIN LOGIC
async function runUpdate() {
  try {
    console.log("🔄 Updating Summary and Active Trackers...");

    const channelIds = getDashboardChannelIds();

    if (channelIds.length === 0) {
      throw new Error("No channel IDs configured. Set CHANNEL_ID or CHANNEL_IDS.");
    }

    const res = await fetch(SHEET_URL, {
      method: "GET",
      redirect: "follow"
    });

    if (!res.ok) {
      throw new Error(`Sheet HTTP ${res.status}`);
    }

    const data = await res.json();

    const summaryImg = await generateSummaryImage(data.summary || []);
    const activeImg = await generateActiveBetsImage(data);

    const saved = loadMessageCache();

    for (const channelId of channelIds) {
      console.log(`📨 Posting dashboards to channel ${channelId}...`);

      let channel;

      try {
        channel = await client.channels.fetch(channelId);
      } catch (e) {
        console.error(`❌ Could not fetch channel ${channelId}:`, e.message);
        continue;
      }

      if (!channel) {
        console.error(`❌ Channel not found: ${channelId}`);
        continue;
      }

      if (!saved.channels[channelId]) {
        saved.channels[channelId] = {};
      }

      const channelSaved = saved.channels[channelId];

      if (channelSaved.summaryMsgId) {
        try {
          const oldSummary = await channel.messages.fetch(channelSaved.summaryMsgId);
          await oldSummary.delete();
        } catch (e) {
          console.log(`⚠️ Could not delete old summary in ${channelId}: ${e.message}`);
        }
      }

      if (channelSaved.betsMsgId) {
        try {
          const oldBets = await channel.messages.fetch(channelSaved.betsMsgId);
          await oldBets.delete();
        } catch (e) {
          console.log(`⚠️ Could not delete old bets dashboard in ${channelId}: ${e.message}`);
        }
      }

      const summaryMsg = await channel.send({
        content: "📊 **Torn Bookie Monthly Performance Summary**",
        files: [summaryImg]
      });

      const betsMsg = await channel.send({
        content: `⚔️ **Live Tracking Dashboard** | Updated: ${getTornTime()}`,
        files: [activeImg]
      });

      saved.channels[channelId] = {
        summaryMsgId: summaryMsg.id,
        betsMsgId: betsMsg.id
      };

      saveMessageCache(saved);

      console.log(`✅ Dashboard posted to ${channelId}`);
    }

    console.log("✅ Dashboard Update Complete!");
  } catch (err) {
    console.error("❌ Tracker Error:", err.message);
  }
}

client.once(Events.ClientReady, () => {
  console.log(`✅ Online as ${client.user.tag}`);

  runUpdate();

  setInterval(runUpdate, 60 * 60 * 1000);
});

client.on(Events.MessageCreate, m => {
  if (m.author.bot) return;

  if (m.content === "!update") {
    m.reply("Manual update triggered...");
    runUpdate();
  }
});

client.login(DISCORD_TOKEN).catch(e => {
  console.error("❌ Login Failed:", e.message);
});

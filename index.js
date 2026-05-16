const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const fs = require("fs");
const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const fetch = require("node-fetch");
const { Client, GatewayIntentBits, Events } = require("discord.js");

console.log("--- BOT STARTING UP: VERSION 6.0 (MONTHLY SUMMARY PIVOT) ---");

// 1. CONFIG
const DISCORD_TOKEN = (process.env.DISCORD_TOKEN || "").trim();
const CHANNEL_ID = (process.env.CHANNEL_ID || "").trim();
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
function getTornTime() {
  return new Date().toLocaleString("en-GB", { timeZone: "UTC", hour12: false }) + " TCT";
}

function formatCurrency(val) {
  const num = Number(val) || 0;
  if (num === 0) return "$0";
  
  // Format negative values as -$X,XXX instead of accounting parenthesis
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
// Summary Image Generator (FIXED COLUMN WIDTHS)
async function generateSummaryImage(summaryData) {
  // Increased Player to 150, Month to 90, and tweaked week widths for a cleaner footprint
  const colWidths = [150, 90, 60, 75, 130, 120, 120, 120, 120, 120, 150];
  const width = colWidths.reduce((a, b) => a + b, 0) + 40;
  const height = 100 + (Math.max(summaryData.length, 1) * 35);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  let curY = 40;
  let curX = 20;

  const headers = ["Player", "Month", "Bets", "W / L", "Profit Today", "Week 1", "Week 2", "Week 3", "Week 4", "Week 5", "Month Profit"];
  
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
      
      // FIX: Clean up Month data string to cut out any long timestamp extensions (takes just YYYY-MM)
      let cleanMonth = String(row.month || "—");
      if (cleanMonth.includes("T")) {
        cleanMonth = cleanMonth.split("T")[0];
      }
      // If it leaks as a longer format without a T (e.g. YYYY-MM-DD), slice it up to the month mark
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

        // Tweak: Dropping size slightly down to 13px directly inside this loop for ultra-safe padding
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
// Active Bets Image Generator (FIXED CHRONO-SORT & COUNTDOWNS)
async function generateActiveBetsImage(data) {
  const players = data.players || [];
  let bets = data.bets || [];
  
  // 1. STRICTOR CHRONOLOGICAL SORTING
  // Sort by raw eventStart timestamp ascending. If missing, drop to the bottom.
  bets.sort((a, b) => {
    const timeA = Number(a.eventStart) || 9999999999;
    const timeB = Number(b.eventStart) || 9999999999;
    return timeA - timeB;
  });

  // Expanded the Start column width from 180 to 240 to perfectly accommodate the countdown strings
  const colWidths = [280, 180, 200, 80]; 
  const width = 820 + (players.length * 75); // Recalculated tracking base footprint
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
    // Dynamic countdown anchors based on standard TCT (UTC) baseline right now
    const nowMs = Date.now();

    bets.forEach((bet, rowIndex) => {
      curX = 20;

      let timeDisplayStr = "—";
      if (bet.eventStart && bet.eventStart > 0) {
        const startMs = bet.eventStart * 1000;
        const d = new Date(startMs);
        
        // Base Date Building Blocks
        const day = d.getUTCDate().toString().padStart(2, '0');
        const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
        const hours = d.getUTCHours().toString().padStart(2, '0');
        const minutes = d.getUTCMinutes().toString().padStart(2, '0');
        const baseDate = `${day}/${month} ${hours}:${minutes}`;

        // 2. DYNAMIC COUNTDOWN CALCULATOR
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

        // Combine them together nicely within the same cell string
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
        
        // Use a clean font adjustment for the tracking matrix
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
    const res = await fetch(SHEET_URL, { method: "GET", redirect: "follow" });
    
    if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`);
    
    const data = await res.json();
    
    // Generate both assets
    const summaryImg = await generateSummaryImage(data.summary || []);
    const activeImg = await generateActiveBetsImage(data);
    
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    let saved = {};
    if (fs.existsSync(MESSAGE_FILE)) {
      try { saved = JSON.parse(fs.readFileSync(MESSAGE_FILE, "utf8")); } catch (e) {}
    }

    // Safely purge previous dashboard instances to keep channel clean
    if (saved.summaryMsgId) {
      try { const oldSummary = await channel.messages.fetch(saved.summaryMsgId); await oldSummary.delete(); } catch (e) {}
    }
    if (saved.betsMsgId) {
      try { const oldBets = await channel.messages.fetch(saved.betsMsgId); await oldBets.delete(); } catch (e) {}
    }

    // Post Summary Dashboard FIRST
    const summaryMsg = await channel.send({
      content: `📊 **Torn Bookie Monthly Performance Summary**`,
      files: [summaryImg]
    });

    // Post Live Tracking Dashboard SECOND
    const betsMsg = await channel.send({
      content: `⚔️ **Live Tracking Dashboard** | Updated: ${getTornTime()}`,
      files: [activeImg]
    });

    // Cache the tracking IDs
    fs.writeFileSync(MESSAGE_FILE, JSON.stringify({ 
      summaryMsgId: summaryMsg.id, 
      betsMsgId: betsMsg.id 
    }));

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
  if (m.content === "!update") {
    m.reply("Manual update triggered...");
    runUpdate();
  }
});

client.login(DISCORD_TOKEN).catch(e => console.error("❌ Login Failed:", e.message));

const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const fs = require("fs");
const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const fetch = require("node-fetch");
const { Client, GatewayIntentBits, Events } = require("discord.js");

console.log("--- BOT STARTING UP: VERSION 5.0 (FONT FIX) ---");

// 1. CONFIG
const DISCORD_TOKEN = (process.env.DISCORD_TOKEN || "").trim();
const CHANNEL_ID = (process.env.CHANNEL_ID || "").trim();
const SHEET_URL = (process.env.SHEET_URL || "").trim();
const MESSAGE_FILE = path.join(__dirname, "message.json");

// Register Font from your uploaded file
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

function drawSafeText(ctx, text, x, y, w, h, align = "left", isBold = false) {
  ctx.fillStyle = "#000000";
  // We use the alias "TornFont" we registered above
  ctx.font = isBold ? "bold 14px TornFont" : "14px TornFont";
  
  let tx = x + 8;
  if (align === "center") {
    const tw = ctx.measureText(text).width;
    tx = x + (w - tw) / 2;
  }
  ctx.fillText(text, tx, y + (h / 2) + 5);
}

async function generateImage(data) {
  const players = data.players || [];
  const bets = data.bets || [];
  
  // 1. Added 100px for the new Start Time column
  const width = 900 + (players.length * 75); 
  const height = 150 + (Math.max(bets.length, 1) * 35);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // ... (Title/Background code remains same) ...

  let curY = 100;
  let curX = 20;
  
  // 2. Updated Column Widths: Match, Pick, Start, Odds...
  const colWidths = [300, 200, 150, 80]; 

  // 3. Updated Headers
  const headers = ["Match", "Pick", "Start (TCT)", "Odds", ...players];
  headers.forEach((h, i) => {
    const w = colWidths[i] || 75;
    ctx.fillStyle = "#d9eaf7";
    ctx.fillRect(curX, curY, w, 30);
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(curX, curY, w, 30);
    drawSafeText(ctx, h, curX, curY, w, 30, "center", true);
    curX += w;
  });

  // Rows
  curY += 30;
  if (bets.length === 0) {
    drawSafeText(ctx, "No active bets found in sheet.", 20, curY, width - 40, 30, "left");
  } else {
    bets.forEach((bet, rowIndex) => {
      curX = 20;

      // 4. Format the Start Time from Unix Timestamp to readable HH:mm
      let startTimeStr = "—";
      if (bet.eventStart && bet.eventStart > 0) {
        const d = new Date(bet.eventStart * 1000);
        startTimeStr = d.getUTCHours().toString().padStart(2, '0') + ":" + 
                       d.getUTCMinutes().toString().padStart(2, '0');
      }

      const rowData = [
        bet.eventName || "—",
        bet.selectionName || "—",
        startTimeStr, // New Column Data
        String(bet.odds || ""),
        ...players.map(p => (bet.players && bet.players[p]) ? "YES" : "-")
      ];

      rowData.forEach((val, i) => {
        const w = colWidths[i] || 75;
        ctx.fillStyle = rowIndex % 2 === 0 ? "#ffffff" : "#f9f9f9";
        ctx.fillRect(curX, curY, w, 30);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(curX, curY, w, 30);
        const align = i >= 2 ? "center" : "left"; // Center align Time, Odds, and Players
        drawSafeText(ctx, String(val).slice(0, 50), curX, curY, w, 30, align);
        curX += w;
      });
      curY += 30;
    });
  }
  // ... (Save buffer code remains same) ...
}

// 3. MAIN LOGIC
async function runUpdate() {
  try {
    console.log("🔄 Updating Tracker...");
    const res = await fetch(SHEET_URL);
    if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`);
    const data = await res.json();
    
    const imgPath = await generateImage(data);
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    let saved = {};
    if (fs.existsSync(MESSAGE_FILE)) {
      try { saved = JSON.parse(fs.readFileSync(MESSAGE_FILE, "utf8")); } catch (e) {}
    }

    if (saved.lastId) {
      try {
        const old = await channel.messages.fetch(saved.lastId);
        await old.delete();
      } catch (e) {}
    }

    const msg = await channel.send({
      content: `**Torn Bookie Tracker** | Updated: ${getTornTime()}`,
      files: [imgPath]
    });

    fs.writeFileSync(MESSAGE_FILE, JSON.stringify({ lastId: msg.id }));
    console.log("✅ Success!");
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

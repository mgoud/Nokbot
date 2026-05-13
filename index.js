const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const fs = require("fs");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");
const fetch = require("node-fetch");
const { Client, GatewayIntentBits, Events } = require("discord.js");

console.log("--- BOT STARTING UP ---");

// 1. CONFIG
const DISCORD_TOKEN = (process.env.DISCORD_TOKEN || "").trim();
const CHANNEL_ID = (process.env.CHANNEL_ID || "").trim();
const SHEET_URL = (process.env.SHEET_URL || "").trim();
const MESSAGE_FILE = path.join(__dirname, "message.json");

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

async function fetchSheet() {
  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`);
  return await res.json();
}

function drawText(ctx, text, x, y, w, h, align = "left", isBold = false) {
  ctx.fillStyle = "#000000";
  ctx.font = isBold ? "bold 14px sans-serif" : "12px sans-serif";
  
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
  
  // Calculate width based on number of players
  const width = 700 + (players.length * 75);
  const height = 120 + (Math.max(bets.length, 1) * 32);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = "#000000";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("Torn Bookie Tracker", 20, 35);
  ctx.font = "11px sans-serif";
  ctx.fillText(`Last Update: ${getTornTime()}`, 20, 55);

  let curY = 80;
  let curX = 20;
  const colWidths = [300, 220, 80]; // Match, Pick, Odds

  // Headers
  const headers = ["Match", "Pick", "Odds", ...players];
  headers.forEach((h, i) => {
    const w = colWidths[i] || 75;
    ctx.fillStyle = "#d9eaf7";
    ctx.fillRect(curX, curY, w, 30);
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(curX, curY, w, 30);
    drawText(ctx, h, curX, curY, w, 30, "center", true);
    curX += w;
  });

  // Rows
  curY += 30;
  bets.forEach((bet, rowIndex) => {
    curX = 20;
    const rowData = [
      bet.eventName || "Unknown",
      bet.selectionName || "Unknown",
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
      drawText(ctx, String(val).slice(0, 45), curX, curY, w, 30, align, false);
      curX += w;
    });
    curY += 30;
  });

  const outPath = path.join(__dirname, "tracker.png");
  const out = fs.createWriteStream(outPath);
  canvas.createPNGStream().pipe(out);
  return new Promise(res => out.on('finish', () => res(outPath)));
}

// 3. MAIN LOGIC
async function runUpdate() {
  try {
    console.log("🔄 Updating Tracker...");
    const data = await fetchSheet();
    const imgPath = await generateImage(data);
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    // Clean up previous post
    let saved = {};
    if (fs.existsSync(MESSAGE_FILE)) {
      saved = JSON.parse(fs.readFileSync(MESSAGE_FILE, "utf8"));
    }

    if (saved.lastId) {
      try {
        const old = await channel.messages.fetch(saved.lastId);
        await old.delete();
      } catch (e) { /* ignore if already deleted */ }
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
  setInterval(runUpdate, 60 * 60 * 1000); // Hourly
});

client.on(Events.MessageCreate, m => {
  if (m.content === "!update") {
    m.reply("Manual update triggered...");
    runUpdate();
  }
});

client.login(DISCORD_TOKEN).catch(e => console.error("❌ Login Failed:", e.message));

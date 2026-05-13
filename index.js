// =============================================================
// TORN BOT - IMAGE TRACKER VERSION (FIXED CANVAS VERSION)
// =============================================================

const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const fs = require("fs");
const path = require("path");
const { createCanvas, registerFont } = require("canvas"); // FIX: Switched to Canvas

const {
  Client,
  GatewayIntentBits,
  Events
} = require("discord.js");

console.log("--- BOT STARTING UP ---");

// 1. CONFIG LOADER - environment variables
const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN || "").trim();
const CHANNEL_ID = String(process.env.CHANNEL_ID || "").trim();
const SHEET_URL = String(process.env.SHEET_URL || "").trim();

const MESSAGE_FILE = "message.json";
const UPDATE_EVERY_MS = 60 * 60 * 1000; // 1 hour

// 2. FONT SETUP
// Note: Ensure DejaVuSans.ttf is in your project folder on GitHub/Railway!
const FONT_PATH = path.join(__dirname, "DejaVuSans.ttf"); 

if (fs.existsSync(FONT_PATH)) {
    // This is the correct way to register fonts with the 'canvas' library
    registerFont(FONT_PATH, { family: "TrackerFont" });
    console.log("✅ Font loaded successfully");
} else {
    console.warn("⚠️ DejaVuSans.ttf not found in project root. Using system default font.");
}

// 3. CLIENT INITIALIZATION
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 4. HELPER FUNCTIONS
function loadMessageData() {
  try {
    return JSON.parse(fs.readFileSync(MESSAGE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveMessageData(data) {
  fs.writeFileSync(MESSAGE_FILE, JSON.stringify(data, null, 2));
}

async function fetchSheetData() {
  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`);
  return await res.json();
}

function shortenText(text, max) {
  text = String(text || "");
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function getTornTimeString() {
  const now = new Date();
  return now.toLocaleString("en-GB", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function drawCellText(ctx, text, x, y, w, h, align = "left", bold = false) {
  ctx.fillStyle = "#000000";
  ctx.font = bold ? "bold 18pt TrackerFont" : "14pt TrackerFont";

  const safeText = String(text || "");
  let tx = x + 8;

  if (align === "center") {
    const metrics = ctx.measureText(safeText);
    tx = x + (w - metrics.width) / 2;
  } else if (align === "right") {
    const metrics = ctx.measureText(safeText);
    tx = x + w - metrics.width - 8;
  }

  ctx.fillText(safeText, tx, y + h / 2 + 7); // Adjusted vertical offset for Canvas
}

async function generateTrackerImage(data) {
  const players = data.players || [];
  const bets = data.bets || [];

  const margin = 20;
  const titleH = 50;
  const headerH = 34;
  const rowH = 30;

  const matchW = 390;
  const pickW = 280;
  const oddsW = 70;
  const playerW = 70;

  const width = margin * 2 + matchW + pickW + oddsW + (players.length * playerW);
  const height = margin * 2 + titleH + headerH + Math.max(bets.length, 1) * rowH + 10;

  // FIX: Create canvas using the canvas library
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = "#000000";
  ctx.font = "20pt TrackerFont";
  ctx.fillText("Torn Bookie Tracker", margin, margin + 22);

  ctx.font = "10pt TrackerFont";
  ctx.fillText(`Updated: ${getTornTimeString()} TCT`, margin, margin + 40);

  let y = margin + titleH;

  const cols = [
    { key: "match", label: "Match", width: matchW },
    { key: "pick", label: "Pick", width: pickW },
    { key: "odds", label: "Odds", width: oddsW },
    ...players.map(p => ({
      key: p,
      label: p === "Nokian" ? "Nok" : p === "ReggieNoble" ? "Reg" : shortenText(p, 4),
      width: playerW
    }))
  ];

  // Header row
  let x = margin;
  for (const col of cols) {
    ctx.fillStyle = "#d9eaf7";
    ctx.fillRect(x, y, col.width, headerH);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, col.width, headerH);
    drawCellText(ctx, col.label, x, y, col.width, headerH, "center", true);
    x += col.width;
  }

  y += headerH;

  // Data rows
  if (!bets.length) {
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(margin, y, width - margin * 2, rowH);
    drawCellText(ctx, "No active bets.", margin, y, width - margin * 2, rowH);
  } else {
    bets.forEach((bet, i) => {
      const placed = bet.players || {};
      const rowColor = i % 2 === 0 ? "#ffffff" : "#f6f6f6";
      const rowValues = [
        shortenText(bet.eventName, 50),
        shortenText(bet.selectionName, 40),
        String(bet.odds || ""),
        ...players.map(player => placed[player] ? "Y" : "-")
      ];

      let rowX = margin;
      cols.forEach((col, idx) => {
        ctx.fillStyle = rowColor;
        ctx.fillRect(rowX, y, col.width, rowH);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(rowX, y, col.width, rowH);
        const align = idx >= 3 ? "center" : "left";
        drawCellText(ctx, rowValues[idx], rowX, y, col.width, rowH, align);
        rowX += col.width;
      });
      y += rowH;
    });
  }

  const outPath = path.join(__dirname, "tracker.png");
  // FIX: Save using canvas stream
  const out = fs.createWriteStream(outPath);
  const stream = canvas.createPNGStream();
  stream.pipe(out);
  
  return new Promise((resolve) => {
    out.on('finish', () => resolve(outPath));
  });
}

// ... rest of your updateTrackerImage, Events, and Login functions remain the same ...

async function updateTrackerImage() {
  try {
    console.log("Fetching sheet data for image tracker...");
    const data = await fetchSheetData();
    const imgPath = await generateTrackerImage(data);
    const channel = await client.channels.fetch(CHANNEL_ID);
    const saved = loadMessageData();

    const oldIds = [];
    if (saved.imageMessageId) oldIds.push(saved.imageMessageId);
    if (saved.messageId) oldIds.push(saved.messageId);
    if (Array.isArray(saved.messageIds)) oldIds.push(...saved.messageIds);

    for (const id of oldIds) {
      try {
        const oldMsg = await channel.messages.fetch(id);
        await oldMsg.delete();
      } catch (e) {}
    }

    const tornTime = getTornTimeString();
    const newMsg = await channel.send({
      content: `**Torn Bookie Tracker**\n**Updated:** ${tornTime} TCT`,
      files: [imgPath]
    });

    saveMessageData({ imageMessageId: newMsg.id });
    console.log("✅ IMAGE TRACKER POSTED");
  } catch (err) {
    console.error("❌ IMAGE TRACKER UPDATE ERROR:", err.message);
  }
}

client.once(Events.ClientReady, async c => {
  console.log(`✅ SUCCESS: ${c.user.tag} IS ONLINE`);
  await updateTrackerImage();
  setInterval(updateTrackerImage, UPDATE_EVERY_MS);
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (message.content.toLowerCase() === "!test") await message.reply("Bot is online! 🚀");
  if (message.content.toLowerCase() === "!update") {
    await message.reply("Updating...");
    await updateTrackerImage();
  }
});

if (DISCORD_TOKEN.length > 50) {
  client.login(DISCORD_TOKEN).catch(err => console.error("❌ LOGIN ERROR:", err.message));
}

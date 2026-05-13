// =============================================================
// TORN BOT - IMAGE TRACKER VERSION (STABLE CANVAS)
// =============================================================

const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const fs = require("fs");
const path = require("path");
const { createCanvas } = require("canvas");

const {
  Client,
  GatewayIntentBits,
  Events
} = require("discord.js");

console.log("--- BOT STARTING UP ---");

// 1. CONFIG LOADER
const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN || "").trim();
const CHANNEL_ID = String(process.env.CHANNEL_ID || "").trim();
const SHEET_URL = String(process.env.SHEET_URL || "").trim();

const MESSAGE_FILE = "message.json";
const UPDATE_EVERY_MS = 60 * 60 * 1000;

// 2. FONT CONFIG (Using System Default)
const TRACKER_FONT = "sans-serif";

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
  try { return JSON.parse(fs.readFileSync(MESSAGE_FILE, "utf8")); } catch { return {}; }
}

function saveMessageData(data) {
  fs.writeFileSync(MESSAGE_FILE, JSON.stringify(data, null, 2));
}

async function fetchSheetData() {
  const fetch = require("node-fetch");
  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`);
  return await res.json();
}

function shortenText(text, max) {
  text = String(text || "");
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function getTornTimeString() {
  return new Date().toLocaleString("en-GB", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
}

function drawCellText(ctx, text, x, y, w, h, align = "left", bold = false) {
  ctx.fillStyle = "#000000";
  ctx.font = bold ? `bold 16pt ${TRACKER_FONT}` : `13pt ${TRACKER_FONT}`;

  const safeText = String(text || "");
  let tx = x + 8;

  if (align === "center") {
    const m = ctx.measureText(safeText);
    tx = x + (w - m.width) / 2;
  } else if (align === "right") {
    const m = ctx.measureText(safeText);
    tx = x + w - m.width - 8;
  }

  ctx.fillText(safeText, tx, y + h / 2 + 7);
}

async function generateTrackerImage(data) {
  const players = data.players || [];
  const bets = data.bets || [];

  const margin = 20;
  const titleH = 50;
  const headerH = 34;
  const rowH = 30;
  const matchW = 390, pickW = 280, oddsW = 70, playerW = 70;

  const width = margin * 2 + matchW + pickW + oddsW + (players.length * playerW);
  const height = margin * 2 + titleH + headerH + Math.max(bets.length, 1) * rowH + 10;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#000000";
  ctx.font = `20pt ${TRACKER_FONT}`;
  ctx.fillText("Torn Bookie Tracker", margin, margin + 22);
  ctx.font = `10pt ${TRACKER_FONT}`;
  ctx.fillText(`Updated: ${getTornTimeString()} TCT`, margin, margin + 40);

  let y = margin + titleH;
  const cols = [
    { label: "Match", width: matchW },
    { label: "Pick", width: pickW },
    { label: "Odds", width: oddsW },
    ...players.map(p => ({ label: p.length > 5 ? p.slice(0,4) : p, width: playerW }))
  ];

  let x = margin;
  for (const col of cols) {
    ctx.fillStyle = "#d9eaf7";
    ctx.fillRect(x, y, col.width, headerH);
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(x, y, col.width, headerH);
    drawCellText(ctx, col.label, x, y, col.width, headerH, "center", true);
    x += col.width;
  }

  y += headerH;
  if (!bets.length) {
    drawCellText(ctx, "No active bets.", margin, y, width - margin * 2, rowH);
  } else {
    bets.forEach((bet, i) => {
      const rowColor = i % 2 === 0 ? "#ffffff" : "#f6f6f6";
      const rowValues = [
        shortenText(bet.eventName, 50),
        shortenText(bet.selectionName, 40),
        String(bet.odds || ""),
        ...players.map(p => (bet.players && bet.players[p]) ? "Y" : "-")
      ];

      let rx = margin;
      rowValues.forEach((val, idx) => {
        ctx.fillStyle = rowColor;
        ctx.fillRect(rx, y, cols[idx].width, rowH);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(rx, y, cols[idx].width, rowH);
        drawCellText(ctx, val, rx, y, cols[idx].width, rowH, idx >= 3 ? "center" : "left");
        rx += cols[idx].width;
      });
      y += rowH;
    });
  }

  const outPath = path.join(__dirname, "tracker.png");
  const out = fs.createWriteStream(outPath);
  canvas.createPNGStream().pipe(out);
  return new Promise(res => out.on('finish', () => res(outPath)));
}

async function updateTrackerImage() {
  try {
    const data = await fetchSheetData();
    const imgPath = await generateTrackerImage(data);
    const channel = await client.channels.fetch(CHANNEL_ID);
    const saved = loadMessageData();

    if (saved.imageMessageId) {
      try {
        const oldMsg = await channel.messages.fetch(saved.imageMessageId);
        await oldMsg.delete();
      } catch (e) {}
    }

    const newMsg = await channel.send({
      content: `**Torn Bookie Tracker**\n**Updated:** ${getTornTimeString()} TCT`,
      files: [imgPath]
    });
    saveMessageData({ imageMessageId: newMsg.id });
    console.log("✅ TRACKER UPDATED");
  } catch (err) {
    console.error("❌ UPDATE ERROR:", err.message);
  }
}

client.once(Events.ClientReady, async c => {
  console.log(`✅ SUCCESS: ${c.user.tag} IS ONLINE`);
  await updateTrackerImage();
  setInterval(updateTrackerImage, UPDATE_EVERY_MS);
});

client.on(Events.MessageCreate, async msg => {
  if (msg.author.bot) return;
  if (msg.content === "!update") {
    await msg.reply("Updating...");
    await updateTrackerImage();
  }
});

client.login(DISCORD_TOKEN).catch(e => console.error("❌ LOGIN ERROR:", e.message));

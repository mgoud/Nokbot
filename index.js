const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const fs = require("fs");
const path = require("path");
const { createCanvas } = require("canvas");
const fetch = require("node-fetch");
const { Client, GatewayIntentBits, Events } = require("discord.js");

console.log("--- BOT STARTING UP ---");

// 1. CONFIG
const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN || "").trim();
const CHANNEL_ID = String(process.env.CHANNEL_ID || "").trim();
const SHEET_URL = String(process.env.SHEET_URL || "").trim();
const MESSAGE_FILE = "message.json";
const UPDATE_EVERY_MS = 60 * 60 * 1000;

// 2. CLIENT SETUP
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// 3. HELPERS
function getTornTime() {
  return new Date().toLocaleString("en-GB", { timeZone: "UTC", hour12: false });
}

async function fetchSheet() {
  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`);
  return await res.json();
}

function drawText(ctx, text, x, y, w, h, align = "left", bold = false) {
  ctx.fillStyle = "#000000";
  ctx.font = bold ? "bold 15pt sans-serif" : "12pt sans-serif";
  let tx = x + 8;
  if (align === "center") tx = x + (w - ctx.measureText(text).width) / 2;
  ctx.fillText(text, tx, y + h / 2 + 6);
}

async function generateImage(data) {
  const players = data.players || [];
  const bets = data.bets || [];
  const width = 800 + (players.length * 70);
  const height = 150 + (Math.max(bets.length, 1) * 30);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#000000";
  ctx.font = "bold 20pt sans-serif";
  ctx.fillText("Torn Bookie Tracker", 20, 40);
  ctx.font = "10pt sans-serif";
  ctx.fillText(`Updated: ${getTornTime()} TCT`, 20, 60);

  let y = 80;
  let x = 20;
  const colW = [350, 250, 80];

  // Headers
  ["Match", "Pick", "Odds", ...players].forEach((label, i) => {
    const w = colW[i] || 70;
    ctx.fillStyle = "#d9eaf7";
    ctx.fillRect(x, y, w, 30);
    ctx.strokeRect(x, y, w, 30);
    drawText(ctx, label.slice(0, 8), x, y, w, 30, "center", true);
    x += w;
  });

  // Rows
  y += 30;
  bets.forEach((bet, i) => {
    x = 20;
    const vals = [bet.eventName, bet.selectionName, String(bet.odds), ...players.map(p => bet.players?.[p] ? "Y" : "-")];
    vals.forEach((v, j) => {
      const w = colW[j] || 70;
      ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#f2f2f2";
      ctx.fillRect(x, y, w, 30);
      ctx.strokeRect(x, y, w, 30);
      drawText(ctx, String(v || "").slice(0, 40), x, y, w, 30, j > 2 ? "center" : "left");
      x += w;
    });
    y += 30;
  });

  const outPath = path.join(__dirname, "tracker.png");
  const out = fs.createWriteStream(outPath);
  canvas.createPNGStream().pipe(out);
  return new Promise(res => out.on('finish', () => res(outPath)));
}

// 4. MAIN LOGIC
async function update() {
  try {
    const data = await fetchSheet();
    const imgPath = await generateImage(data);
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    // Cleanup old messages
    const saved = JSON.parse(fs.readFileSync(MESSAGE_FILE, "utf8").catch(() => "{}"));
    if (saved.lastId) {
      try { (await channel.messages.fetch(saved.lastId)).delete(); } catch(e) {}
    }

    const msg = await channel.send({ content: `**Tracker Updated:** ${getTornTime()} TCT`, files: [imgPath] });
    fs.writeFileSync(MESSAGE_FILE, JSON.stringify({ lastId: msg.id }));
    console.log("✅ Posted to Discord");
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

client.once(Events.ClientReady, () => {
  console.log(`✅ Online as ${client.user.tag}`);
  update();
  setInterval(update, UPDATE_EVERY_MS);
});

client.on(Events.MessageCreate, m => {
  if (m.content === "!update") update() && m.reply("Updating...");
});

client.login(DISCORD_TOKEN);

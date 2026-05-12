// =============================================================
// TORN BOT - TRACKER VERSION
// =============================================================

const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const fs = require("fs");
const { Client, GatewayIntentBits, Events } = require("discord.js");

console.log("--- BOT STARTING UP ---");

// 1. CONFIG LOADER
let config;
try {
  const rawData = fs.readFileSync("config.json", "utf8").replace(/^\uFEFF/, "");
  config = JSON.parse(rawData);
} catch (e) {
  console.error("FATAL: Could not read config.json.");
  process.exit(1);
}

const DISCORD_TOKEN = String(config.DISCORD_TOKEN || "").replace(/["']/g, "").trim();
const CHANNEL_ID = String(config.CHANNEL_ID || "").replace(/["']/g, "").trim();
const SHEET_URL = String(config.SHEET_URL || "").replace(/["']/g, "").trim();

const MESSAGE_FILE = "message.json";
const UPDATE_EVERY_MS = 2 * 60 * 1000;

// 2. CLIENT INITIALIZATION
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 3. HELPER FUNCTIONS
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

function shorten(text, max) {
  text = String(text || "");
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

async function fetchSheetData() {
  const res = await fetch(SHEET_URL);

  if (!res.ok) {
    throw new Error(`Sheet HTTP ${res.status}`);
  }

  return await res.json();
}

function buildTrackerMessage(data) {
  const players = data.players || [];
  const bets = data.bets || [];

  if (!bets.length) {
    return `**Torn Bookie Tracker**\nLast update: ${data.updated || "unknown"}\n\n_No active bets._`;
  }

  const header = ["Event", "Selection", "Odds", ...players];

  const rows = bets.map(bet => {
    const placed = bet.players || {};

    return [
      shorten(bet.eventName, 32),
      shorten(bet.selectionName, 20),
      String(bet.odds || ""),
      ...players.map(player => placed[player] ? "✅" : "❌")
    ];
  });

  const widths = header.map((h, i) => {
    const maxWidth =
      i === 0 ? 32 :
      i === 1 ? 20 :
      i === 2 ? 6 :
      8;

    return Math.min(
      Math.max(String(h).length, ...rows.map(r => String(r[i]).length)),
      maxWidth
    );
  });

  function formatRow(row) {
    return row
      .map((cell, i) => shorten(cell, widths[i]).padEnd(widths[i]))
      .join(" | ");
  }

  let table = "```text\n";
  table += formatRow(header) + "\n";
  table += widths.map(w => "-".repeat(w)).join("-+-") + "\n";
  table += rows.map(formatRow).join("\n");
  table += "\n```";

  let message =
    `**Torn Bookie Tracker**\n` +
    `Last update: ${data.updated || "unknown"}\n\n` +
    table;

  if (message.length > 1900) {
    message = message.slice(0, 1850) + "\n\n...truncated";
  }

  return message;
}

async function upsertTrackerMessage(content) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const saved = loadMessageData();

  if (saved.messageId) {
    try {
      const msg = await channel.messages.fetch(saved.messageId);
      await msg.edit(content);
      console.log("✅ TRACKER MESSAGE EDITED");
      return;
    } catch (err) {
      console.log("Old tracker message not found. Creating a new one.");
    }
  }

  const msg = await channel.send(content);

  saveMessageData({
    messageId: msg.id
  });

  console.log("✅ TRACKER MESSAGE CREATED");
}

async function updateTracker() {
  try {
    console.log("Fetching sheet data...");
    const data = await fetchSheetData();
    const content = buildTrackerMessage(data);
    await upsertTrackerMessage(content);
  } catch (err) {
    console.error("❌ UPDATE ERROR:", err.message);

    try {
      await upsertTrackerMessage(
        `**Torn Bookie Tracker**\n\n⚠️ Error updating tracker:\n\`${err.message}\``
      );
    } catch (innerErr) {
      console.error("❌ COULD NOT POST ERROR MESSAGE:", innerErr.message);
    }
  }
}

// 4. EVENT: READY
client.once(Events.ClientReady, async c => {
  console.log("=========================================");
  console.log(`✅ SUCCESS: ${c.user.tag} IS ONLINE`);
  console.log("=========================================");

  await updateTracker();

  setInterval(updateTracker, UPDATE_EVERY_MS);
});

// 5. EVENT: MESSAGE COMMANDS
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === "!test") {
    message.reply("Bot is online and responding! 🚀");
  }

  if (message.content.toLowerCase() === "!update") {
    await message.reply("Updating tracker now...");
    await updateTracker();
  }
});

// 6. LOGIN
if (DISCORD_TOKEN.length > 50) {
  console.log("Connecting to Discord Gateway...");
  client.login(DISCORD_TOKEN).catch(err => {
    console.error("❌ LOGIN ERROR:", err.message);
  });
} else {
  console.error("❌ INVALID TOKEN in config.json");
}

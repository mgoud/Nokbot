import os
import re
import json
import time
import asyncio
from typing import Dict, List, Tuple

import aiohttp
import discord
from discord.ext import tasks, commands

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
TORN_API_KEY = os.getenv("TORN_API_KEY")
CHANNEL_ID = int(os.getenv("CHANNEL_ID", "0"))

STATE_FILE = "state.json"

TORN_LOG_URL = "https://api.torn.com/user/?selections=log&cat={cat}&key={key}&to={to_ts}"
BOOKIE_CAT = 195  # common "Bookie" log category

PLACED_RE = re.compile(r"You placed a \$(?P<stake>[\d,]+).*?bet in the Bookie on (?P<rest>.+)$")
WON_RE    = re.compile(r"You won \$(?P<winnings>[\d,]+).*?bet in the Bookie on (?P<rest>.+)$")
LOST_RE   = re.compile(r"You lost \$(?P<stake>[\d,]+).*?bet in the Bookie on (?P<rest>.+)$")

intents = discord.Intents.default()
intents.message_content = True  # needed for prefix commands in most bots now

bot = commands.Bot(command_prefix="!", intents=intents)

update_lock = asyncio.Lock()

def load_state() -> Dict:
    if not os.path.exists(STATE_FILE):
        return {}
    with open(STATE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_state(state: Dict) -> None:
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)

async def torn_fetch_bookie_logs(session: aiohttp.ClientSession, to_ts: int) -> Dict:
    url = TORN_LOG_URL.format(cat=BOOKIE_CAT, key=TORN_API_KEY, to_ts=to_ts)
    async with session.get(url, timeout=20) as resp:
        data = await resp.json()
    if isinstance(data, dict) and "error" in data:
        raise RuntimeError(f"Torn API error {data['error'].get('code')}: {data['error'].get('error')}")
    return data

def extract_active_bets_from_logs(log_blob: Dict) -> List[str]:
    log = log_blob.get("log") or {}
    entries: List[Tuple[int, str]] = []

    for _, v in log.items():
        ts = int(v.get("timestamp", 0))
        text = (v.get("title") or "") + " " + (v.get("data") or "")
        text = text.strip()
        if text:
            entries.append((ts, text))

    entries.sort(key=lambda x: x[0], reverse=True)

    placed: Dict[str, str] = {}
    resolved: set[str] = set()

    for _, text in entries:
        m = PLACED_RE.search(text)
        if m:
            stake = m.group("stake")
            rest = m.group("rest").strip()
            k = rest.lower()
            placed[k] = f"• **${stake}** — {rest}"
            continue

        m = WON_RE.search(text)
        if m:
            rest = m.group("rest").strip()
            resolved.add(rest.lower())
            continue

        m = LOST_RE.search(text)
        if m:
            rest = m.group("rest").strip()
            resolved.add(rest.lower())
            continue

    return [v for k, v in placed.items() if k not in resolved]

async def upsert_message(channel: discord.TextChannel, content: str) -> None:
    state = load_state()
    msg_id = state.get("message_id")

    if msg_id:
        try:
            msg = await channel.fetch_message(int(msg_id))
            await msg.edit(content=content)
            return
        except Exception:
            pass

    msg = await channel.send(content)
    state["message_id"] = msg.id
    save_state(state)

async def do_update(channel: discord.TextChannel) -> str:
    """
    Updates the pinned/editable message and returns a short status string.
    """
    if not TORN_API_KEY:
        return "Missing TORN_API_KEY."

    now = int(time.time())

    try:
        async with aiohttp.ClientSession() as session:
            data = await torn_fetch_bookie_logs(session, to_ts=now)
            active = extract_active_bets_from_logs(data)

        if active:
            body = "\n".join(active[:30])
        else:
            body = "_No active bets detected from recent Bookie logs._"

        content = (
            f"**Torn – Active Bookie Bets**\n"
            f"Last update: <t:{now}:f>\n\n"
            f"{body}\n\n"
            f"_Edits this message every hour. Use `!updatebets` to refresh now._"
        )

    except Exception as e:
        content = (
            f"**Torn – Active Bookie Bets**\n"
            f"Last update: <t:{now}:f>\n\n"
            f"⚠️ Error pulling/parsing logs: `{e}`"
        )

    await upsert_message(channel, content)
    return "Updated."

@tasks.loop(hours=1)
async def hourly_update():
    if not CHANNEL_ID:
        return
    channel = bot.get_channel(CHANNEL_ID)
    if channel is None or not isinstance(channel, discord.TextChannel):
        return

    async with update_lock:
        await do_update(channel)

@bot.event
async def on_ready():
    print(f"Logged in as {bot.user} (id={bot.user.id})")
    if not hourly_update.is_running():
        hourly_update.start()

    # do an immediate update at startup
    if CHANNEL_ID:
        channel = bot.get_channel(CHANNEL_ID)
        if channel and isinstance(channel, discord.TextChannel):
            async with update_lock:
                await do_update(channel)

@bot.command(name="updatebets")
@commands.cooldown(1, 30, commands.BucketType.guild)  # 1 use per 30s per server
async def updatebets(ctx: commands.Context):
    """
    Manually refresh the bets post.
    """
    # optional: restrict who can run it
    # if not ctx.author.guild_permissions.manage_guild:
    #     return await ctx.reply("Nope 🙂 (need Manage Server)")

    async with update_lock:
        status = await do_update(ctx.channel)

    await ctx.reply(status, mention_author=False)

@updatebets.error
async def updatebets_error(ctx: commands.Context, error):
    if isinstance(error, commands.CommandOnCooldown):
        await ctx.reply(f"Cooldown: try again in {error.retry_after:.0f}s.", mention_author=False)
    else:
        await ctx.reply(f"Error: `{error}`", mention_author=False)

if __name__ == "__main__":
    if not DISCORD_TOKEN:
        raise SystemExit("Missing DISCORD_TOKEN env var")
    bot.run(DISCORD_TOKEN)

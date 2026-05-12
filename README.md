# Nokbot

A Discord bot that tracks active Bookie bets from the Torn API and displays them in a Discord channel.

## Features

- Fetches Bookie bet logs from the Torn API
- Displays active (unresolved) bets in a Discord channel
- Automatically updates every hour
- Manual refresh with `!updatebets` command
- Edits the same message to keep the channel clean

## Setup

### Prerequisites

- Python 3.8+
- A Discord bot token
- A Torn API key
- A Discord channel ID where the bot will post

### Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Fill in your `.env` file with:
   - `DISCORD_TOKEN`: Your Discord bot token
   - `TORN_API_KEY`: Your Torn API key
   - `CHANNEL_ID`: The Discord channel ID where bets will be posted

### Running Locally

```bash
python main.py
```

### Deploying to Railway

1. Push this repository to GitHub
2. Go to [Railway.app](https://railway.app)
3. Create a new project and connect your GitHub repository
4. Railway will detect it's a Python app
5. Add environment variables in Railway dashboard:
   - `DISCORD_TOKEN`
   - `TORN_API_KEY`
   - `CHANNEL_ID`
6. Deploy!

## Commands

- `!updatebets` - Manually refresh the active bets message (30s cooldown per server)

## How It Works

1. Fetches Bookie logs from Torn API
2. Extracts "placed" bets
3. Filters out bets that have been won or lost
4. Updates or creates a message in the specified Discord channel
5. Repeats every hour (or on manual command)

## Notes

- The bot creates a `state.json` file to remember the message ID it posted
- Only shows up to 30 active bets to avoid message length limits
- Has a 30-second cooldown on the `!updatebets` command per server

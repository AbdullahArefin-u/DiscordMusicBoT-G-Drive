# Discord Music Bot with Google Drive Integration

A Discord bot that plays music from multiple Google Drive folders with 24/7 voice channel presence.

## Features
- Play audio files from multiple Google Drive folders
- Add and manage your own music folders
- Support for folders from any Google Drive account
- Optional default folder configuration
- 24/7 voice channel presence
- Slash commands support
- Embedded messages showing current playing song
- Auto-queue system with shuffle
- Reaction controls for playback

## Setup Instructions

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory with the following variables:
```
DISCORD_TOKEN=your_discord_bot_token
DEFAULT_FOLDER_ID=your_default_folder_id (optional)
```

3. Set up Google Drive API:
   - Go to Google Cloud Console (https://console.cloud.google.com)
   - Create a new project
   - Enable the Google Drive API
   - Go to "Credentials"
   - Create a Service Account
   - Download the service account key file
   - Rename the key file to `service-account.json` and place it in the bot's root directory

4. Set up Discord Bot:
   - Go to Discord Developer Portal
   - Create a new application
   - Create a bot
   - Enable necessary intents (Message Content, Server Members, Voice States)
   - Copy the bot token
   - Enable the "applications.commands" scope when inviting the bot

5. Run the bot:
```bash
npm start
```

## Adding Folders from Any Google Drive Account

1. Get the service account email from your `service-account.json` file (look for "client_email")
2. For each folder you want to add:
   - Open the folder in Google Drive
   - Click "Share"
   - Add the service account email with "Viewer" access
   - Click the "Share" button
   - Copy the folder ID from the URL (it's the long string after /folders/ in the URL)
   - Use `/addfolder` command with a name and the folder ID

Example folder URL:
```
https://drive.google.com/drive/folders/1A2B3C4D5E6F7G8H9I0J (folder ID is "1A2B3C4D5E6F7G8H9I0J")
```

## Default Folder Configuration
You can set up a default folder that will be used when no other folders are available:
1. Get your folder ID from Google Drive
2. Add it to your `.env` file as `DEFAULT_FOLDER_ID`
3. The bot will automatically use this folder if no other folders are added
4. The default folder will appear as "default" in the folder list

## Commands
- `/addfolder <name> <id>` - Add a new Google Drive folder (get the folder ID from the folder's share link)
- `/removefolder <name>` - Remove a folder
- `/listfolders` - Show all available folders
- `/join` - Bot joins your voice channel
- `/play <folder>` - Start playing songs from the specified folder (folder name is optional if using default folder)
- `/pause` - Pause current song
- `/resume` - Resume paused song
- `/skip` - Skip current song

## Reaction Controls
- ▶️ - Resume playback
- ⏸️ - Pause playback
- ⏭️ - Skip current song
- ⏹️ - Stop playback and clear queue

## Made by Abdullah Arefin
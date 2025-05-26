# 🎵 Discord Music Bot

A feature-rich Discord music bot that plays music from Google Drive folders with an interactive interface and detailed statistics.

## ✨ Features

### 🎵 Music Playback
- Play music from Google Drive folders
- Interactive music controls (play, pause, skip, previous)
- Queue management with song selection
- Loop mode support
- Previous songs history

### 📁 Folder Management
- Add multiple Google Drive folders
- Private folders (only visible to you)
- Option to share folders globally
- Easy folder selection interface
- Secure folder management (owner-only removal)
- Cooldown system for folder additions
- Visual indicators for private/global folders

### 📊 Statistics & Information
- Detailed bot statistics with categories:
  - Bot Information
  - Global Statistics
  - Music Stats
  - Host Device Info
  - Memory Usage
  - Process Information
- Interactive category selection

### 🎮 Interactive Controls
- Button-based music controls
- Dropdown menus for folder and song selection
- Ephemeral messages for clean chat
- Error handling and user feedback

## 🚀 Setup

### Prerequisites
- Node.js v16.9.0 or higher
- Discord Bot Token
- Google Drive API credentials

### Installation
1. Clone the repository
```bash
git clone <repository-url>
cd discord-music-bot
```

2. Install dependencies
```bash
npm install
```

3. Create a `.env` file with the following:
```env
DISCORD_TOKEN=your_discord_bot_token
DEFAULT_FOLDER_ID=your_default_folder_id (optional)
```

4. Set up Google Drive API:
   - Create a project in Google Cloud Console
   - Enable Google Drive API
   - Create service account credentials
   - Download the credentials as `service-account.json`
   - Place `service-account.json` in the bot's root directory

5. Start the bot
```bash
npm start
```

## 📝 Commands

### Music Commands
- `/join` - Join your voice channel
- `/play` - Choose and play music from folders
- `/pause` - Pause current playback
- `/resume` - Resume playback
- `/skip` - Skip to next song
- `/stop` - Stop playback and clear queue

### Folder Management
- `/addfolder <name> <id> [global]` - Add a new Google Drive folder
  - `name`: Name for the folder
  - `id`: Google Drive folder ID
  - `global`: (Optional) Make the folder available to everyone
- `/removefolder <name>` - Remove your folder
- `/listfolders` - Show all available folders (your private folders and global folders)

### Information
- `/stats` - Show detailed bot statistics
- `/help` - Display all available commands

## 🎮 Interactive Controls

### Music Control Buttons
- ⏮️ Previous - Play previous song
- ⏯️ Play/Pause - Toggle playback
- ⏭️ Skip - Skip current song
- ⏹️ Stop - Stop playback
- 🔄 Loop - Toggle loop mode
- 📋 Queue - View and manage queue

### Dropdown Menus
- Folder Selection - Choose music folder
- Queue Management - Select songs from queue
- Statistics Categories - View different stat categories

## 🛠️ Technical Details

### Built With
- [Discord.js](https://discord.js.org/) - Discord API wrapper
- [@discordjs/voice](https://github.com/discordjs/voice) - Voice support
- [Google APIs](https://github.com/googleapis/google-api-nodejs-client) - Google Drive integration

### System Requirements
- Operating System: Windows/Linux/macOS
- RAM: 512MB minimum
- Storage: 100MB minimum
- Internet: Stable connection required

## 🔒 Security

- Owner-only sensitive commands
- User-specific private folders
- Optional global folder sharing
- Cooldown system for folder additions
- Secure Google Drive API integration
- No sensitive data exposure

## 📋 Notes

- Private folders are only visible to the user who added them
- Global folders are visible to everyone
- Users can only remove their own folders (except bot owner)
- Default system folders are always global
- Ensure the bot has proper permissions in Discord server
- Share Google Drive folders with the service account email
- Keep your tokens and credentials secure
- Regular updates recommended for security

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Discord.js community
- Google APIs Node.js Client
- Contributors and testers
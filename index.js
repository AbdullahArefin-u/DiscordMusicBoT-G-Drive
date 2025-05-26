require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ApplicationCommandType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, version: discordJSVersion, ActivityType, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, getVoiceConnection } = require('@discordjs/voice');
const { google } = require('googleapis');
const { Readable } = require('stream');
const fs = require('fs');
const os = require('os');

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
    ]
});

// Define slash commands
const commands = [
    {
        name: 'join',
        description: 'Join your voice channel',
        type: ApplicationCommandType.ChatInput,
    },
    {
        name: 'play',
        description: 'Choose a folder and play music',
        type: ApplicationCommandType.ChatInput,
    },
    {
        name: 'addfolder',
        description: 'Add a new Google Drive folder',
        type: ApplicationCommandType.ChatInput,
        options: [
            {
                name: 'name',
                description: 'Name for the folder',
                type: 3, // STRING
                required: true
            },
            {
                name: 'id',
                description: 'Google Drive folder ID',
                type: 3, // STRING
                required: true
            },
            {
                name: 'global',
                description: 'Make this folder available to everyone (optional)',
                type: 5, // BOOLEAN
                required: false
            }
        ]
    },
    {
        name: 'removefolder',
        description: 'Remove a Google Drive folder',
        type: ApplicationCommandType.ChatInput,
        options: [
            {
                name: 'name',
                description: 'Name of the folder to remove',
                type: 3, // STRING
                required: true
            }
        ]
    },
    {
        name: 'listfolders',
        description: 'List all available folders',
        type: ApplicationCommandType.ChatInput,
    },
    {
        name: 'pause',
        description: 'Pause the current song',
        type: ApplicationCommandType.ChatInput,
    },
    {
        name: 'resume',
        description: 'Resume the paused song',
        type: ApplicationCommandType.ChatInput,
    },
    {
        name: 'skip',
        description: 'Skip to the next song',
        type: ApplicationCommandType.ChatInput,
    },
    {
        name: 'stats',
        description: 'Show bot and server statistics',
        type: ApplicationCommandType.ChatInput,
    },
    {
        name: 'help',
        description: 'Show all available commands and how to use them',
        type: ApplicationCommandType.ChatInput,
    },
];

// Define emoji controls
const CONTROLS = {
    PLAY: '▶️',
    PAUSE: '⏸️',
    SKIP: '⏭️',
    STOP: '⏹️'
};

// Define custom emojis
const CUSTOM_EMOJIS = {
    PLAY: '<:play:1376088659656314990>',  // Replace with your actual emoji ID
    PAUSE: '<:pause:1376088651267706930>',
    SKIP: '<:skip:1376088739163410542>',
    STOP: '<a:stop:1376088848563437700>',
    PREVIOUS: '<:previous:1376088687028207658>',  // Previous button emoji
    SUCCESS: '<:success:1376088866330509423>',
    ERROR: '<:error:1376088590991360110>',
    INFO: '<:info:1376088618178973776>',
    MUSIC: '<:music:1376088642002354267>',
    QUEUE: '<:qu:1376088707479900241>',
    SHUFFLE: '<:shuffle:1376088726626631710>',
    VOLUME: '<:volume1:1376088905471758427>',
    SPOTIFY: '<:Spotify:1376088835116761138>',
    YOUTUBE: '<:youtube:1376088546389000344>',
    SOUNDCLOUD: '<:Soundcloud:1376088811993567275>',
    CONNECTED: '<:connected:1376088576030277673>',
    JOINVC: '<:joinvc:1376088631168467074>',
    HEADPHONES: '<a:headphones:1376088600877203530>',
    INFINITY: '<a:infinity:1376088609488375839>',
    LOOP: '<a:loop:1376088566404218952>',
    TRASH: '<:trash:1376088882369663046>',
    WARNING: '<:warnings:1376088965366546432>'
};

let currentPlayingMessage = null;

// Add before the commands handling
const DISMISS_BUTTON_ID = 'dismiss_message';

// Add at the top with other global variables
const userCooldowns = new Map();
const COOLDOWN_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds

// Add a flag to track if we're currently processing a skip
let isProcessingSkip = false;
let skipInProgress = false;

// Add global variables for loop state
let isLooping = false;
let previousSongs = [];  // Store previous songs for the previous button

// Add helper function for cooldown check
function checkCooldown(userId) {
    const now = Date.now();
    const cooldownInfo = userCooldowns.get(userId);
    
    if (cooldownInfo) {
        const timeLeft = cooldownInfo.timestamp + COOLDOWN_DURATION - now;
        if (timeLeft > 0) {
            // Calculate remaining time
            const days = Math.floor(timeLeft / (24 * 60 * 60 * 1000));
            const hours = Math.floor((timeLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
            const minutes = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
            return { onCooldown: true, timeLeft: `${days}d ${hours}h ${minutes}m` };
        }
    }
    return { onCooldown: false };
}

// Function to register slash commands
async function registerCommands() {
    try {
        console.log('Started refreshing application (/) commands.');
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        // Get the client ID from the bot user
        const clientId = client.user.id;
        
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Initialize Google Drive with service account
const auth = new google.auth.GoogleAuth({
    keyFile: 'service-account.json',
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
});

const drive = google.drive({ version: 'v3', auth });

let queue = [];
let currentSong = null;
let player = createAudioPlayer();
let connection = null;
let currentChannel = null;

// Initialize emoji IDs when bot starts
client.once('ready', async () => {
    console.log('Bot is ready!');
    
    // Set bot status
    client.user.setActivity('/join | /play', { type: ActivityType.Playing });
    
    // Log environment check
    console.log('Checking environment configuration...');
    if (process.env.DEFAULT_FOLDER_ID) {
        console.log(`Default folder ID found: ${process.env.DEFAULT_FOLDER_ID}`);
    } else {
        console.log('No default folder ID configured in .env');
    }

    // Initialize folders and check default folder
    const folders = loadFolders();
    console.log('Current folders:', Object.keys(folders));
    
    if (folders.default) {
        console.log('Testing default folder access...');
        const testLoad = await loadSongsFromDrive(folders.default.id);
        console.log(`Found ${testLoad.length} songs in default folder`);
    }

    await registerCommands();
});

// Folder management functions
function loadFolders() {
    try {
        let folders = {};
        
        // Try to read existing folders
        try {
            const data = fs.readFileSync('folders.json', 'utf8');
            const loadedData = JSON.parse(data);
            
            // Convert old format to new format if necessary
            if (loadedData.folders) {
                Object.entries(loadedData.folders).forEach(([name, value]) => {
                    if (typeof value === 'string') {
                        // Old format, convert to new
                        folders[name] = {
                            id: value,
                            addedBy: null,
                            addedAt: Date.now(),
                            isGlobal: false
                        };
                    } else {
                        // New format, use as is
                        folders[name] = value;
                    }
                });
            }
        } catch (error) {
            console.log('No existing folders.json found or invalid format');
        }
        
        // Check for default folder
        if (process.env.DEFAULT_FOLDER_ID) {
            if (Object.keys(folders).length === 0 || !folders.default) {
                console.log('Adding default folder from environment');
                folders.default = {
                    id: process.env.DEFAULT_FOLDER_ID,
                    addedBy: 'system',
                    addedAt: Date.now(),
                    isGlobal: true
                };
                saveFolders(folders);
            }
        }
        
        return folders;
    } catch (error) {
        console.error('Error in loadFolders:', error);
        if (process.env.DEFAULT_FOLDER_ID) {
            const folders = { 
                default: {
                    id: process.env.DEFAULT_FOLDER_ID,
                    addedBy: 'system',
                    addedAt: Date.now(),
                    isGlobal: true
                }
            };
            saveFolders(folders);
            return folders;
        }
        return {};
    }
}

function saveFolders(folders) {
    try {
        fs.writeFileSync('folders.json', JSON.stringify({ folders }, null, 4));
        console.log('Saved folders:', Object.keys(folders));
    } catch (error) {
        console.error('Error saving folders:', error);
    }
}

// Load songs from a specific Google Drive folder
async function loadSongsFromDrive(folderId) {
    try {
        if (!folderId) {
            console.error('No folder ID provided to loadSongsFromDrive');
            return [];
        }
        
        console.log(`Loading songs from folder: ${folderId}`);
        const response = await drive.files.list({
            q: `'${folderId}' in parents and (mimeType contains 'audio/' or mimeType contains 'video/')`,
            fields: 'files(id, name)',
            orderBy: 'name'  // Sort by name in Google Drive API
        });

        // Sort files by name for consistent ordering
        const sortedFiles = response.data.files.sort((a, b) => a.name.localeCompare(b.name));
        console.log(`Found ${sortedFiles.length} songs in folder ${folderId}`);
        return sortedFiles;
    } catch (error) {
        console.error(`Error loading songs from folder ${folderId}:`, error);
        return [];
    }
}

// Helper function to get formatted date and time
function getFormattedDateTime() {
    const now = new Date();
    return now.toLocaleString('en-US', { 
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

// Play audio function
async function playAudio(fileId, fileName, channel) {
    try {
        const response = await drive.files.get({
            fileId: fileId,
            alt: 'media'
        }, { responseType: 'stream' });

        const resource = createAudioResource(response.data);
        player.play(resource);
        currentSong = { id: fileId, name: fileName };

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle(`${CUSTOM_EMOJIS.MUSIC} Now Playing`)
            .setDescription(fileName)
            .addFields(
                { name: 'Queue Position', value: `Current: ${queue.length} songs remaining` },
                { name: 'Loop', value: isLooping ? 'Enabled 🔄' : 'Disabled ➡️' }
            )
            .setFooter({ 
                text: `</> JoY • ${getFormattedDateTime()}`,
                iconURL: client.user.displayAvatarURL()
            });

        // Delete previous playing message if it exists
        if (currentPlayingMessage) {
            try {
                await currentPlayingMessage.delete();
            } catch (error) {
                console.error('Error deleting previous message:', error);
            }
        }

        // Create components array
        const components = createControlButtons(false);
        const queueMenu = createQueueSelectMenu();
        if (queueMenu) {
            components.push(queueMenu);
        }

        // Create and send new message with buttons
        currentPlayingMessage = await channel.send({
            embeds: [embed],
            components: components
        });
    } catch (error) {
        console.error('Error playing file:', error);
        const errorEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle(`${CUSTOM_EMOJIS.ERROR} Error`)
            .setDescription('Error playing the file.')
            .setFooter({ 
                text: `</> JoY • ${getFormattedDateTime()}`,
                iconURL: client.user.displayAvatarURL()
            });
        await channel.send({ embeds: [errorEmbed] }).catch(console.error);
    }
}

// Function to generate stats embeds
function generateStatsEmbed(category) {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const cpus = os.cpus();
    const cpuModel = cpus[0].model;
    const cpuSpeed = cpus[0].speed;
    const platform = os.platform();
    const arch = os.arch();
    
    // Calculate average CPU usage
    const cpuUsage = cpus.reduce((acc, cpu) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b);
        const idle = cpu.times.idle;
        return acc + ((total - idle) / total) * 100;
    }, 0) / cpus.length;

    // Get bot statistics
    const totalGuilds = client.guilds.cache.size;
    const totalMembers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
    const totalChannels = client.channels.cache.size;
    const shardPing = client.ws.ping;
    
    // Get voice connection statistics
    const activeConnections = client.voice.adapters.size;
    const totalVoiceChannels = client.channels.cache.filter(c => c.type === 2).size;

    // Define all stat fields
    const statFields = {
        bot: { 
            name: '🤖 Bot Info',
            value: [
                `**Discord.js:** v${discordJSVersion}`,
                `**Node.js:** ${process.version}`,
                `**Uptime:** ${formatUptime(client.uptime)}`,
                `**WebSocket Ping:** ${shardPing}ms`
            ].join('\n')
        },
        global: {
            name: '🌐 Global Statistics',
            value: [
                `**Servers:** ${totalGuilds}`,
                `**Total Members:** ${totalMembers}`,
                `**Total Channels:** ${totalChannels}`,
                `**Voice Channels:** ${totalVoiceChannels}`
            ].join('\n')
        },
        music: {
            name: '🎵 Music Stats',
            value: [
                `**Queue Length:** ${queue.length} songs`,
                `**Player Status:** ${player.state.status}`,
                `**Loop Mode:** ${isLooping ? 'Enabled' : 'Disabled'}`,
                `**Active Voice Connections:** ${activeConnections}`,
                `**Previous Songs:** ${previousSongs.length}`
            ].join('\n')
        },
        host: {
            name: '💻 Host Device Info',
            value: [
                `**OS:** ${platform} ${arch}`,
                `**CPU:** ${cpuModel}`,
                `**CPU Speed:** ${cpuSpeed}MHz`,
                `**CPU Usage:** ${cpuUsage.toFixed(2)}%`,
                `**CPU Cores:** ${cpus.length}`
            ].join('\n')
        },
        memory: {
            name: '💾 Memory Usage',
            value: [
                `**Total RAM:** ${formatBytes(totalMemory)}`,
                `**Used RAM:** ${formatBytes(usedMemory)} (${((usedMemory / totalMemory) * 100).toFixed(2)}%)`,
                `**Free RAM:** ${formatBytes(freeMemory)}`,
                `**Process Memory:** ${formatBytes(process.memoryUsage().heapUsed)}`
            ].join('\n')
        },
        process: {
            name: '⚡ Process Info',
            value: [
                `**Process ID:** ${process.pid}`,
                `**Process Platform:** ${process.platform}`,
                `**Process Version:** ${process.version}`,
                `**Process Uptime:** ${formatUptime(process.uptime() * 1000)}`
            ].join('\n')
        }
    };

    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle(`${CUSTOM_EMOJIS.INFO} Bot Statistics${category !== 'overview' ? ` - ${statFields[category].name}` : ''}`);

    if (category === 'overview') {
        embed.addFields(Object.values(statFields));
    } else {
        embed.addFields(statFields[category]);
    }

    embed.setFooter({ 
        text: `</> JoY • ${getFormattedDateTime()}`,
        iconURL: client.user.displayAvatarURL()
    });

    return embed;
}

// Function to create stats select menu
function createStatsSelectMenu(selectedCategory = 'overview') {
    return new StringSelectMenuBuilder()
        .setCustomId('stats_category')
        .setPlaceholder('Select a category to view')
        .addOptions([
            {
                label: 'Overview',
                description: 'Show all statistics',
                value: 'overview',
                emoji: '📊',
                default: selectedCategory === 'overview'
            },
            {
                label: 'Bot Info',
                description: 'Basic bot information',
                value: 'bot',
                emoji: '🤖',
                default: selectedCategory === 'bot'
            },
            {
                label: 'Global Stats',
                description: 'Server and member statistics',
                value: 'global',
                emoji: '🌐',
                default: selectedCategory === 'global'
            },
            {
                label: 'Music Stats',
                description: 'Music player information',
                value: 'music',
                emoji: '🎵',
                default: selectedCategory === 'music'
            },
            {
                label: 'Host Info',
                description: 'Host device information',
                value: 'host',
                emoji: '💻',
                default: selectedCategory === 'host'
            },
            {
                label: 'Memory Usage',
                description: 'RAM and memory statistics',
                value: 'memory',
                emoji: '💾',
                default: selectedCategory === 'memory'
            },
            {
                label: 'Process Info',
                description: 'Process information',
                value: 'process',
                emoji: '⚡',
                default: selectedCategory === 'process'
            }
        ]);
}

// Handle all interactions (slash commands, buttons, and select menus)
client.on('interactionCreate', async interaction => {
    try {
        // Handle slash commands
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'join': {
                    await interaction.deferReply();
                    const voiceChannel = interaction.member.voice.channel;
                    
                    if (!voiceChannel) {
                        await interaction.editReply('Please join a voice channel first!');
                        return;
                    }

                    try {
                        // Check for existing connection and destroy it
                        const existingConnection = getVoiceConnection(interaction.guildId);
                        if (existingConnection) {
                            existingConnection.destroy();
                        }

                        // Create new connection
                        connection = joinVoiceChannel({
                            channelId: voiceChannel.id,
                            guildId: voiceChannel.guild.id,
                            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                            selfDeaf: false
                        });

                        // Set up connection state handlers
                        connection.on(VoiceConnectionStatus.Ready, () => {
                            console.log('Voice Connection is ready!');
                        });

                        connection.on(VoiceConnectionStatus.Disconnected, async () => {
                            try {
                                await Promise.race([
                                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                                ]);
                            } catch (error) {
                                connection.destroy();
                            }
                        });

                        // Wait for connection to be ready
                        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
                        connection.subscribe(player);
                        currentChannel = interaction.channel;
                        
                        await interaction.editReply('Successfully joined the voice channel!');
                    } catch (error) {
                        console.error('Error joining voice channel:', error);
                        connection?.destroy();
                        await interaction.editReply('Failed to join voice channel. Please try again.');
                    }
                    break;
                }

                case 'play': {
                    await interaction.deferReply({ ephemeral: true });
                    
                    if (!connection) {
                        await interaction.editReply('Use /join first!');
                        return;
                    }

                    const folders = loadFolders();
                    
                    if (Object.keys(folders).length === 0) {
                        await interaction.editReply('No folders available. Please add a folder using /addfolder command.');
                        return;
                    }

                    try {
                        const select = new StringSelectMenuBuilder()
                            .setCustomId('folder_select')
                            .setPlaceholder('Choose a folder to play from')
                            .setMinValues(1)
                            .setMaxValues(1);

                        Object.entries(folders).forEach(([folderName, folderData]) => {
                            select.addOptions({
                                label: folderName,
                                description: `Added by ${folderData.addedBy ? `<@${folderData.addedBy}>` : 'Unknown'}`,
                                value: folderName,
                                emoji: '📁'
                            });
                        });

                        const row = new ActionRowBuilder().addComponents(select);

                        const embed = new EmbedBuilder()
                            .setColor('#00FF00')
                            .setTitle(`${CUSTOM_EMOJIS.MUSIC} Select Music Folder`)
                            .setDescription('Choose a folder to play music from:')
                            .addFields(
                                { name: 'Requested By', value: `<@${interaction.user.id}>` }
                            )
                            .setFooter({ 
                                text: `</> JoY • ${getFormattedDateTime()}`,
                                iconURL: client.user.displayAvatarURL()
                            });

                        await interaction.editReply({
                            embeds: [embed],
                            components: [row]
                        });
                    } catch (error) {
                        console.error('Error creating folder selection menu:', error);
                        await interaction.editReply('An error occurred while creating the folder selection menu.');
                    }
                    break;
                }

                case 'addfolder': {
                    await interaction.deferReply({ ephemeral: true });
                    
                    const userId = interaction.user.id;
                    const isOwner = userId === '1067394668687536160';
                    
                    // Check cooldown only for non-owner users
                    if (!isOwner) {
                        const cooldownStatus = checkCooldown(userId);
                        if (cooldownStatus.onCooldown) {
                            const embed = new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle(`${CUSTOM_EMOJIS.ERROR} Cooldown Active`)
                                .setDescription(`You can add another folder in: ${cooldownStatus.timeLeft}`)
                                .setFooter({ 
                                    text: `</> JoY • ${getFormattedDateTime()}`,
                                    iconURL: client.user.displayAvatarURL()
                                });
                            
                            await interaction.editReply({ embeds: [embed] });
                            return;
                        }
                    }

                    const name = interaction.options.getString('name');
                    const folderId = interaction.options.getString('id');
                    const makeGlobal = interaction.options.getBoolean('global') || false;
                    
                    const folders = loadFolders();
                    if (folders[name]) {
                        await interaction.editReply(`A folder with the name "${name}" already exists!`);
                        return;
                    }

                    try {
                        const testLoad = await loadSongsFromDrive(folderId);
                        if (testLoad.length === 0) {
                            await interaction.editReply('No audio files found in this folder. Make sure the folder ID is correct and contains audio files.');
                            return;
                        }

                        folders[name] = {
                            id: folderId,
                            addedBy: userId,
                            addedAt: Date.now(),
                            isGlobal: makeGlobal
                        };
                        saveFolders(folders);

                        // Set cooldown only for non-owner users
                        if (!isOwner) {
                            userCooldowns.set(userId, {
                                timestamp: Date.now(),
                                folderName: name
                            });
                        }

                        const embed = new EmbedBuilder()
                            .setColor('#00FF00')
                            .setTitle(`${CUSTOM_EMOJIS.SUCCESS} Folder Added Successfully`)
                            .setDescription(`Folder "${name}" has been added with ${testLoad.length} songs!`)
                            .addFields(
                                { name: 'Folder Name', value: name },
                                { name: 'Number of Songs', value: testLoad.length.toString() },
                                { name: 'Added By', value: `<@${interaction.user.id}>` },
                                { name: 'Visibility', value: makeGlobal ? '🌐 Global' : '🔒 Private' },
                                { name: 'Next Folder Add', value: isOwner ? 'No cooldown (Bot Owner)' : '7 days from now' }
                            )
                            .setFooter({ 
                                text: `</> JoY • ${getFormattedDateTime()}`,
                                iconURL: client.user.displayAvatarURL()
                            });

                        await interaction.editReply({ embeds: [embed] });
                    } catch (error) {
                        console.error('Error accessing folder:', error);
                        await interaction.editReply('Error accessing the folder. Make sure the folder ID is correct and the folder is shared with the bot\'s service account.');
                    }
                    break;
                }

                case 'removefolder': {
                    const name = interaction.options.getString('name');
                    const userId = interaction.user.id;
                    const folders = loadFolders();
                    
                    if (!folders[name]) {
                        await interaction.reply({
                            content: `No folder found with the name "${name}"`,
                            ephemeral: true
                        });
                        return;
                    }

                    // Check if user has permission to remove the folder
                    if (folders[name].addedBy !== userId && userId !== '1067394668687536160') {
                        await interaction.reply({
                            content: `${CUSTOM_EMOJIS.ERROR} You can only remove folders that you added!`,
                            ephemeral: true
                        });
                        return;
                    }

                    delete folders[name];
                    saveFolders(folders);

                    const embed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle(`${CUSTOM_EMOJIS.SUCCESS} Folder Removed`)
                        .setDescription(`Successfully removed folder "${name}"`)
                        .addFields(
                            { name: 'Removed By', value: `<@${interaction.user.id}>` }
                        )
                        .setFooter({ 
                            text: `</> JoY • ${getFormattedDateTime()}`,
                            iconURL: client.user.displayAvatarURL()
                        });

                    await interaction.reply({
                        embeds: [embed],
                        ephemeral: true
                    });
                    break;
                }

                case 'listfolders': {
                    const folders = loadFolders();
                    const userId = interaction.user.id;
                    const isOwner = userId === '1067394668687536160';
                    
                    // For bot owner, show all folders. For others, filter accessible folders
                    const accessibleFolders = isOwner 
                        ? Object.entries(folders)
                        : Object.entries(folders).filter(([_, folder]) => 
                            folder.isGlobal || folder.addedBy === userId
                        );
                    
                    if (accessibleFolders.length === 0) {
                        await interaction.reply({
                            content: 'No folders available. Use /addfolder to add a folder.',
                            ephemeral: true
                        });
                        return;
                    }

                    const embed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle(`${CUSTOM_EMOJIS.INFO} ${isOwner ? 'All' : 'Available'} Folders`)
                        .setDescription(accessibleFolders.map(([name, folder]) => {
                            const visibility = folder.isGlobal ? '🌐' : '🔒';
                            const ownerInfo = folder.addedBy === 'system' 
                                ? 'System' 
                                : `<@${folder.addedBy}>`;
                            const addedDate = new Date(folder.addedAt).toLocaleDateString();
                            return `• ${name} ${visibility}\n  ┗ Added by: ${ownerInfo}\n  ┗ Added on: ${addedDate}`;
                        }).join('\n\n'))
                        .addFields(
                            { 
                                name: 'Legend', 
                                value: '🌐 - Global Folder\n🔒 - Private Folder' 
                            },
                            { 
                                name: 'Total Folders', 
                                value: `${accessibleFolders.length} folder${accessibleFolders.length !== 1 ? 's' : ''}` 
                            },
                            {
                                name: 'View Mode',
                                value: isOwner ? '👑 Owner (All Folders)' : '👤 User (Accessible Folders)'
                            }
                        )
                        .setFooter({ 
                            text: `</> JoY • ${getFormattedDateTime()}`,
                            iconURL: client.user.displayAvatarURL()
                        });

                    await interaction.reply({
                        embeds: [embed],
                        ephemeral: true
                    });
                    break;
                }

                case 'help': {
                    const embed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle(`${CUSTOM_EMOJIS.INFO} Bot Commands`)
                        .addFields(
                            {
                                name: '🎵 Music Commands',
                                value: [
                                    '`/join` - Join your voice channel',
                                    '`/play` - Choose and play music from folders',
                                    'Use the music control buttons to:',
                                    '• Play/Pause music',
                                    '• Skip to next song',
                                    '• Go to previous song',
                                    '• Toggle loop mode',
                                    '• View and select from queue'
                                ].join('\n')
                            },
                            {
                                name: '📁 Folder Management',
                                value: [
                                    '`/addfolder <name> <id>` - Add a new folder',
                                    '`/removefolder <name>` - Remove a folder',
                                    '`/listfolders` - Show all folders'
                                ].join('\n')
                            }
                        )
                        .setFooter({ 
                            text: `</> JoY • ${getFormattedDateTime()}`,
                            iconURL: client.user.displayAvatarURL()
                        });

                    await interaction.reply({
                        embeds: [embed],
                        ephemeral: true
                    });
                    break;
                }

                case 'stats': {
                    try {
                        const row = new ActionRowBuilder().addComponents(createStatsSelectMenu());
                        await interaction.reply({
                            embeds: [generateStatsEmbed('overview')],
                            components: [row],
                            ephemeral: true
                        });
                    } catch (error) {
                        console.error('Error in stats command:', error);
                        await interaction.reply({
                            content: `${CUSTOM_EMOJIS.ERROR} Failed to get statistics. Please try again.`,
                            ephemeral: true
                        });
                    }
                    break;
                }
            }
            return;
        }

        // Handle select menu interactions
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'folder_select') {
                await handlePlayCommand(interaction, interaction.values[0]);
            }
            else if (interaction.customId === 'stats_category') {
                try {
                    const category = interaction.values[0];
                    const row = new ActionRowBuilder().addComponents(createStatsSelectMenu(category));
                    
                    await interaction.update({
                        embeds: [generateStatsEmbed(category)],
                        components: [row]
                    });
                } catch (error) {
                    console.error('Error updating stats:', error);
                    await interaction.followUp({
                        content: `${CUSTOM_EMOJIS.ERROR} Failed to update statistics. Please try again.`,
                        ephemeral: true
                    });
                }
            }
            else if (interaction.customId === 'song_select') {
                try {
                    const selectedIndex = parseInt(interaction.values[0]);
                    if (!isNaN(selectedIndex) && selectedIndex < queue.length) {
                        // Get the selected song and make a copy of it
                        const selectedSong = { ...queue[selectedIndex] };
                        
                        // Remove the selected song from its current position
                        queue.splice(selectedIndex, 1);
                        
                        // If there's a current song, add it back to the front of the queue
                        if (currentSong) {
                            previousSongs.push(currentSong);
                            // Keep only the last 50 previous songs
                            if (previousSongs.length > 50) {
                                previousSongs.shift();
                            }
                        }

                        // Stop current playback and play the selected song
                        skipInProgress = true;
                        player.stop();
                        
                        // Play the selected song
                        await playAudio(selectedSong.id, selectedSong.name, interaction.channel);
                        
                        // Update interaction with confirmation
                        await interaction.update({
                            content: `${CUSTOM_EMOJIS.MUSIC} Now playing: ${selectedSong.name}`,
                            components: [createQueueSelectMenu()]
                        });
                    } else {
                        await interaction.update({
                            content: `${CUSTOM_EMOJIS.ERROR} Invalid song selection!`,
                            components: [createQueueSelectMenu()]
                        });
                    }
                } catch (error) {
                    console.error('Error in song selection:', error);
                    await interaction.update({
                        content: `${CUSTOM_EMOJIS.ERROR} Error playing selected song!`,
                        components: [createQueueSelectMenu()]
                    });
                }
            }
            return;
        }

        // Handle button interactions
        if (interaction.isButton()) {
            switch (interaction.customId) {
                case 'previous':
                    if (previousSongs.length > 0) {
                        const previousSong = previousSongs.pop();
                        if (currentSong) {
                            // Add current song to the front of the queue
                            queue.unshift(currentSong);
                        }
                        // Stop current playback
                        player.stop();
                        skipInProgress = true;
                        // Play the previous song
                        await playAudio(previousSong.id, previousSong.name, interaction.channel);
                        await interaction.reply({ 
                            content: `${CUSTOM_EMOJIS.PREVIOUS} Playing previous song: ${previousSong.name}`,
                            ephemeral: true 
                        });
                    } else {
                        await interaction.reply({ 
                            content: `${CUSTOM_EMOJIS.ERROR} No previous songs available!`,
                            ephemeral: true 
                        });
                    }
                    break;

                case 'pause':
                    if (player.state.status === AudioPlayerStatus.Playing) {
                        player.pause();
                        await updateNowPlayingMessage(interaction.channel);
                        await interaction.reply({ 
                            content: `${CUSTOM_EMOJIS.PAUSE} Paused playback`,
                            ephemeral: true 
                        });
                    }
                    break;

                case 'resume':
                    if (player.state.status === AudioPlayerStatus.Paused) {
                        player.unpause();
                        await updateNowPlayingMessage(interaction.channel);
                        await interaction.reply({ 
                            content: `${CUSTOM_EMOJIS.PLAY} Resumed playback`,
                            ephemeral: true 
                        });
                    }
                    break;

                case 'skip':
                    if (isProcessingSkip) {
                        await interaction.reply({
                            content: `${CUSTOM_EMOJIS.WARNING} Please wait 5 seconds between skips`,
                            ephemeral: true
                        });
                        return;
                    }

                    if (currentSong && !skipInProgress) {
                        isProcessingSkip = true;
                        skipInProgress = true;

                        // Add current song to previous songs array before stopping
                        if (currentSong) {
                            previousSongs.push(currentSong);
                            // Keep only the last 50 previous songs
                            if (previousSongs.length > 50) {
                                previousSongs.shift();
                            }
                        }

                        // Stop current song
                        player.stop();

                        // Play next song if available
                        if (queue.length > 0) {
                            const nextSong = queue[0];
                            queue = queue.slice(1);
                            await playAudio(nextSong.id, nextSong.name, interaction.channel);
                        } else {
                            currentSong = null;
                            skipInProgress = false;
                            if (currentPlayingMessage) {
                                await currentPlayingMessage.delete().catch(console.error);
                                currentPlayingMessage = null;
                            }
                        }

                        await interaction.reply({ 
                            content: `${CUSTOM_EMOJIS.SKIP} Skipped current song`,
                            ephemeral: true 
                        });

                        // Reset the skip processing flag after 5 seconds
                        setTimeout(() => {
                            isProcessingSkip = false;
                        }, 5000);
                    }
                    break;

                case 'stop':
                    if (currentSong) {
                        skipInProgress = true; // Prevent auto-play when stopping
                        player.stop();
                        queue = [];
                        currentSong = null;
                        await interaction.reply({ 
                            content: `${CUSTOM_EMOJIS.STOP} Stopped playback and cleared queue`,
                            ephemeral: true 
                        });
                    }
                    break;

                case 'loop':
                    isLooping = !isLooping;
                    await updateNowPlayingMessage(interaction.channel);
                    await interaction.reply({ 
                        content: `${CUSTOM_EMOJIS.LOOP} Loop mode ${isLooping ? 'enabled' : 'disabled'}`,
                        ephemeral: true 
                    });
                    break;

                case 'queue':
                    if (queue.length === 0) {
                        await interaction.reply({ 
                            content: `${CUSTOM_EMOJIS.QUEUE} Queue is empty`,
                            ephemeral: true 
                        });
                        return;
                    }

                    const queueEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle(`${CUSTOM_EMOJIS.QUEUE} Current Queue`)
                        .setDescription(queue.slice(0, 10).map((song, index) => 
                            `${index + 1}. ${song.name}`
                        ).join('\n'))
                        .setFooter({ 
                            text: `Total songs in queue: ${queue.length}`,
                            iconURL: client.user.displayAvatarURL()
                        });

                    await interaction.reply({ 
                        embeds: [queueEmbed],
                        ephemeral: true 
                    });
                    break;
            }
            return;
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        try {
            const errorMessage = 'An error occurred while processing your request.';
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: errorMessage, 
                    ephemeral: true 
                });
            } else {
                await interaction.editReply(errorMessage);
            }
        } catch (e) {
            console.error('Error sending error message:', e);
        }
    }
});

// Update the player event handler to handle looping and history
player.on(AudioPlayerStatus.Idle, () => {
    if (!skipInProgress && currentSong) {
        if (isLooping) {
            // If looping, add the current song back to the end of the queue
            queue.push(currentSong);
        } else {
            // If not looping and not a manual skip, add to previous songs
            previousSongs.push(currentSong);
            // Keep only the last 50 previous songs
            if (previousSongs.length > 50) {
                previousSongs.shift();
            }
        }
    }

    if (!skipInProgress && queue.length > 0 && connection && currentChannel) {
        const song = queue.shift();
        playAudio(song.id, song.name, currentChannel).catch(console.error);
    } else {
        currentSong = null;
    }
    skipInProgress = false;
});

// Handle voice connection errors
player.on('error', error => {
    console.error('Player error:', error);
    if (currentChannel) {
        currentChannel.send('An error occurred while playing the song.').catch(console.error);
    }
});

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

// Modify the reaction handler for skip
client.on('messageReactionAdd', async (reaction, user) => {
    // Ignore bot's own reactions
    if (user.bot) return;

    // Check if the reaction is on the current playing message
    if (!currentPlayingMessage || reaction.message.id !== currentPlayingMessage.id) return;

    // Remove user's reaction
    try {
        await reaction.users.remove(user.id);
    } catch (error) {
        console.error('Error removing reaction:', error);
    }

    // Helper function to send temporary messages
    const sendTempMessage = async (content) => {
        try {
            const msg = await currentChannel.send(content);
            setTimeout(() => msg.delete().catch(console.error), 1000);
        } catch (error) {
            console.error('Error sending temporary message:', error);
        }
    };

    // Handle different controls
    switch (reaction.emoji.name) {
        case CONTROLS.PLAY:
            if (player.state.status === AudioPlayerStatus.Paused) {
                player.unpause();
                await sendTempMessage('▶️ Resumed playback');
            }
            break;

        case CONTROLS.PAUSE:
            if (player.state.status === AudioPlayerStatus.Playing) {
                player.pause();
                await sendTempMessage('⏸️ Paused playback');
            }
            break;

        case CONTROLS.SKIP:
            // Prevent duplicate skips
            if (isProcessingSkip) {
                await sendTempMessage('⚠️ Please wait 5 seconds between skips');
                return;
            }
            
            if (currentSong && !skipInProgress) {
                isProcessingSkip = true;
                skipInProgress = true;

                // Stop current song
                player.stop();
                await sendTempMessage('⏭️ Skipped current song');
                
                // Play next song if available
                if (queue.length > 0) {
                    const nextSong = queue[0];
                    queue = queue.slice(1);
                    await playAudio(nextSong.id, nextSong.name, currentChannel);
                } else {
                    currentSong = null;
                    skipInProgress = false;
                }
                
                // Reset the skip processing flag after 5 seconds
                setTimeout(() => {
                    isProcessingSkip = false;
                }, 5000);
            }
            break;

        case CONTROLS.STOP:
            if (currentSong) {
                skipInProgress = true; // Prevent auto-play when stopping
                player.stop();
                queue = [];
                currentSong = null;
                await sendTempMessage('⏹️ Stopped playback and cleared queue');
                if (currentPlayingMessage) {
                    try {
                        await currentPlayingMessage.delete();
                        currentPlayingMessage = null;
                    } catch (error) {
                        console.error('Error deleting message:', error);
                    }
                }
            }
            break;
    }
});

// Helper function to format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
}

// Helper function to format uptime
function formatUptime(uptime) {
    const days = Math.floor(uptime / (24 * 60 * 60 * 1000));
    const hours = Math.floor((uptime % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((uptime % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((uptime % (60 * 1000)) / 1000);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);
    
    return parts.join(' ');
}

// Add voice state update handler for auto-dismissal
client.on('voiceStateUpdate', async (oldState, newState) => {
    // Check if user left a channel
    if (oldState.channelId && (!newState.channelId || newState.channelId !== oldState.channelId)) {
        const user = oldState.member.user;
        const textChannel = oldState.guild.channels.cache.find(
            channel => channel.type === 0 && // Text channel
            channel.permissionsFor(user).has('ViewChannel')
        );

        if (textChannel) {
            // Find and delete any ephemeral messages for this user
            const messages = await textChannel.messages.fetch({ limit: 100 });
            messages.forEach(message => {
                if (message.interaction && 
                    message.interaction.user.id === user.id && 
                    (message.interaction.commandName === 'help' || message.interaction.commandName === 'stats')) {
                    message.delete().catch(console.error);
                }
            });
        }
    }
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(process.env.DISCORD_TOKEN);

// Function to create control buttons
function createControlButtons(isPaused = false) {
    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('previous')
                .setEmoji(CUSTOM_EMOJIS.PREVIOUS.split(':')[2].slice(0, -1))
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(isPaused ? 'resume' : 'pause')
                .setEmoji(isPaused ? CUSTOM_EMOJIS.PLAY.split(':')[2].slice(0, -1) : CUSTOM_EMOJIS.PAUSE.split(':')[2].slice(0, -1))
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('skip')
                .setEmoji(CUSTOM_EMOJIS.SKIP.split(':')[2].slice(0, -1))
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('stop')
                .setEmoji(CUSTOM_EMOJIS.STOP.split(':')[2].slice(0, -1))
                .setStyle(ButtonStyle.Danger)
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('loop')
                .setEmoji(CUSTOM_EMOJIS.LOOP.split(':')[2].slice(0, -1))
                .setStyle(isLooping ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('queue')
                .setEmoji(CUSTOM_EMOJIS.QUEUE.split(':')[2].slice(0, -1))
                .setStyle(ButtonStyle.Primary)
        );

    return [row1, row2];
}

// Function to create queue select menu
function createQueueSelectMenu() {
    if (queue.length === 0) {
        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('song_select')
                .setPlaceholder('No songs in queue')
                .setDisabled(true)
                .addOptions([
                    {
                        label: 'Queue is empty',
                        description: 'Add songs to the queue first',
                        value: 'empty',
                        emoji: CUSTOM_EMOJIS.MUSIC.split(':')[2].slice(0, -1)
                    }
                ])
        );
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId('song_select')
        .setPlaceholder(`Queue: ${queue.length} songs`)
        .setMinValues(1)
        .setMaxValues(1);

    // Add up to 25 songs (Discord's limit for select menu options)
    queue.slice(0, 25).forEach((song, index) => {
        // Format the song name to fit within Discord's limits
        let displayName = song.name;
        if (displayName.length > 90) {
            displayName = displayName.substring(0, 87) + '...';
        }

        select.addOptions({
            label: `${index + 1}. ${displayName}`,
            description: 'Click to play this song',
            value: index.toString(),
            emoji: CUSTOM_EMOJIS.MUSIC.split(':')[2].slice(0, -1)
        });
    });

    return new ActionRowBuilder().addComponents(select);
}

// Function to update the now playing message
async function updateNowPlayingMessage(channel) {
    if (!currentSong) return;

    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle(`${CUSTOM_EMOJIS.MUSIC} Now Playing`)
        .setDescription(currentSong.name)
        .addFields(
            { name: 'Queue Position', value: `Current: ${queue.length} songs remaining` },
            { name: 'Loop', value: isLooping ? 'Enabled 🔄' : 'Disabled ➡️' }
        )
        .setFooter({ 
            text: `</> JoY • ${getFormattedDateTime()}`,
            iconURL: client.user.displayAvatarURL()
        });

    const components = [];
    
    // Add control buttons
    components.push(...createControlButtons(player.state.status === AudioPlayerStatus.Paused));
    
    // Add queue menu if there are songs
    if (queue.length > 0) {
        components.push(createQueueSelectMenu());
    }

    // Delete previous playing message if it exists
    if (currentPlayingMessage) {
        try {
            await currentPlayingMessage.delete();
        } catch (error) {
            console.error('Error deleting previous message:', error);
        }
    }

    // Send new message with updated components
    currentPlayingMessage = await channel.send({
        embeds: [embed],
        components: components
    });
}

// Function to handle play command
async function handlePlayCommand(interaction, folderName) {
    try {
        await interaction.deferUpdate();
        
        const folders = loadFolders();
        if (!folders[folderName]) {
            await interaction.editReply(`Folder "${folderName}" not found. Please try again.`);
            return;
        }

        // Load songs from the specified folder
        queue = await loadSongsFromDrive(folders[folderName].id);
        
        if (queue.length === 0) {
            await interaction.editReply('No songs found in this folder!');
            return;
        }

        const song = queue[0];
        queue = queue.slice(1);

        // Create new embed for playback start
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle(`${CUSTOM_EMOJIS.MUSIC} Starting Playback`)
            .setDescription(`Playing from folder: ${folderName}\nTotal songs in queue: ${queue.length + 1}\nPlaying in order: First to Last`)
            .addFields(
                { name: 'Current Song', value: song.name },
                { name: 'Requested By', value: `<@${interaction.user.id}>` }
            )
            .setFooter({ 
                text: `</> JoY • ${getFormattedDateTime()}`,
                iconURL: client.user.displayAvatarURL()
            });

        await interaction.editReply({
            embeds: [embed],
            components: []
        });

        await playAudio(song.id, song.name, interaction.channel);
    } catch (error) {
        console.error('Error in handlePlayCommand:', error);
        await interaction.editReply('An error occurred while starting playback.');
    }
} 
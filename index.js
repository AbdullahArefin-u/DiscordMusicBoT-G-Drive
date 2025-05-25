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

let currentPlayingMessage = null;

// Add before the commands handling
const DISMISS_BUTTON_ID = 'dismiss_message';

// Add at the top with other global variables
const userCooldowns = new Map();
const COOLDOWN_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds

// Add a flag to track if we're currently processing a skip
let isProcessingSkip = false;
let skipInProgress = false;

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

// Load songs when bot starts
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
        const songs = await loadSongsFromDrive(folders.default.id);
        console.log(`Found ${songs.length} songs in default folder`);
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
                            addedAt: Date.now()
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
                    addedAt: Date.now()
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
                    addedAt: Date.now()
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
            .setTitle('🎵 Now Playing')
            .setDescription(fileName)
            .addFields(
                { name: 'Queue Position', value: `Current: ${queue.length + 1} songs remaining` }
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

        // Send new message and add reaction controls
        const message = await channel.send({ embeds: [embed] });
        currentPlayingMessage = message;
        
        // Add reaction controls without showing count
        await message.react(CONTROLS.PLAY).catch(console.error);
        await Promise.all([
            message.react(CONTROLS.PAUSE, { fetchReaction: false }),
            message.react(CONTROLS.SKIP, { fetchReaction: false }),
            message.react(CONTROLS.STOP, { fetchReaction: false })
        ]).catch(console.error);
    } catch (error) {
        console.error('Error playing file:', error);
        await channel.send('Error playing the file.').catch(console.error);
    }
}

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isStringSelectMenu()) return;

    try {
        // Handle select menu interactions
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'folder_select') {
                const folderName = interaction.values[0];
                await handlePlayCommand(interaction, folderName);
            }
            else if (interaction.customId === 'help_category') {
                await handleHelpCategory(interaction);
            }
            return;
        }

        // Handle slash commands
        switch (interaction.commandName) {
            case 'addfolder': {
                await interaction.deferReply({ ephemeral: true });
                
                const userId = interaction.user.id;
                
                // Check cooldown
                const cooldownStatus = checkCooldown(userId);
                if (cooldownStatus.onCooldown) {
                    const embed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('❌ Cooldown Active')
                        .setDescription(`You can add another folder in: ${cooldownStatus.timeLeft}`)
                        .setFooter({ 
                            text: `</> JoY • ${getFormattedDateTime()}`,
                            iconURL: client.user.displayAvatarURL()
                        });
                    
                    await interaction.editReply({
                        embeds: [embed],
                        ephemeral: true
                    });
                    return;
                }

                const name = interaction.options.getString('name');
                const folderId = interaction.options.getString('id');
                
                const folders = loadFolders();
                if (folders[name]) {
                    await interaction.editReply(`A folder with the name "${name}" already exists!`);
                    return;
                }

                // Verify the folder exists and is accessible
                try {
                    const testLoad = await loadSongsFromDrive(folderId);
                    if (testLoad.length === 0) {
                        await interaction.editReply('No audio files found in this folder. Make sure the folder ID is correct and contains audio files.');
                        return;
                    }

                    // Add folder and save
                    folders[name] = {
                        id: folderId,
                        addedBy: userId,
                        addedAt: Date.now()
                    };
                    saveFolders(folders);

                    // Set cooldown
                    userCooldowns.set(userId, {
                        timestamp: Date.now(),
                        folderName: name
                    });

                    // Create embed with folder info
                    const embed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('📁 Folder Added Successfully')
                        .setDescription(`Folder "${name}" has been added with ${testLoad.length} songs!`)
                        .addFields(
                            { name: 'Folder Name', value: name },
                            { name: 'Number of Songs', value: testLoad.length.toString() },
                            { name: 'Added By', value: `<@${interaction.user.id}>` },
                            { name: 'Next Folder Add', value: '7 days from now' }
                        )
                        .setFooter({ 
                            text: `</> JoY • ${getFormattedDateTime()}`,
                            iconURL: client.user.displayAvatarURL()
                        });

                    await interaction.editReply({
                        embeds: [embed],
                        ephemeral: true
                    });
                } catch (error) {
                    console.error('Error accessing folder:', error);
                    await interaction.editReply('Error accessing the folder. Make sure the folder ID is correct and the folder is shared with the bot\'s service account.');
                }
                break;
            }

            case 'removefolder': {
                // Check if the user is the bot owner
                if (interaction.user.id !== '1067394668687536160') {
                    await interaction.reply({
                        content: '❌ Only the bot owner can remove folders!',
                        ephemeral: true
                    });
                    return;
                }

                const name = interaction.options.getString('name');
                const folders = loadFolders();
                
                if (!folders[name]) {
                    await interaction.reply({
                        content: `No folder found with the name "${name}"`,
                        ephemeral: true
                    });
                    return;
                }

                delete folders[name];
                saveFolders(folders);

                // Create embed for successful removal
                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('📁 Folder Removed')
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
                const folderList = Object.keys(folders);
                
                if (folderList.length === 0) {
                    await interaction.reply('No folders have been added yet. Use /addfolder to add a folder.');
                    return;
                }

                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('📁 Available Folders')
                    .setDescription(folderList.map(name => `• ${name}`).join('\n'))
                    .addFields(
                        { name: 'Requested By', value: `<@${interaction.user.id}>` }
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
                    await interaction.editReply({
                        content: 'Use /join first!',
                        ephemeral: true
                    });
                    return;
                }

                const folders = loadFolders();
                
                // If no folders available at all
                if (Object.keys(folders).length === 0) {
                    await interaction.editReply('No folders available. Please add a folder using /addfolder command.');
                    return;
                }

                try {
                    // Create select menu
                    const select = new StringSelectMenuBuilder()
                        .setCustomId('folder_select')
                        .setPlaceholder('Choose a folder to play from')
                        .setMinValues(1)
                        .setMaxValues(1);

                    // Add options to the select menu
                    Object.entries(folders).forEach(([folderName, folderData]) => {
                        select.addOptions({
                            label: folderName,
                            description: `Added by ${folderData.addedBy ? `<@${folderData.addedBy}>` : 'Unknown'}`,
                            value: folderName,
                            emoji: '📁'
                        });
                    });

                    // Create action row with the select menu
                    const row = new ActionRowBuilder()
                        .addComponents(select);

                    const embed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('🎵 Select Music Folder')
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
                        components: [row],
                        ephemeral: true
                    });
                } catch (error) {
                    console.error('Error creating folder selection menu:', error);
                    await interaction.editReply('An error occurred while creating the folder selection menu.');
                }
                break;
            }

            case 'skip': {
                await interaction.deferReply();
                
                if (!currentSong) {
                    await interaction.editReply('Nothing is playing!');
                    setTimeout(() => interaction.deleteReply().catch(console.error), 1000);
                    return;
                }

                player.stop();
                await interaction.editReply('Skipping current song...');
                setTimeout(() => interaction.deleteReply().catch(console.error), 1000);
                
                if (queue.length > 0) {
                    const nextSong = queue[0];
                    queue = queue.slice(1);
                    await playAudio(nextSong.id, nextSong.name, interaction.channel);
                }
                break;
            }

            case 'pause': {
                await interaction.deferReply();
                
                if (!player) {
                    await interaction.editReply('Nothing is playing!');
                    setTimeout(() => interaction.deleteReply().catch(console.error), 1000);
                    return;
                }
                
                player.pause();
                await interaction.editReply('Paused the music!');
                setTimeout(() => interaction.deleteReply().catch(console.error), 1000);
                break;
            }

            case 'resume': {
                await interaction.deferReply();
                
                if (!player) {
                    await interaction.editReply('Nothing is playing!');
                    setTimeout(() => interaction.deleteReply().catch(console.error), 1000);
                    return;
                }
                
                player.unpause();
                await interaction.editReply('Resumed the music!');
                setTimeout(() => interaction.deleteReply().catch(console.error), 1000);
                break;
            }

            case 'stats': {
                try {
                    // Get server info
                    const server = interaction.guild;
                    const textChannels = server.channels.cache.filter(c => c.type === 0).size;
                    const voiceChannels = server.channels.cache.filter(c => c.type === 2).size;
                    const categories = server.channels.cache.filter(c => c.type === 4).size;
                    
                    // Get system info
                    const totalMem = os.totalmem();
                    const freeMem = os.freemem();
                    const usedMem = totalMem - freeMem;
                    const memoryUsage = process.memoryUsage();
                    
                    // Create embed
                    const embed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('📊 Bot Statistics')
                        .addFields(
                            { 
                                name: '🤖 Bot Info',
                                value: [
                                    `**Servers:** ${client.guilds.cache.size}`,
                                    `**Ping:** ${Math.round(client.ws.ping)}ms`,
                                    `**Uptime:** ${formatUptime(client.uptime)}`,
                                    `**Discord.js:** v${discordJSVersion}`,
                                    `**Node.js:** ${process.version}`
                                ].join('\n'),
                                inline: true
                            },
                            {
                                name: '💻 System Info',
                                value: [
                                    `**Platform:** ${os.platform()}`,
                                    `**CPU:** ${os.cpus()[0].model}`,
                                    `**CPU Cores:** ${os.cpus().length}`,
                                    `**Memory Usage:** ${formatBytes(usedMem)} / ${formatBytes(totalMem)}`,
                                    `**Bot Memory:** ${formatBytes(memoryUsage.heapUsed)}`
                                ].join('\n'),
                                inline: true
                            },
                            {
                                name: '🏠 Server Info',
                                value: [
                                    `**Name:** ${server.name}`,
                                    `**Members:** ${server.memberCount}`,
                                    `**Roles:** ${server.roles.cache.size}`,
                                    `**Text Channels:** ${textChannels}`,
                                    `**Voice Channels:** ${voiceChannels}`,
                                    `**Categories:** ${categories}`
                                ].join('\n'),
                                inline: true
                            }
                        )
                        .setThumbnail(server.iconURL({ size: 256, dynamic: true }))
                        .setFooter({ 
                            text: `</> JoY • ${getFormattedDateTime()}`,
                            iconURL: client.user.displayAvatarURL()
                        });

                    // Create dismiss button
                    const dismissButton = new ButtonBuilder()
                        .setCustomId(DISMISS_BUTTON_ID)
                        .setLabel('Dismiss')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🗑️');

                    const row = new ActionRowBuilder().addComponents(dismissButton);

                    // Send as ephemeral message using flags
                    await interaction.reply({
                        embeds: [embed],
                        components: [row],
                        ephemeral: true
                    });

                    // Set up channel leave listener for this specific message
                    const collector = interaction.channel.createMessageComponentCollector({
                        filter: i => i.customId === DISMISS_BUTTON_ID && i.user.id === interaction.user.id,
                        time: 300000 // 5 minutes
                    });

                    collector.on('collect', async i => {
                        if (i.customId === DISMISS_BUTTON_ID) {
                            await i.update({ content: 'Message dismissed!', embeds: [], components: [], ephemeral: true });
                            setTimeout(() => i.deleteReply().catch(console.error), 1000);
                        }
                    });

                } catch (error) {
                    console.error('Error getting stats:', error);
                    await interaction.reply({ 
                        content: 'An error occurred while fetching statistics.',
                        ephemeral: true
                    });
                }
                break;
            }

            case 'help': {
                // Create the initial help embed
                const embed = createOverviewEmbed(client);

                // Create select menu for categories
                const select = new StringSelectMenuBuilder()
                    .setCustomId('help_category')
                    .setPlaceholder('Choose a command category')
                    .addOptions([
                        {
                            label: 'Overview',
                            description: 'Show all commands',
                            value: 'overview',
                            emoji: '📖',
                            default: true
                        },
                        {
                            label: 'Music Commands',
                            description: 'Commands for playing music',
                            value: 'music',
                            emoji: '🎵'
                        },
                        {
                            label: 'Folder Management',
                            description: 'Commands for managing Google Drive folders',
                            value: 'folder',
                            emoji: '📁'
                        },
                        {
                            label: 'Other Commands',
                            description: 'Other utility commands',
                            value: 'other',
                            emoji: '🔧'
                        },
                        {
                            label: 'Reaction Controls',
                            description: 'Available reaction controls',
                            value: 'reactions',
                            emoji: '🎮'
                        }
                    ]);

                const menuRow = new ActionRowBuilder().addComponents(select);

                // Create dismiss button
                const dismissButton = new ButtonBuilder()
                    .setCustomId(DISMISS_BUTTON_ID)
                    .setLabel('Dismiss')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🗑️');

                const buttonRow = new ActionRowBuilder().addComponents(dismissButton);

                // Send as ephemeral message using flags
                await interaction.reply({
                    embeds: [embed],
                    components: [menuRow, buttonRow],
                    ephemeral: true
                });

                // Set up collectors for both the select menu and dismiss button
                const collector = interaction.channel.createMessageComponentCollector({
                    filter: i => (
                        (i.customId === 'help_category' || i.customId === DISMISS_BUTTON_ID) && 
                        i.user.id === interaction.user.id
                    ),
                    time: 300000 // 5 minutes
                });

                collector.on('collect', async i => {
                    if (i.customId === DISMISS_BUTTON_ID) {
                        await i.update({ content: 'Help dismissed!', embeds: [], components: [], ephemeral: true });
                        setTimeout(() => i.deleteReply().catch(console.error), 1000);
                    } else if (i.customId === 'help_category') {
                        await handleHelpCategory(i);
                    }
                });

                break;
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        try {
            const message = 'An error occurred while processing the command.';
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: message, 
                    ephemeral: true 
                });
            } else {
                await interaction.editReply(message);
            }
        } catch (e) {
            console.error('Error sending error message:', e);
        }
    }
});

// Add helper function to create overview embed
function createOverviewEmbed(client) {
    return new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('📖 Command Overview')
        .setDescription('Here\'s a complete list of all available commands. Select a category from the dropdown menu below for detailed information.')
        .addFields(
            {
                name: '🎵 Music Commands',
                value: [
                    '`/join` - Join your voice channel',
                    '`/play` - Choose and play music from available folders',
                    '`/pause` - Pause the current song',
                    '`/resume` - Resume the paused song',
                    '`/skip` - Skip to the next song'
                ].join('\n'),
                inline: true
            },
            {
                name: '📁 Folder Management',
                value: [
                    '`/addfolder <name> <id>` - Add folder',
                    '`/removefolder <name>` - Remove folder',
                    '`/listfolders` - Show all folders'
                ].join('\n'),
                inline: true
            },
            {
                name: '🔧 Other Commands',
                value: [
                    '`/stats` - Show statistics',
                    '`/help` - Show this help'
                ].join('\n'),
                inline: true
            },
            {
                name: '⚡ Quick Start',
                value: [
                    '1. Join a voice channel',
                    '2. Use `/join` to bring the bot in',
                    '3. Use `/play` to select a folder and start playing music',
                    '4. Use reaction controls under the playing message'
                ].join('\n')
            },
            {
                name: '🎮 Reaction Controls',
                value: [
                    '▶️ - Resume playback',
                    '⏸️ - Pause playback',
                    '⏭️ - Skip current song',
                    '⏹️ - Stop playback and clear queue'
                ].join('\n')
            }
        )
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ 
            text: `</> JoY • ${getFormattedDateTime()}`,
            iconURL: client.user.displayAvatarURL()
        });
}

// Modify the handleHelpCategory function to include overview
async function handleHelpCategory(interaction) {
    const category = interaction.values[0];
    let embed;

    if (category === 'overview') {
        embed = createOverviewEmbed(client);
    } else {
        embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setThumbnail(client.user.displayAvatarURL())
            .setFooter({ 
                text: `</> JoY • ${getFormattedDateTime()}`,
                iconURL: client.user.displayAvatarURL()
            });

        switch (category) {
            case 'music':
                embed
                    .setTitle('🎵 Music Commands')
                    .addFields({
                        name: 'Available Commands',
                        value: [
                            '`/join` - Join your voice channel',
                            '`/play` - Choose and play music from available folders',
                            '`/pause` - Pause the current song',
                            '`/resume` - Resume the paused song',
                            '`/skip` - Skip to the next song'
                        ].join('\n')
                    })
                    .addFields({
                        name: 'How to Use',
                        value: 'Join a voice channel first, then use `/join` to bring the bot in. Use `/play` to select a folder and start playing music.'
                    });
                break;

            case 'folder':
                embed
                    .setTitle('📁 Folder Management')
                    .addFields({
                        name: 'Available Commands',
                        value: [
                            '`/addfolder <name> <id>` - Add a new Google Drive folder',
                            '`/removefolder <name>` - Remove a folder',
                            '`/listfolders` - Show all available folders'
                        ].join('\n')
                    })
                    .addFields({
                        name: 'How to get folder ID',
                        value: 'Open your Google Drive folder and copy the ID from the URL:\n`https://drive.google.com/drive/folders/`**`YOUR_FOLDER_ID`**'
                    });
                break;

            case 'other':
                embed
                    .setTitle('🔧 Other Commands')
                    .addFields({
                        name: 'Available Commands',
                        value: [
                            '`/stats` - Show bot and server statistics',
                            '`/help` - Show this help message'
                        ].join('\n')
                    })
                    .addFields({
                        name: 'Additional Info',
                        value: 'Use `/stats` to see detailed information about the bot, server, and system performance.'
                    });
                break;

            case 'reactions':
                embed
                    .setTitle('🎮 Reaction Controls')
                    .addFields({
                        name: 'Available Controls',
                        value: [
                            '▶️ - Resume playback',
                            '⏸️ - Pause playback',
                            '⏭️ - Skip current song',
                            '⏹️ - Stop playback and clear queue'
                        ].join('\n')
                    })
                    .addFields({
                        name: 'How to Use',
                        value: 'Click on the reaction buttons below the currently playing song message to control playback.'
                    });
                break;
        }
    }

    // Create dismiss button
    const dismissButton = new ButtonBuilder()
        .setCustomId(DISMISS_BUTTON_ID)
        .setLabel('Dismiss')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🗑️');

    const buttonRow = new ActionRowBuilder().addComponents(dismissButton);

    // Keep the category select menu and add the dismiss button
    await interaction.update({
        embeds: [embed],
        components: [interaction.message.components[0], buttonRow]
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
            .setTitle('🎵 Starting Playback')
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

// Modify the player event handler
player.on(AudioPlayerStatus.Idle, () => {
    // Only process next song if it wasn't triggered by a skip
    if (!skipInProgress && queue.length > 0 && connection && currentChannel) {
        const song = queue[0];
        queue = queue.slice(1);
        playAudio(song.id, song.name, currentChannel).catch(console.error);
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
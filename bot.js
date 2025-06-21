client.on('error', console.error);
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Bot configuration
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
    ]
});

// Data storage
let warnings = {};
let staffActions = {};
let userLevels = {};
let messageStats = {};
let customCommands = {}; // Store custom no-prefix commands
let config = {
    logChannelId: null,
    staffRoleId: null,
    mutedRoleId: null,
    levelUpChannelId: null,
    countingChannelId: null,
    xpPerMessage: 15,
    xpCooldown: 60000,
    // Ticket & Reward system data:
    transcriptChannels: [],
    staffRoles: [],
    staffMultipliers: {},
    ticketActivity: {},
    staffPayments: {}
};

// XP cooldown tracking
let xpCooldowns = new Map();

// Bot owner and server owner IDs (you can set these)
const BOT_OWNER_ID = '1041723966156443788'; // Replace with your Discord user ID

// Load data on startup
function loadData() {
    try {
        if (fs.existsSync('warnings.json')) {
            warnings = JSON.parse(fs.readFileSync('warnings.json', 'utf8'));
        }
        if (fs.existsSync('staffActions.json')) {
            staffActions = JSON.parse(fs.readFileSync('staffActions.json', 'utf8'));
        }
        if (fs.existsSync('userLevels.json')) {
            userLevels = JSON.parse(fs.readFileSync('userLevels.json', 'utf8'));
        }
        if (fs.existsSync('messageStats.json')) {
            messageStats = JSON.parse(fs.readFileSync('messageStats.json', 'utf8'));
        }
        if (fs.existsSync('customCommands.json')) {
            customCommands = JSON.parse(fs.readFileSync('customCommands.json', 'utf8'));
        }
        if (fs.existsSync('config.json')) {
            config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Save data
function saveData() {
    try {
        fs.writeFileSync('warnings.json', JSON.stringify(warnings, null, 2));
        fs.writeFileSync('staffActions.json', JSON.stringify(staffActions, null, 2));
        fs.writeFileSync('userLevels.json', JSON.stringify(userLevels, null, 2));
        fs.writeFileSync('messageStats.json', JSON.stringify(messageStats, null, 2));
        fs.writeFileSync('customCommands.json', JSON.stringify(customCommands, null, 2));
        fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Calculate level from XP - Progressive system up to 100+ levels
function calculateLevel(xp) {
    if (xp < 100) return 0;
    
    // Use a more gradual progression for 100+ levels
    // Level 1: 100 XP, Level 2: 250 XP, Level 3: 450 XP, etc.
    let level = 0;
    let totalXpNeeded = 0;
    
    while (totalXpNeeded <= xp && level < 150) { // Cap at 150 levels
        level++;
        totalXpNeeded += xpForLevelDifference(level);
    }
    
    return level - 1;
}

// Calculate XP needed for specific level difference
function xpForLevelDifference(level) {
    // Base XP increases gradually: 100, 150, 200, 250, 300, etc.
    return 100 + (level - 1) * 50;
}

// Calculate total XP needed to reach a specific level
function xpForLevel(level) {
    if (level === 0) return 0;
    
    let totalXp = 0;
    for (let i = 1; i <= level; i++) {
        totalXp += xpForLevelDifference(i);
    }
    return totalXp;
}

// Handle XP and leveling
async function handleXP(message) {
    if (message.author.bot) return;
    
    // Check if counting is restricted to a specific channel
    if (config.countingChannelId && message.channel.id !== config.countingChannelId) {
        return; // Don't count XP if not in the designated channel
    }
    
    const userId = message.author.id;
    const guildId = message.guild.id;
    
    // Check cooldown
    const cooldownKey = `${userId}-${guildId}`;
    if (xpCooldowns.has(cooldownKey)) {
        const expirationTime = xpCooldowns.get(cooldownKey) + config.xpCooldown;
        if (Date.now() < expirationTime) return;
    }
    
    // Set cooldown
    xpCooldowns.set(cooldownKey, Date.now());
    
    // Initialize user data
    if (!userLevels[guildId]) userLevels[guildId] = {};
    if (!userLevels[guildId][userId]) {
        userLevels[guildId][userId] = { xp: 0, level: 0 };
    }
    
    // Ensure XP is a number (fix null values)
    if (userLevels[guildId][userId].xp === null || isNaN(userLevels[guildId][userId].xp)) {
        userLevels[guildId][userId].xp = 0;
    }
    if (userLevels[guildId][userId].level === null || isNaN(userLevels[guildId][userId].level)) {
        userLevels[guildId][userId].level = 0;
    }
    
    // Add XP - configurable amount per message
    const baseXP = Math.floor(config.xpPerMessage * 0.7); // 70% of base
    const bonusXP = Math.floor(Math.random() * Math.floor(config.xpPerMessage * 0.6)); // Up to 60% bonus
    const totalXP = baseXP + bonusXP;
    
    userLevels[guildId][userId].xp += totalXP;
    
    // Check for level up
    const oldLevel = userLevels[guildId][userId].level;
    const newLevel = calculateLevel(userLevels[guildId][userId].xp);
    
    if (newLevel > oldLevel) {
        userLevels[guildId][userId].level = newLevel;
        
        const nextLevelXP = xpForLevel(newLevel + 1);
        const xpNeeded = nextLevelXP - userLevels[guildId][userId].xp;
        
        const levelUpEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🎉 Level Up!')
            .setDescription(`${message.author}, you've reached **Level ${newLevel}**!\n+${totalXP} XP from this message`)
            .addFields(
                { name: 'Current XP', value: userLevels[guildId][userId].xp.toLocaleString(), inline: true },
                { name: 'Next Level', value: newLevel >= 100 ? 'Max Level!' : `${xpNeeded.toLocaleString()} XP needed`, inline: true },
                { name: 'Level Progress', value: newLevel >= 100 ? '100%' : `${Math.floor((userLevels[guildId][userId].xp / nextLevelXP) * 100)}%`, inline: true }
            )
            .setThumbnail(message.author.displayAvatarURL());
        
        // Send to level up channel or current channel
        const levelChannel = message.guild.channels.cache.get(config.levelUpChannelId) || message.channel;
        await levelChannel.send({ embeds: [levelUpEmbed] });
    }
    
    saveData();
}

// Handle message statistics
function handleMessageStats(message) {
    if (message.author.bot) return;
    
    // Check if counting is restricted to a specific channel
    if (config.countingChannelId && message.channel.id !== config.countingChannelId) {
        return; // Don't count messages if not in the designated channel
    }
    
    const userId = message.author.id;
    const guildId = message.guild.id;
    const today = new Date().toDateString();
    const thisWeek = getWeekStart().toDateString();
    const thisMonth = `${new Date().getFullYear()}-${new Date().getMonth()}`;
    
    if (!messageStats[guildId]) messageStats[guildId] = {};
    if (!messageStats[guildId][userId]) {
        messageStats[guildId][userId] = {
            total: 0,
            daily: {},
            weekly: {},
            monthly: {}
        };
    }
    
    const userStats = messageStats[guildId][userId];
    userStats.total++;
    userStats.daily[today] = (userStats.daily[today] || 0) + 1;
    userStats.weekly[thisWeek] = (userStats.weekly[thisWeek] || 0) + 1;
    userStats.monthly[thisMonth] = (userStats.monthly[thisMonth] || 0) + 1;
    
    saveData();
}

// Get start of current week
function getWeekStart() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day;
    return new Date(now.setDate(diff));
}

// Check if user is bot owner or server owner
function isOwner(message) {
    return message.author.id === BOT_OWNER_ID || message.author.id === message.guild.ownerId;
}

// Check if user has moderation permissions
function hasModerationPermissions(member) {
    return member.permissions.has(PermissionFlagsBits.ModerateMembers) || 
           member.permissions.has(PermissionFlagsBits.KickMembers) ||
           member.permissions.has(PermissionFlagsBits.BanMembers);
}

// Log staff actions
function logStaffAction(staffId, action, targetId, reason) {
    const timestamp = new Date().toISOString();
    if (!staffActions[staffId]) staffActions[staffId] = [];
    
    staffActions[staffId].push({
        action,
        targetId,
        reason,
        timestamp
    });
    
    saveData();
}

// Send log to channel
async function sendLog(guild, embed) {
    if (config.logChannelId) {
        const logChannel = guild.channels.cache.get(config.logChannelId);
        if (logChannel) {
            await logChannel.send({ embeds: [embed] });
        }
    }
}

// Commands array
const commands = [
    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to warn')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for warning')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to kick')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for kick')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to ban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for ban')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('Days of messages to delete (0-7)')
                .setMinValue(0)
                .setMaxValue(7))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mute a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to mute')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('duration')
                .setDescription('Duration in minutes')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for mute')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Unmute a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to unmute')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('Check warnings for a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check warnings for')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('clearwarnings')
        .setDescription('Clear all warnings for a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to clear warnings for')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('staffstats')
        .setDescription('View staff member statistics')
        .addUserOption(option =>
            option.setName('staff')
                .setDescription('Staff member to check')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete multiple messages')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Setup bot configuration')
        .addChannelOption(option =>
            option.setName('logchannel')
                .setDescription('Channel for moderation logs')
                .setRequired(false))
        .addRoleOption(option =>
            option.setName('staffrole')
                .setDescription('Staff role')
                .setRequired(false))
        .addRoleOption(option =>
            option.setName('mutedrole')
                .setDescription('Muted role')
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('levelchannel')
                .setDescription('Channel for level up announcements')
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('countingchannel')
                .setDescription('Channel where messages/XP will be counted (leave empty for all channels)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // New commands for leveling and stats
    new SlashCommandBuilder()
        .setName('level')
        .setDescription('Check your or another user\'s level')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check level for')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View server leaderboards')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type of leaderboard')
                .setRequired(true)
                .addChoices(
                    { name: 'Levels', value: 'levels' },
                    { name: 'Messages', value: 'messages' }
                )),

    new SlashCommandBuilder()
        .setName('messagestats')
        .setDescription('View message statistics')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check stats for')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('period')
                .setDescription('Time period')
                .setRequired(false)
                .addChoices(
                    { name: 'Daily', value: 'daily' },
                    { name: 'Weekly', value: 'weekly' },
                    { name: 'Monthly', value: 'monthly' },
                    { name: 'Total', value: 'total' }
                )),

    // --- Ticket & Staff Reward System using config.json ---

    // Use config.transcriptChannels, config.staffRoles, config.staffMultipliers, config.ticketActivity, config.staffPayments

    new SlashCommandBuilder()
        .setName('settranscript')
        .setDescription('Add a transcript channel')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Transcript channel')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // Example: /setstaff <@role>
    new SlashCommandBuilder()
        .setName('setstaff')
        .setDescription('Add a staff role')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Staff role')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // Example: /reseticket
    new SlashCommandBuilder()
        .setName('resetticket')
        .setDescription('Reset weekly ticket stats')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // Example: /weeklytop
    new SlashCommandBuilder()
        .setName('weeklytop')
        .setDescription('Show weekly staff leaderboard')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// --- Initialization Functions ---

function set_transcript(channelId) {
    if (!config.transcriptChannels.includes(channelId)) {
        config.transcriptChannels.push(channelId);
        saveData();
    }
}

function manage_transcript(channelId, action) {
    if (action === 'delete') {
        config.transcriptChannels = config.transcriptChannels.filter(id => id !== channelId);
        saveData();
    }
}

function set_staff(roleId) {
    if (!config.staffRoles.includes(roleId)) {
        config.staffRoles.push(roleId);
        saveData();
    }
}

function manage_staff(roleId, action, multiplier) {
    if (action === 'delete') {
        config.staffRoles = config.staffRoles.filter(id => id !== roleId);
        delete config.staffMultipliers[roleId];
        saveData();
    } else if (action === 'multiplier' && multiplier) {
        config.staffMultipliers[roleId] = multiplier;
        saveData();
    }
}

// --- Ticket Monitoring Function ---

async function superviseTranscripts(client) {
    for (const channelId of config.transcriptChannels) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) continue;
        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => []);
        messages.forEach(msg => {
            if (msg.embeds.length > 0) {
                msg.embeds.forEach(embed => {
                    if (embed.description) {
                        config.staffRoles.forEach(roleId => {
                            if (embed.description.includes(`<@&${roleId}>`)) {
                                for (const member of channel.members.values()) {
                                    if (member.roles.cache.has(roleId)) {
                                        if (!config.ticketActivity[member.id]) config.ticketActivity[member.id] = { tickets: [], weekly: [], messages: 0, weeklyMessages: 0 };
                                        if (!config.ticketActivity[member.id].tickets.includes(msg.id)) {
                                            config.ticketActivity[member.id].tickets.push(msg.id);
                                            config.ticketActivity[member.id].weekly.push(msg.id);
                                            saveData();
                                        }
                                    }
                                }
                            }
                        });
                    }
                });
            }
        });
    }
}

// --- Implementation Functions ---

function reset_ticket() {
    for (const staffId in config.ticketActivity) {
        config.ticketActivity[staffId].weekly = [];
        config.ticketActivity[staffId].weeklyMessages = 0;
    }
    saveData();
}

function count_ticket() {
    let count = 0;
    for (const staffId in config.ticketActivity) {
        count += config.ticketActivity[staffId].tickets.length;
    }
    return count;
}

function staff_hierarchy() {
    // Returns sorted array of staff by ticket count
    return Object.entries(config.ticketActivity)
        .map(([staffId, data]) => ({
            staffId,
            tickets: data.tickets.length,
            messages: data.messages
        }))
        .sort((a, b) => b.tickets - a.tickets);
}

function weekly_top() {
    // Returns sorted array of staff by weekly ticket count
    return Object.entries(config.ticketActivity)
        .map(([staffId, data]) => ({
            staffId,
            weeklyTickets: data.weekly.length,
            weeklyMessages: data.weeklyMessages
        }))
        .sort((a, b) => b.weeklyTickets - a.weeklyTickets);
}

function staff_payment() {
    // Calculate GOKU POINTS for each staff for the week
    for (const staffId in config.ticketActivity) {
        const tickets = config.ticketActivity[staffId].weekly.length;
        const messages = config.ticketActivity[staffId].weeklyMessages;
        const ticketPoints = tickets * 1000;
        const messagePoints = Math.floor(messages / 100) * 1000;
        config.staffPayments[staffId] = {
            week: new Date().toISOString().slice(0, 10),
            tickets,
            messages,
            gokupoints: ticketPoints + messagePoints
        };
    }
    saveData();
    return config.staffPayments;
}

function staff_pay() {
    // Returns sorted array of staff by payment
    staff_payment();
    return Object.entries(config.staffPayments)
        .map(([staffId, data]) => ({
            staffId,
            gokupoints: data.gokupoints
        }))
        .sort((a, b) => b.gokupoints - a.gokupoints);
}

function paystaff() {
    // Generates payout messages for each staff
    staff_payment();
    return Object.entries(config.staffPayments).map(([staffId, data]) =>
        `!add-money ${staffId} ${data.gokupoints}`
    );
}

// --- Example Command Integration (add these to your command handler) ---

// Example: /settranscript <#channel>
commands.push(
    new SlashCommandBuilder()
        .setName('settranscript')
        .setDescription('Add a transcript channel')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Transcript channel')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
);

// Example: /setstaff <@role>
commands.push(
    new SlashCommandBuilder()
        .setName('setstaff')
        .setDescription('Add a staff role')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Staff role')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
);

// Example: /reseticket
commands.push(
    new SlashCommandBuilder()
        .setName('resetticket')
        .setDescription('Reset weekly ticket stats')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
);

// Example: /weeklytop
commands.push(
    new SlashCommandBuilder()
        .setName('weeklytop')
        .setDescription('Show weekly staff leaderboard')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
);

// Add similar commands for manage_staff, manage_transcript, staff_pay, paystaff, etc.

// --- Add to your interactionCreate handler ---

// Example for /settranscript
if (commandName === 'settranscript') {
    const channel = options.getChannel('channel');
    set_transcript(channel.id);
    await interaction.reply(`Added transcript channel: ${channel}`);
}

// Example for /setstaff
if (commandName === 'setstaff') {
    const role = options.getRole('role');
    set_staff(role.id);
    await interaction.reply(`Added staff role: ${role}`);
}

// Example for /resetticket
if (commandName === 'resetticket') {
    reset_ticket();
    await interaction.reply('Weekly ticket stats have been reset.');
}

// Example for /weeklytop
if (commandName === 'weeklytop') {
    const top = weekly_top();
    const embed = new EmbedBuilder()
        .setTitle('Weekly Staff Leaderboard')
        .setColor('#FFD700')
        .setDescription(
            top.map((s, i) => `${i + 1}. <@${s.staffId}> - ${s.weeklyTickets} tickets, ${s.weeklyMessages} messages`).join('\n')
        );
    await interaction.reply({ embeds: [embed] });
}

// --- Schedule weekly_top and staff_payment every Sunday 12PM GMT+2 using node-cron or similar ---

client.once('ready', async () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    loadData();
    
    // Register slash commands
    const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
    
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

// Handle messages for XP, stats, and prefix-free commands
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;
    
    // Handle XP and message stats
    await handleXP(message);
    handleMessageStats(message);
    
    // Handle prefix-free commands
    const content = message.content.toLowerCase().trim();
    const args = message.content.trim().split(/\s+/);
    const command = args[0].toLowerCase();
    
    // Check permissions for commands
    const isOwnerUser = isOwner(message);
    const hasModPerms = hasModerationPermissions(message.member);
    
    // Level and stats commands (available to everyone)
    if (command === 'level' || command === 'rank') {
        const targetUser = message.mentions.users.first() || message.author;
        const guildId = message.guild.id;
        const userId = targetUser.id;
        
        if (!userLevels[guildId] || !userLevels[guildId][userId]) {
            return message.reply(`${targetUser.username} hasn't gained any XP yet!`);
        }
        
        const userData = userLevels[guildId][userId];
        const currentLevelXP = xpForLevel(userData.level);
        const nextLevelXP = xpForLevel(userData.level + 1);
        const progressXP = userData.xp - currentLevelXP;
        const neededXP = nextLevelXP - userData.xp;
        const progressPercent = userData.level >= 100 ? 100 : Math.floor((progressXP / (nextLevelXP - currentLevelXP)) * 100);
        
        // Create progress bar
        const progressBarLength = 10;
        const filledBars = Math.floor((progressPercent / 100) * progressBarLength);
        const emptyBars = progressBarLength - filledBars;
        const progressBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);
        
        const levelEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`${targetUser.username}'s Level`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'Level', value: userData.level.toString(), inline: true },
                { name: 'Total XP', value: userData.xp.toLocaleString(), inline: true },
                { name: 'Progress', value: userData.level >= 100 ? 'MAX LEVEL!' : `${progressPercent}%`, inline: true },
                { name: 'Progress Bar', value: userData.level >= 100 ? '█'.repeat(10) : `${progressBar} ${progressPercent}%` },
                { name: 'Next Level', value: userData.level >= 100 ? 'Already at max!' : `${neededXP.toLocaleString()} XP needed`, inline: true }
            );
        
        await message.reply({ embeds: [levelEmbed] });
    }
    
    else if (command === 'leaderboard' || command === 'lb') {
        const type = args[1] || 'levels';
        const guildId = message.guild.id;
        
        if (type === 'levels') {
            if (!userLevels[guildId]) return message.reply('No level data available!');
            
            const sorted = Object.entries(userLevels[guildId])
                .sort(([,a], [,b]) => b.xp - a.xp)
                .slice(0, 10);
            
            const leaderboard = sorted.map(([userId, data], index) => {
                const user = message.guild.members.cache.get(userId);
                const username = user ? user.displayName : 'Unknown User';
                return `${index + 1}. ${username} - Level ${data.level} (${data.xp} XP)`;
            }).join('\n');
            
            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('🏆 Level Leaderboard')
                .setDescription(leaderboard || 'No data available');
            
            await message.reply({ embeds: [embed] });
        }
        
        else if (type === 'messages') {
            if (!messageStats[guildId]) return message.reply('No message data available!');
            
            const sorted = Object.entries(messageStats[guildId])
                .sort(([,a], [,b]) => b.total - a.total)
                .slice(0, 10);
            
            const leaderboard = sorted.map(([userId, data], index) => {
                const user = message.guild.members.cache.get(userId);
                const username = user ? user.displayName : 'Unknown User';
                return `${index + 1}. ${username} - ${data.total} messages`;
            }).join('\n');
            
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('💬 Message Leaderboard')
                .setDescription(leaderboard || 'No data available');
            
            await message.reply({ embeds: [embed] });
        }
    }
    
    else if (command === 'messagestats' || command === 'msgstats') {
        const targetUser = message.mentions.users.first() || message.author;
        const period = args[args.length - 1] || 'total';
        const guildId = message.guild.id;
        const userId = targetUser.id;
        
        if (!messageStats[guildId] || !messageStats[guildId][userId]) {
            return message.reply(`${targetUser.username} has no message statistics!`);
        }
        
        const stats = messageStats[guildId][userId];
        const today = new Date().toDateString();
        const thisWeek = getWeekStart().toDateString();
        const thisMonth = `${new Date().getFullYear()}-${new Date().getMonth()}`;
        
        const embed = new EmbedBuilder()
            .setColor('#800080')
            .setTitle(`📊 ${targetUser.username}'s Message Statistics`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'Total Messages', value: stats.total.toString(), inline: true },
                { name: 'Today', value: (stats.daily[today] || 0).toString(), inline: true },
                { name: 'This Week', value: (stats.weekly[thisWeek] || 0).toString(), inline: true },
                { name: 'This Month', value: (stats.monthly[thisMonth] || 0).toString(), inline: true }
            );
        
        await message.reply({ embeds: [embed] });
    }
    
    // Channel Configuration commands (only for owners)
    else if ((command === 'setcountingchannel') && isOwnerUser) {
        const channelMention = message.mentions.channels.first();
        
        if (!channelMention) {
            // Remove restriction if no channel mentioned
            config.countingChannelId = null;
            saveData();
            return message.reply('✅ Removed counting channel restriction. Messages/XP will be counted in all channels.');
        }
        
        config.countingChannelId = channelMention.id;
        saveData();
        
        await message.reply(`✅ Set counting channel to ${channelMention}. Only messages in this channel will count for XP and stats.`);
    }
    
    else if (command === 'countinginfo') {
        const currentChannel = config.countingChannelId ? `<#${config.countingChannelId}>` : 'All channels';
        
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📊 Counting Channel Info')
            .addFields(
                { name: 'Current Counting Channel', value: currentChannel, inline: true },
                { name: 'Commands', value: '`setcountingchannel #channel` - Set counting channel\n`setcountingchannel` - Remove restriction', inline: false }
            )
            .setFooter({ text: 'Use "setcountingchannel #channel" to change (owner only)' });
        
        await message.reply({ embeds: [embed] });
    }
    
    // XP Configuration commands (only for owners)
    else if ((command === 'setxp') && isOwnerUser) {
        const newXP = parseInt(args[1]);
        
        if (!newXP || newXP < 1 || newXP > 100) {
            return message.reply('Usage: `setxp <amount>` (1-100)\nCurrently: `' + config.xpPerMessage + '` XP per message');
        }
        
        config.xpPerMessage = newXP;
        saveData();
        
        await message.reply(`✅ Set XP per message to: **${newXP}** XP\n*Messages now give ${Math.floor(newXP * 0.7)}-${newXP} XP*`);
    }
    
    else if (command === 'xpinfo') {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📊 XP System Info')
            .addFields(
                { name: 'XP Per Message', value: `${Math.floor(config.xpPerMessage * 0.7)}-${config.xpPerMessage} XP`, inline: true },
                { name: 'XP Cooldown', value: `${config.xpCooldown / 1000} seconds`, inline: true },
                { name: 'Max Level', value: '100+', inline: true },
                { name: 'Level 1', value: '100 XP', inline: true },
                { name: 'Level 10', value: `${xpForLevel(10).toLocaleString()} XP`, inline: true },
                { name: 'Level 50', value: `${xpForLevel(50).toLocaleString()} XP`, inline: true },
                { name: 'Level 100', value: `${xpForLevel(100).toLocaleString()} XP`, inline: true }
            )
            .setFooter({ text: 'Use "setxp <amount>" to change XP per message (owner only)' });
        
        await message.reply({ embeds: [embed] });
    }
    
    // Custom no-prefix command management (only for owners)
    else if ((command === 'addcommand') && isOwnerUser) {
        const cmdName = args[1]?.toLowerCase();
        const response = args.slice(2).join(' ');
        
        if (!cmdName || !response) {
            return message.reply('Usage: `addcommand <command_name> <response>`');
        }
        
        if (!customCommands[message.guild.id]) customCommands[message.guild.id] = {};
        customCommands[message.guild.id][cmdName] = response;
        saveData();
        
        await message.reply(`✅ Added custom command: \`${cmdName}\``);
    }
    
    else if ((command === 'removecommand' || command === 'delcommand') && isOwnerUser) {
        const cmdName = args[1]?.toLowerCase();
        
        if (!cmdName) {
            return message.reply('Usage: `removecommand <command_name>`');
        }
        
        if (!customCommands[message.guild.id] || !customCommands[message.guild.id][cmdName]) {
            return message.reply(`❌ Command \`${cmdName}\` doesn't exist!`);
        }
        
        delete customCommands[message.guild.id][cmdName];
        saveData();
        
        await message.reply(`✅ Removed custom command: \`${cmdName}\``);
    }
    
    else if ((command === 'listcommands') && isOwnerUser) {
        const guildCommands = customCommands[message.guild.id] || {};
        const cmdList = Object.keys(guildCommands);
        
        if (cmdList.length === 0) {
            return message.reply('No custom commands found!');
        }
        
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Custom Commands')
            .setDescription(cmdList.map(cmd => `\`${cmd}\``).join(', '));
        
        await message.reply({ embeds: [embed] });
    }
    
    // Check for custom commands
    else if (customCommands[message.guild.id] && customCommands[message.guild.id][command]) {
        const response = customCommands[message.guild.id][command];
        await message.reply(response);
    }
    
    // Moderation commands (for owners or users with permissions)
    else if ((command === 'warn') && (isOwnerUser || hasModPerms)) {
        const targetUser = message.mentions.users.first();
        const reason = args.slice(2).join(' ') || 'No reason provided';
        
        if (!targetUser) return message.reply('Please mention a user to warn!');
        
        if (!warnings[targetUser.id]) warnings[targetUser.id] = [];
        warnings[targetUser.id].push({
            reason,
            moderator: message.author.id,
            timestamp: new Date().toISOString()
        });
        
        logStaffAction(message.author.id, 'warn', targetUser.id, reason);
        saveData();
        
        const warnEmbed = new EmbedBuilder()
            .setColor('#ff9900')
            .setTitle('User Warned')
            .addFields(
                { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: 'Moderator', value: message.author.tag, inline: true },
                { name: 'Reason', value: reason },
                { name: 'Total Warnings', value: warnings[targetUser.id].length.toString(), inline: true }
            )
            .setTimestamp();
        
        await message.reply({ embeds: [warnEmbed] });
        await sendLog(message.guild, warnEmbed);
    }
    
    else if ((command === 'kick') && (isOwnerUser || hasModPerms)) {
        const targetUser = message.mentions.users.first();
        const reason = args.slice(2).join(' ') || 'No reason provided';
        
        if (!targetUser) return message.reply('Please mention a user to kick!');
        
        const kickMember = message.guild.members.cache.get(targetUser.id);
        if (!kickMember) return message.reply('User not found in server!');
        
        try {
            await kickMember.kick(reason);
            logStaffAction(message.author.id, 'kick', targetUser.id, reason);
            
            const kickEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('User Kicked')
                .addFields(
                    { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                    { name: 'Moderator', value: message.author.tag, inline: true },
                    { name: 'Reason', value: reason }
                )
                .setTimestamp();
            
            await message.reply({ embeds: [kickEmbed] });
            await sendLog(message.guild, kickEmbed);
        } catch (error) {
            await message.reply('Failed to kick user!');
        }
    }
    
    else if ((command === 'ban') && (isOwnerUser || hasModPerms)) {
        const targetUser = message.mentions.users.first();
        const reason = args.slice(2).join(' ') || 'No reason provided';
        
        if (!targetUser) return message.reply('Please mention a user to ban!');
        
        try {
            await message.guild.members.ban(targetUser.id, { reason });
            logStaffAction(message.author.id, 'ban', targetUser.id, reason);
            
            const banEmbed = new EmbedBuilder()
                .setColor('#990000')
                .setTitle('User Banned')
                .addFields(
                    { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                    { name: 'Moderator', value: message.author.tag, inline: true },
                    { name: 'Reason', value: reason }
                )
                .setTimestamp();
            
            await message.reply({ embeds: [banEmbed] });
            await sendLog(message.guild, banEmbed);
        } catch (error) {
            await message.reply('Failed to ban user!');
        }
    }
    
    // Fun commands for everyone
    else if (command === 'ping') {
        const ping = Date.now() - message.createdTimestamp;
        await message.reply(`🏓 Pong! Latency: ${ping}ms`);
    }
    
    else if (command === 'serverinfo') {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(message.guild.name)
            .setThumbnail(message.guild.iconURL())
            .addFields(
                { name: 'Members', value: message.guild.memberCount.toString(), inline: true },
                { name: 'Created', value: message.guild.createdAt.toDateString(), inline: true },
                { name: 'Owner', value: `<@${message.guild.ownerId}>`, inline: true }
            );
        
        await message.reply({ embeds: [embed] });
    }
    
    else if (command === 'userinfo') {
        const targetUser = message.mentions.users.first() || message.author;
        const member = message.guild.members.cache.get(targetUser.id);
        
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`${targetUser.username}'s Info`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'Username', value: targetUser.tag, inline: true },
                { name: 'ID', value: targetUser.id, inline: true },
                { name: 'Joined Server', value: member ? member.joinedAt.toDateString() : 'Unknown', inline: true },
                { name: 'Account Created', value: targetUser.createdAt.toDateString(), inline: true }
            );
        
        await message.reply({ embeds: [embed] });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, member, guild } = interaction;

    try {
        switch (commandName) {
            case 'warn':
                const warnUser = options.getUser('user');
                const warnReason = options.getString('reason');
                
                if (!warnings[warnUser.id]) warnings[warnUser.id] = [];
                warnings[warnUser.id].push({
                    reason: warnReason,
                    moderator: member.user.id,
                    timestamp: new Date().toISOString()
                });
                
                logStaffAction(member.user.id, 'warn', warnUser.id, warnReason);
                saveData();
                
                const warnEmbed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('User Warned')
                    .addFields(
                        { name: 'User', value: `${warnUser.tag} (${warnUser.id})`, inline: true },
                        { name: 'Moderator', value: member.user.tag, inline: true },
                        { name: 'Reason', value: warnReason },
                        { name: 'Total Warnings', value: warnings[warnUser.id].length.toString(), inline: true }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [warnEmbed] });
                await sendLog(guild, warnEmbed);
                break;

            case 'kick':
                const kickUser = options.getUser('user');
                const kickReason = options.getString('reason') || 'No reason provided';
                const kickMember = guild.members.cache.get(kickUser.id);
                
                if (!kickMember) {
                    return await interaction.reply({ content: 'User not found in server!', ephemeral: true });
                }
                
                await kickMember.kick(kickReason);
                logStaffAction(member.user.id, 'kick', kickUser.id, kickReason);
                
                const kickEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('User Kicked')
                    .addFields(
                        { name: 'User', value: `${kickUser.tag} (${kickUser.id})`, inline: true },
                        { name: 'Moderator', value: member.user.tag, inline: true },
                        { name: 'Reason', value: kickReason }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [kickEmbed] });
                await sendLog(guild, kickEmbed);
                break;

            case 'ban':
                const banUser = options.getUser('user');
                const banReason = options.getString('reason') || 'No reason provided';
                const deleteDays = options.getInteger('days') || 0;
                
                await guild.members.ban(banUser.id, { 
                    reason: banReason,
                    deleteMessageDays: deleteDays 
                });
                logStaffAction(member.user.id, 'ban', banUser.id, banReason);
                
                const banEmbed = new EmbedBuilder()
                    .setColor('#990000')
                    .setTitle('User Banned')
                    .addFields(
                        { name: 'User', value: `${banUser.tag} (${banUser.id})`, inline: true },
                        { name: 'Moderator', value: member.user.tag, inline: true },
                        { name: 'Reason', value: banReason },
                        { name: 'Messages Deleted', value: `${deleteDays} days`, inline: true }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [banEmbed] });
                await sendLog(guild, banEmbed);
                break;

            case 'mute':
                const muteUser = options.getUser('user');
                const duration = options.getInteger('duration');
                const muteReason = options.getString('reason') || 'No reason provided';
                const muteMember = guild.members.cache.get(muteUser.id);
                
                if (!muteMember) {
                    return await interaction.reply({ content: 'User not found in server!', ephemeral: true });
                }
                
                const muteUntil = new Date(Date.now() + duration * 60 * 1000);
                await muteMember.timeout(duration * 60 * 1000, muteReason);
                logStaffAction(member.user.id, 'mute', muteUser.id, `${muteReason} (${duration}m)`);
                
                const muteEmbed = new EmbedBuilder()
                    .setColor('#666666')
                    .setTitle('User Muted')
                    .addFields(
                        { name: 'User', value: `${muteUser.tag} (${muteUser.id})`, inline: true },
                        { name: 'Moderator', value: member.user.tag, inline: true },
                        { name: 'Duration', value: `${duration} minutes`, inline: true },
                        { name: 'Reason', value: muteReason },
                        { name: 'Muted Until', value: muteUntil.toLocaleString() }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [muteEmbed] });
                await sendLog(guild, muteEmbed);
                break;

            case 'unmute':
                const unmuteUser = options.getUser('user');
                const unmuteMember = guild.members.cache.get(unmuteUser.id);
                
                if (!unmuteMember) {
                    return await interaction.reply({ content: 'User not found in server!', ephemeral: true });
                }
                
                await unmuteMember.timeout(null);
                logStaffAction(member.user.id, 'unmute', unmuteUser.id, 'Manual unmute');
                
                const unmuteEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('User Unmuted')
                    .addFields(
                        { name: 'User', value: `${unmuteUser.tag} (${unmuteUser.id})`, inline: true },
                        { name: 'Moderator', value: member.user.tag, inline: true }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [unmuteEmbed] });
                await sendLog(guild, unmuteEmbed);
                break;

            case 'warnings':
                const checkUser = options.getUser('user');
                const userWarnings = warnings[checkUser.id] || [];
                
                const warningsEmbed = new EmbedBuilder()
                    .setColor('#ffaa00')
                    .setTitle(`Warnings for ${checkUser.tag}`)
                    .setDescription(userWarnings.length === 0 ? 'No warnings found.' : 
                        userWarnings.map((w, i) => 
                            `**${i + 1}.** ${w.reason}\n*By: <@${w.moderator}> on ${new Date(w.timestamp).toLocaleDateString()}*`
                        ).join('\n\n')
                    );
                
                await interaction.reply({ embeds: [warningsEmbed] });
                break;

            case 'clearwarnings':
                const clearUser = options.getUser('user');
                const clearedCount = warnings[clearUser.id]?.length || 0;
                warnings[clearUser.id] = [];
                saveData();
                
                logStaffAction(member.user.id, 'clear_warnings', clearUser.id, `Cleared ${clearedCount} warnings`);
                
                await interaction.reply(`Cleared ${clearedCount} warnings for ${clearUser.tag}.`);
                break;

            case 'staffstats':
                const staffUser = options.getUser('staff') || member.user;
                const staffStats = staffActions[staffUser.id] || [];
                
                const actionCounts = {};
                staffStats.forEach(action => {
                    actionCounts[action.action] = (actionCounts[action.action] || 0) + 1;
                });
                
                const statsEmbed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle(`Staff Statistics for ${staffUser.tag}`)
                    .addFields(
                        { name: 'Total Actions', value: staffStats.length.toString(), inline: true },
                        { name: 'Action Breakdown', value: Object.entries(actionCounts)
                            .map(([action, count]) => `${action}: ${count}`)
                            .join('\n') || 'No actions recorded' }
                    );
                
                await interaction.reply({ embeds: [statsEmbed] });
                break;

            case 'purge':
                const amount = options.getInteger('amount');
                
                const messages = await interaction.channel.bulkDelete(amount, true);
                logStaffAction(member.user.id, 'purge', interaction.channel.id, `Deleted ${messages.size} messages`);
                
                await interaction.reply({ content: `Deleted ${messages.size} messages.`, ephemeral: true });
                break;

            case 'setup':
                const logChannel = options.getChannel('logchannel');
                const staffRole = options.getRole('staffrole');
                const mutedRole = options.getRole('mutedrole');
                const levelChannel = options.getChannel('levelchannel');
                const countingChannel = options.getChannel('countingchannel');
                
                if (logChannel) config.logChannelId = logChannel.id;
                if (staffRole) config.staffRoleId = staffRole.id;
                if (mutedRole) config.mutedRoleId = mutedRole.id;
                if (levelChannel) config.levelUpChannelId = levelChannel.id;
                if (countingChannel) config.countingChannelId = countingChannel.id;
                
                saveData();
                
                const setupEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('Bot Configuration Updated')
                    .addFields(
                        { name: 'Log Channel', value: logChannel ? logChannel.toString() : 'Not set', inline: true },
                        { name: 'Staff Role', value: staffRole ? staffRole.toString() : 'Not set', inline: true },
                        { name: 'Muted Role', value: mutedRole ? mutedRole.toString() : 'Not set', inline: true },
                        { name: 'Level Up Channel', value: levelChannel ? levelChannel.toString() : 'Not set', inline: true },
                        { name: 'Counting Channel', value: countingChannel ? countingChannel.toString() : 'All channels', inline: true }
                    );
                
                await interaction.reply({ embeds: [setupEmbed] });
                break;

            case 'level':
                const targetUser = options.getUser('user') || member.user;
                const guildId = guild.id;
                const userId = targetUser.id;
                
                if (!userLevels[guildId] || !userLevels[guildId][userId]) {
                    return await interaction.reply(`${targetUser.username} hasn't gained any XP yet!`);
                }
                
                const userData = userLevels[guildId][userId];
                const nextLevelXP = Math.ceil(xpForLevel(userData.level + 1));
                const neededXP = nextLevelXP - userData.xp;
                
                const levelEmbed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle(`${targetUser.username}'s Level`)
                    .setThumbnail(targetUser.displayAvatarURL())
                    .addFields(
                        { name: 'Level', value: userData.level.toString(), inline: true },
                        { name: 'XP', value: userData.xp.toString(), inline: true },
                        { name: 'Next Level', value: `${neededXP} XP needed`, inline: true }
                    );
                
                await interaction.reply({ embeds: [levelEmbed] });
                break;

            case 'leaderboard':
                const type = options.getString('type');
                const guildIdLb = guild.id;
                
                if (type === 'levels') {
                    if (!userLevels[guildIdLb]) return await interaction.reply('No level data available!');
                    
                    const sorted = Object.entries(userLevels[guildIdLb])
                        .sort(([,a], [,b]) => b.xp - a.xp)
                        .slice(0, 10);
                    
                    const leaderboard = sorted.map(([userId, data], index) => {
                        const user = guild.members.cache.get(userId);
                        const username = user ? user.displayName : 'Unknown User';
                        return `${index + 1}. ${username} - Level ${data.level} (${data.xp} XP)`;
                    }).join('\n');
                    
                    const embed = new EmbedBuilder()
                        .setColor('#FFD700')
                        .setTitle('🏆 Level Leaderboard')
                        .setDescription(leaderboard || 'No data available');
                    
                    await interaction.reply({ embeds: [embed] });
                }
                
                else if (type === 'messages') {
                    if (!messageStats[guildIdLb]) return await interaction.reply('No message data available!');
                    
                    const sorted = Object.entries(messageStats[guildIdLb])
                        .sort(([,a], [,b]) => b.total - a.total)
                        .slice(0, 10);
                    
                    const leaderboard = sorted.map(([userId, data], index) => {
                        const user = guild.members.cache.get(userId);
                        const username = user ? user.displayName : 'Unknown User';
                        return `${index + 1}. ${username} - ${data.total} messages`;
                    }).join('\n');
                    
                    const embed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('💬 Message Leaderboard')
                        .setDescription(leaderboard || 'No data available');
                    
                    await interaction.reply({ embeds: [embed] });
                }
                break;

            case 'messagestats':
                const targetUserStats = options.getUser('user') || member.user;
                const period = options.getString('period') || 'total';
                const guildIdStats = guild.id;
                const userIdStats = targetUserStats.id;
                
                if (!messageStats[guildIdStats] || !messageStats[guildIdStats][userIdStats]) {
                    return await interaction.reply(`${targetUserStats.username} has no message statistics!`);
                }
                
                const stats = messageStats[guildIdStats][userIdStats];
                const today = new Date().toDateString();
                const thisWeek = getWeekStart().toDateString();
                const thisMonth = `${new Date().getFullYear()}-${new Date().getMonth()}`;
                
                const embed = new EmbedBuilder()
                    .setColor('#800080')
                    .setTitle(`📊 ${targetUserStats.username}'s Message Statistics`)
                    .setThumbnail(targetUserStats.displayAvatarURL())
                    .addFields(
                        { name: 'Total Messages', value: stats.total.toString(), inline: true },
                        { name: 'Today', value: (stats.daily[today] || 0).toString(), inline: true },
                        { name: 'This Week', value: (stats.weekly[thisWeek] || 0).toString(), inline: true },
                        { name: 'This Month', value: (stats.monthly[thisMonth] || 0).toString(), inline: true }
                    );
                
                await interaction.reply({ embeds: [embed] });
                break;
        }
    } catch (error) {
        console.error('Command error:', error);
        await interaction.reply({ 
            content: 'An error occurred while executing this command.', 
            ephemeral: true 
        });
    }
});

// Handle errors
client.on('error', console.error);
process.on('unhandledRejection', console.error);

// Login
if (!process.env.DISCORD_BOT_TOKEN) {
    console.error('DISCORD_BOT_TOKEN environment variable is required!');
    console.error('Make sure you have a .env file with DISCORD_BOT_TOKEN=your_token');
    process.exit(1);
}

client.login(process.env.DISCORD_BOT_TOKEN);
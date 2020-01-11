const Discord = require('discord.js');
const Auth = require('./auth.json');
const Config = require('./config.json');
const Winston = require('winston');
const Sequelize = require('sequelize');
const http = require('http');
const Express = require('express');
const httpHost = Express();

// Configure logger settings.
var logger = Winston.createLogger({
    transports: [
        new (Winston.transports.Console)({ level: 'verbose' }),
        new (Winston.transports.File)({ filename: 'debug.log', level: 'debug', colorize: false }),
        new (Winston.transports.File)({ filename: 'verbose.log', level: 'verbose', colorize: false }),
        new (Winston.transports.File)({ filename: 'info.log', level: 'info', colorize: false }),
        new (Winston.transports.File)({ filename: 'warn.log', level: 'warn', colorize: false }),
        new (Winston.transports.File)({ filename: 'error.log', level: 'error', colorize: false }),
    ]
});
logger.info('Brewlette is starting.');

// Initialise SQL storage.
const sql = new Sequelize(Config.database.name, Config.database.username, Config.database.password, Config.database.options);

const sqlSettings = sql.define('settings', {
    guildID: { type: Sequelize.STRING, primaryKey: true },
    prefix: Sequelize.STRING,
    channelName: Sequelize.STRING,
    lastMethod: Sequelize.STRING,
    isSpinning: Sequelize.BOOLEAN,
});

// Initialise default settings.

var defaultSettings = Config.defaultSettings || {
    guildID: null,
    prefix: '!brewlette',
    channelName: null,
    lastMethod: 'active',
    isSpinning: false,
}

// Initialise keep-alive http host.
httpHost.get("/", (request, response) =>
{
    logger.verbose('Http request received.');
    response.sendStatus(200);
});
httpHost.listen(process.env.PORT);
setInterval(() =>
{
    logger.verbose('Sending keep-alive request.');
    http.get(Config.keepAlive.url);
}, 280000);

// Initialise Discord Bot.
var discord = new Discord.Client();

discord.once('ready', () =>
{
    logger.info('Connected');

    sqlSettings.sync();
    logger.info('Settings synchronised.');
});

discord.on('message', async message =>
{
    logger.verbose('Message received.');
    logger.debug('Message details.', { details: message });

    // Ignore any messages by bots.
    if (message.author.bot)
    {
        logger.verbose('Message is from a bot, ignoring it.');
        return;
    }

    // Read the settings for the guild.
    logger.debug('Guild.', { guild: message.guild });
    var settings = await LoadGuildSettings(message.guild.id);
    if (!settings)
    {
        logger.verbose('Ignoring message as the settings are invalid.');
        return;
    }
    if (!settings.prefix)
    {
        logger.verbose('Ignoring message as the settings prefix is invalid.');
        return;
    }

    // Parse the arguments.
    let { initiator, command, args } = ParseMessage(message, settings.prefix);

    // Does the message prefix match?
    logger.verbose('Checking prefix.', { initiator: initiator, prefix: settings.prefix });
    if (!((initiator || '').toLowerCase() === (settings.prefix || '').toLowerCase()))
    {
        logger.verbose('Ignoring message as it does not start with the prefix.', { initiator: initiator, prefix: settings.prefix });
        return;
    }

    switch (command)
    {
        case '':
        case 'help':
            {
                ShowHelp(message, settings, args);
            }
            break;
        case 'spin':
            {
                logger.verbose('Spin command received.', { args: args });
                Spin(message, settings, args);
            }
            break;
        case 'vote':
            {
                logger.verbose('Vote command received.', { args: args });
                Vote(message, settings, args);
            }
            break;
        case 'channel':
            {
                logger.verbose('Channel command received.', { args: args });
                SetChannel(message, settings, args);
            }
            break;
        case 'prefix':
            {
                logger.verbose('Prefix command received.', { args: args });
                SetPrefix(message, settings, args);
            }
            break;
        default:
            {
                logger.verbose('Unknown command received.', { command: command, args: args });
                ShowUnknownCommand(message, settings, command, args);
            }
            break;
    }
});

discord.on('messageReactionAdd', (messageReaction, user) =>
{
    // TODO: Used for voting.
    // Note: Might be better to use message.createReactionCollector instead?
});

// Parses a bot command message into the constituent parts.
function ParseMessage(message, prefix)
{
    var line = message.content.split(/ +/);
    var initiator = line.shift();
    var command = line.shift();
    var args = line;

    return {
        initiator: initiator,
        command: command.toLowerCase(),
        args: args,
    }
}

// Loads the settings for a given guild (discord server).
async function LoadGuildSettings(guildID)
{
    try
    {
        // Read the settings from persistent storage for the specified guild.
        var settings = await sqlSettings.findOne({ where: { guildID: guildID } });

        // If no settings exist, create them using defaults.
        settings = settings || defaultSettings;

        // Ensure validity of the prefix (i.e. ensure there is never no prefix as it would prevent any commands from being registered at all).
        settings.prefix = settings.prefix || '!brewlette';

        // Ensure validity of the guild ID.
        settings.guildID = settings.guildID || guildID;

        logger.verbose('Loaded settings', { guildID: guildID, settings: settings });

        return settings;
    }
    catch (e)
    {
        logger.error('Failed to read guild settings.', { exception: e, guildID: guildID });
        throw e;
    }
}

// Stores the settings for a guild in the persistent storage.
async function SaveGuildSettings(settings)
{
    try
    {
        logger.verbose('Updating settings.', { settings: settings });
        // Note: passing the entire settings object as its properties match. Should the properties ever diverge from the table columns this will need to change.
        // Additionally, it does mean that technically the guildID is updated redundantly also but that shouldn't be an issue.
        var affectedRowCount = await sqlSettings.update({
            prefix: settings.prefix,
            channelName: settings.channelName,
            lastMethod: settings.lastMethod,
            isSpinning: settings.isSpinning,
        }, {
                where: {
                    guildID: settings.guildID
                }
            });
        if (affectedRowCount == 0)
        {
            logger.verbose('Settings didn\'t exist, creating them.')
            // Settings didn't exist for the given guild, so create them instead.
            await sqlSettings.create({
                guildID: settings.guildID,
                prefix: settings.prefix,
                channelName: settings.channelName,
                lastMethod: settings.lastMethod,
                isSpinning: settings.isSpinning,
            });
        }
    }
    catch (e)
    {
        logger.error('Failed to save guild settings.', { exception: e, settings: settings });
        throw e;
    }
}

function Spin(message, settings, args)
{
    var brewletteMessage = message.channel.send('TODO: Spin.');
}

function Vote(message, settings, args)
{
    // TODO: Remaining emojis.
    const emojiList = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
    // TODO: Properly dynamic users list.
    var voteUsers = ['Simon', 'Billy', 'Jamie', 'Andy'];
    var voteResults = [];

    function _AddReactions(brewletteMessage)
    {
        logger.verbose('Adding reactions.');
        return new Promise((resolve, reject) =>
        {
            try
            {
                var emojis = [];
                voteUsers.forEach((item, index) =>
                {
                    var emoji = emojiList[index];
                    emojis.push(emoji);
                });

                emojis.reduce((promise, emoji) => promise.then(() => brewletteMessage.react(emoji)), Promise.resolve());

                logger.verbose('Reactions added.');
                resolve();
            }
            catch (e)
            {
                logger.error('Failed to add reactions.', { exception: e });
                reject();
            }
        });
    }

    function _ListenForReactions(brewletteMessage)
    {
        const filter = (reaction, user) =>
        {
            logger.debug('Filtering reaction', reaction, user);
            return !user.bot;
        };

        var reactionCollector = brewletteMessage.createReactionCollector(filter, { time: 30000 });
        reactionCollector.on('collect', (reaction, collector) =>
        {
            // Remove the reaction to hide the votes.
            reaction.remove();

            // TODO: Log the reaction.
            logger.verbose('Reaction found.', reaction);
        });
        reactionCollector.on('end', (reaction) =>
        {
            // Tally up the votes
            logger.verbose('Reaction collection ended.');

            // TODO: Remove all reactions.
        });
    }

    var brewletteMessage = undefined;

    message.channel.send('WIP: Vote.')
        .then(newMessage =>
        {
            brewletteMessage = newMessage;
            _ListenForReactions(brewletteMessage)
                .then(() => _AddReactions(brewletteMessage));
        });
}

function SetPrefix(message, settings, args)
{
    try
    {
        settings.prefix = args.shift();
        settings.prefix = settings.prefix || defaultSettings.prefix;
        SaveGuildSettings(settings);
        message.channel.send(`Brewlette will now respond to the prefix **${settings.prefix}**. To change this again, type **${settings.prefix} prefix <new prefix>** or just **${settings.prefix} prefix** to reset it to the default of ${defaultSettings.prefix}.`);
    }
    catch (e)
    {
        logger.error('Unable to save settings.', { exception: e });
        try
        {
            message.channel.send('Error, unable to save settings. See the server log for more information.');
        }
        catch (e)
        {
            logger.error('Unable to send failed to save settings message.', { exception: e });
        }
    }
}

function SetChannel(message, settings, args)
{
    try
    {
        var channelName = args.shift();
        if (channelName)
        {
            // Verify the channel.
            var channel = message.guild.channels.find('name', channelName)
            settings.channelName = channelName;
            SaveGuildSettings(settings);
            if (channel)
            {
                message.channel.send(`Brewlette will now send spin/vote messages to the channel <#${channel.id}>`);
            }
            else
            {
                message.channel.send(`Brewlette will try sending spin/vote messages to the channel #${channelName} though the channel couldn't be found at this time.`);
            }
        }
        else
        {
            // Verify the channel.
            var channel = message.guild.channels.find('name', settings.channelName);
            if (channel)
            {
                message.channel.send(`Brewlette is sending spin/vote messages to the channel <#${channel.id}>`);
            }
            else
            {
                message.channel.send(`Brewlette will try sending spin/vote messages to the channel #${settings.channelName} though the channel couldn't be found at this time.`);
            }
        }
    }
    catch (e)
    {
        logger.error('Unable to save settings.', { exception: e });
        try
        {
            message.channel.send('Error, unable to save settings. See the server log for more information.');
        }
        catch (e)
        {
            logger.error('Unable to send failed to save settings message.', { exception: e });
        }
    }
}

function ShowHelp(message, settings, args)
{
    // TODO: Show help information here.
    // TODO: Show help information for specific arguments if specified.
    message.channel.send('Please see usage.txt for information on how to use this bot (TODO: Show the info here).');
}

function ShowUnknownCommand(message, settings, command, args)
{
    message.channel.send('Unknown command: ' + command);
}

discord.login(Auth.token);
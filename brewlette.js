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

discord.on('ready', () =>
{
    logger.info(`Logged in as ${discord.user.tag}!`);

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
        case 'test':
            {
                logger.verbose('Test command received.', { args: args });
                Test(message, settings, args);
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

function GetMembers(message, method, param)
{
    const _FilterAll = function (member)
    {
        return !member.user.bot;
    }
    const _FilterOnline = function (member)
    {
        return !member.user.bot && member.user.presence.status !== 'offline';
    }
    const _FilterActive = function (member)
    {
        return !member.user.bot && member.user.presence.status === 'online';
    }
    const _FilterRole = function (member, roleName)
    {
        return !member.user.bot && member.roles.some(role => role.name.toLowerCase() === roleName.toLowerCase());
    }

    const _GetMembers = function (members, filterFunction, filterParam)
    {
        var filteredMembers = members.filter(member => filterFunction(member, filterParam));
        var randomMembers = filteredMembers.random(26).filter(item => item !== undefined);
        console.log(randomMembers);

        var selectedIndex = parseInt(Math.random() * randomMembers.length);
        var selected = randomMembers[selectedIndex];

        return {
            selected: selected,
            eligible: randomMembers,
            poolSize: filteredMembers.array().length,
            isCustom: false,
        }
    }

    const _GetCustomUsers = function (args)
    {
        // TODO: implement.

        // TODO: Combine the args into a single string again.
        // TODO: Split the string based on commas.
        // TODO: Trim the resulting array items.
        // TODO: Convert the array into a results object.

        var memberNames = args.join(' ');
        var members = memberNames.split(',').map(item => item.trim());

        // TODO: Implement choosing 26 random if the size of the pool is greater than 26.

        //var filteredMembers = new Discord.Collection(members);
        //var randomMembers = filteredMembers.random(26).filter(item => item !== undefined);
        var randomMembers = members;

        var selectedIndex = parseInt(Math.random() * randomMembers.length);
        var selected = randomMembers[selectedIndex];

        return {
            selected: selected,
            eligible: randomMembers,
            poolSize: randomMembers.length, //filteredMembers.array().length,
            isCustom: true,
        }
    }

    var results = undefined;

    console.log('starting promise');

    return new Promise((resolve, reject) =>
    {
        console.log('processing');
        switch (method.toLowerCase())
        {
            case 'role':
                {
                    var roleName = args.shift();

                    logger.verbose('Getting role-based guild member list.');

                    message.guild.members.fetch()
                        .then(m =>
                        {
                            console.log('resolving');
                            resolve(_GetMembers(m, _FilterRole, roleName));
                        })
                        .catch(logger.error);
                }
                break;
            case 'all':
                {
                    logger.verbose('Getting all guild member list.');

                    message.guild.members.fetch()
                        .then(m =>
                        {
                            console.log('resolving');
                            resolve(_GetMembers(m, _FilterAll))
                        })
                        .catch(logger.error);
                }
                break;
            case 'online':
                {
                    logger.verbose('Getting online guild member list.');

                    message.guild.members.fetch()
                        .then(m =>
                        {
                            console.log('resolving');
                            resolve(_GetMembers(m, _FilterOnline))
                        })
                        .catch(logger.error);
                }
                break;
            case 'active':
                {
                    logger.verbose('Getting active guild member list.');

                    message.guild.members.fetch()
                        .then(m =>
                        {
                            console.log('resolving');
                            resolve(_GetMembers(m, _FilterActive))
                        })
                        .catch(logger.error);
                }
                break;
            case 'custom':
                {
                    logger.verbose('Getting custom user list.');
                    resolve(_GetCustomUsers(param));
                }
                break;
        }
    });
}

function Test(message, settings, args)
{
    logger.debug('Testing', { args: args });
    var method = args.shift() || '';
    GetMembers(message, method, args)
        .then(results =>
        {
            console.log('handling results');
            if (results.selected)
            {
                message.channel.send(`<@${results.selected.id}> (${results.selected.displayName}) was selected from a pool of ${results.poolSize}`);
            }
            else
            {
                message.channel.send(`No-one is eligible!`);
            }
        }).catch(console.log);
}

function Spin(message, settings, args)
{
    var method = args.shift() || settings.lastMethod || 'active';
    GetMembers(message, method, args)
        .then(results =>
        {
            console.log(results);

            var attachment = new Discord.MessageAttachment('./images/roulette.gif', 'roulette.gif');
            var embed = new Discord.MessageEmbed()
                .setTitle("Round and round it goes, who makes the tea, nobody knows...")
                .setDescription(`Who will be the lucky winner who gets the honours?`)
                .attachFiles(attachment)
                .setImage('attachment://roulette.gif')
                .setFooter(`Find out in a moment...`);

            var brewletteMessage = undefined;

            logger.verbose('Sending spin message.');
            message.channel.send({ embed: embed })
                .then(newMessage =>
                {
                    logger.verbose('Spin message sent.');
                    brewletteMessage = newMessage;

                    setTimeout(() =>
                    {
                        logger.verbose('Spin delay elapsed, editing message.');

                        brewletteMessage.attachments.clear();

                        const _GetWinningUser = function(results)
                        {
                            if (results.isCustom)
                            {
                                return results.selected || results.selected.displayName || results.selected.user.username;
                            }
                            else
                            {
                                return results.selected;
                            }
                        }

                        var newAttachment = new Discord.MessageAttachment('./images/teabag.gif', 'teabag.gif');
                        var newEmbed = new Discord.MessageEmbed()
                            .setTitle("We have a winner!")
                            .setDescription(`**${_GetWinningUser(results)}** has been selected to make the drinks.`)
                            .attachFiles(newAttachment)
                            .setImage('attachment://teabag.gif');

                        // TODO: if possible, mention the winner (not possible for the custom method).

                        brewletteMessage.delete()
                            .then(() =>
                            {
                                message.channel.send({ embed: newEmbed });
                                logger.verbose('Original message deleted and new message sent.');
                            })
                    }, 10000);
                });
        });
}

function Vote(message, settings, args)
{
    // TODO: Remaining emojis.
    const emojiList = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
    // TODO: Properly dynamic users list.
    var voteUsers = ['Simon', 'Billy', 'Jamie', 'Stephen'];
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
            var channel = message.guild.channels.find(channel => channel.channelName === channelName);
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
            var channel = message.guild.channels.find(channel => channel.channelName === channelName);
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
var prefix = "!brewlette";

parse('!brewlette', prefix);
parse('!brewlette channel test', prefix);
parse('!brewlette spin', prefix);
parse('!brewlette spin custom Stephen,Simon', prefix);
parse('!brewlette spin custom Stephen,"Simon Sibley", Jamie', prefix);

console.log('--');

prefix = "!b";
parse('!b spin', prefix);
parse('!brewlette spin', prefix);

function parse(message, prefix)
{
    console.log('Parsing message', message, 'using prefix', prefix);

    var line = message.split(/ +/);
    var initiator = line.shift();
    var command = line.shift();
    var args = line;
    console.log("initiator", initiator, "command", command, "args", args);
    console.log('');
}
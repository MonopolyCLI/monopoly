const chalk = require("chalk");

var stringToColor = function (str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  var color = "#";
  for (var i = 0; i < 3; i++) {
    var value = (hash >> (i * 8)) & 0xff;
    color += ("00" + value.toString(16)).substr(-2);
  }
  return color;
};

function log(msg, service) {
  let output = msg;

  // If a service name is provided, prefix each line with the service name
  if (service) {
    const color = stringToColor(service);
    output = output
      .split("\n")
      .map((line) => `${chalk.hex(color).bold("[" + service + "]")} ${line}`)
      .join("\n");
  }

  console.log(output);
}
// Same as log but make output text bold red
function error(msg, service) {
  // Make each line bold red
  let output = msg
    .split("\n")
    .map((line) => `${chalk.redBright.bold(line)}`)
    .join("\n")
    .trim();

  if (service) {
    const color = stringToColor(service);
    output = output
      .split("\n")
      .map((line) => `${chalk.hex(color).bold("[" + service + "]")} ${line}`)
      .join("\n");
  }

  console.error(output);
}

module.exports = { log, error };

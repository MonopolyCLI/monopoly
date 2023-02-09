const { promisify } = require("util");
const { exec, spawn } = require("child_process");
const path = require("path");
const chalk = require("chalk");
const fs = require("fs/promises");
const pexec = promisify(exec);
const StdBuff = require("./stdbuff");
const SecretStore = require("./secrets");

const DIRNAME = path.join(__dirname, "..", "repos");
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

class Service {
  constructor(name, url, target) {
    this.url = url;
    this.name = name;
    this.target = target;
    this.color = stringToColor(this.name);
    this.dir = path.join(DIRNAME, this.name);
    this.secrets = new SecretStore(this.name, this.target);
  }
  // Check if a git repository is dirty.
  // If this function returns "" it is clean.
  // Otherwise it will return the list of dirty files.
  async dirty() {
    const proc = await pexec("git status --porcelain", {
      cwd: this.dir,
    });
    return proc.stdout.trim();
  }
  // Report out the current status of this service
  async status() {
    if (!(await this.exists())) {
      this.stdout(chalk.redBright(`${this.name} MISSING!`));
    }
    const dirty = await this.dirty();
    if (!dirty) {
      this.stdout(chalk.greenBright("clean"));
    } else {
      this.stdout(dirty);
    }
  }
  // Check to see if this service has been clone from git
  async exists() {
    try {
      await fs.stat(this.dir);
    } catch (e) {
      return false;
    }
    return true;
  }
  // Clone this repository from git
  async clone() {
    if (await this.exists()) {
      return;
    }
    await fs.mkdir(DIRNAME, { recursive: true });
    this.stdout("git clone");
    await this.command("git", ["clone", "--verbose", this.url, this.dir]);
    this.stdout("git clone done");
  }
  // Setup dependencies
  async install() {
    this.stdout("npm install");
    await this.command(
      "npm",
      ["install", "--no-progress", "--log-level=warn"],
      {
        cwd: this.dir,
      }
    );
    this.stdout("npm install done");
  }
  async command(cmd, args, opts) {
    await new Promise((resolve, reject) => {
      const child = spawn(cmd, args, opts);
      let exit = false;
      const buff = new StdBuff(child.stdout, child.stderr);
      buff.on("stdout", (line) => this.stdout(line));
      buff.on("stderr", (line) => this.stdout(line));
      child.on("error", () => {
        if (exit) {
          return;
        }
        exit = true;
        reject();
      });
      child.on("exit", (code) => {
        if (exit) {
          return;
        }
        exit = true;
        if (code === 0) {
          resolve();
        } else {
          reject();
        }
      });
    });
  }
  // Write a message to stdout prefixed by the service's name
  stdout(msg) {
    if (msg.trim() === "") {
      return;
    }
    const line = msg
      .split("\n") // Split around newline
      .filter((v) => v.trim() !== "") // Remove empty lines
      .map((v) => `${chalk.hex(this.color).bold("[" + this.name + "]")} ${v}`) // Prefix each line
      .join("\n"); // Join back into lines
    console.log(line);
  }
  // Write a message to stderr prefixed by the service's name
  stderr(msg) {
    // Same as stdout but make output text bold red
    if (msg.trim() === "") {
      return;
    }
    const line = msg
      .split("\n")
      .map((v) => v.trim())
      .filter((v) => v.trim() !== "")
      .map(
        (v) =>
          `${chalk
            .hex(this.color)
            .bold("[" + this.name + "]")} ${chalk.redBright.bold(v)}`
      )
      .join("\n")
      .trim();
    console.erro(line);
  }
}
module.exports = Service;

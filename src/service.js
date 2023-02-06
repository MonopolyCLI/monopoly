const { promisify } = require("util");
const { exec, spawn } = require("child_process");
const path = require("path");
const chalk = require("chalk");
const fs = require("fs/promises");
const pexec = promisify(exec);

const DIRNAME = path.join(__dirname, "..", "repos");
const colors = ["red", "yellow", "green", "blue", "magenta", "cyan", "white"];
let colorDistributor = 0;

class Service {
  constructor(name, url) {
    this.url = url;
    this.name = name;
    this.color = colors[colorDistributor++];
    this.dir = path.join(DIRNAME, this.name);
  }
  // Check if a git repository is dirty.
  // If this function returns "" it is clean.
  // Otherwise it will return the list of dirty files.
  async dirty() {
    const proc = await pexec("git status --porcelain", {
      cwd: this.dir,
    });
    return proc.stdout;
  }
  // Report out the current status of this service
  async status() {
    if (!(await this.exists())) {
      return console.log(chalk.redBright(`${this.name} missing`));
    }
    const dirty = await this.dirty();
    if (!dirty) {
      console.log(chalk.greenBright.bold(`${this.name} is clean`));
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
    await new Promise((resolve, reject) => {
      const clone = spawn("git", ["clone", "--verbose", this.url, this.dir]);
      let exit = false;
      clone.stdout.on("data", (data) => {
        this.stdout(data.toString());
      });
      clone.stderr.on("data", (data) => {
        this.stdout(data.toString());
      });
      clone.on("error", () => {
        if (exit) {
          return;
        }
        exit = true;
        reject();
      });
      clone.on("exit", (code) => {
        if (exit) {
          return;
        }
        exit = true;
        if (code === 0) {
          this.stdout("Done!");
          resolve();
        } else {
          reject();
        }
      });
    });
  }
  async npm() {
    await new Promise((resolve, reject) => {
      const clone = spawn("npm", ["install"], {
        cwd: this.dir,
      });
      let exit = false;
      clone.stdout.on("data", (data) => {
        this.stdout(data.toString());
      });
      clone.stderr.on("data", (data) => {
        this.stdout(data.toString());
      });
      clone.on("error", () => {
        if (exit) {
          return;
        }
        exit = true;
        reject();
      });
      clone.on("exit", (code) => {
        if (exit) {
          return;
        }
        exit = true;
        if (code === 0) {
          this.stdout("Done!");
          resolve();
        } else {
          reject();
        }
      });
    });
  }
  // Write a message to stdout prefixed by the service's name
  stdout(msg) {
    const line = msg
      .split("\n")
      .filter((v) => v !== "")
      .map((v) => v.trim())
      .map((v) => `${chalk[this.color].bold("[" + this.name + "]")} ${v}`)
      .join("\n");
    console.log(line);
  }
}
module.exports = Service;

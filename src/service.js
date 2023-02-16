const { promisify } = require("util");
const { exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs/promises");
const pexec = promisify(exec);
const SecretStore = require("./secrets");
const StdBuff = require("./stdbuff");

const DIRNAME = path.join(__dirname, "..", "repos");

function formatEnvKey(str) {
  return str.replace(/-/g, "_").toUpperCase();
}

class Resource {
  constructor(name, config) {
    this.name = name;
    this.config = {};
    Object.keys(config || {}).forEach((key) => {
      this.config[formatEnvKey(key)] = config[key];
    });

    // Setup default config values
    this.config["HOST"] = this.config["HOST"] || "127.0.0.1";
    this.config["NODE_ENV"] = this.config["NODE_ENV"] || "development";
  }
  configureService() {
    const config = this.config;
    const name = this.name;
    const keys = Object.keys(config);
    const result = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = config[key];
      result[formatEnvKey(`${name}_${key}`)] = value;
    }
    return result;
  }
  configureSelf() {
    const config = this.config;
    const keys = Object.keys(config);
    const result = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = config[key];
      result[formatEnvKey(`${key}`)] = value;
    }
    return result;
  }
}

class Repo extends Resource {
  constructor(name, repo, config) {
    super(name, config);
    this.repo = repo;
    this.dir = path.join(DIRNAME, this.name);
  }
  // Get the branch name
  async branch() {
    const proc = await pexec("git symbolic-ref --short HEAD", {
      cwd: this.dir,
    });
    return proc.stdout.trim();
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
    const [branch, dirty] = await Promise.all([this.branch(), this.dirty()]);
    return { branch, dirty };
  }
  // Check to see if this service has been cloned from git
  async exists() {
    try {
      await fs.stat(this.dir);
    } catch (e) {
      return false;
    }
    return true;
  }
  // Clone this repository from git
  async clone(buffer) {
    await fs.mkdir(DIRNAME, { recursive: true });
    await this.command(
      "git",
      ["clone", "--verbose", this.repo, this.dir],
      {},
      buffer
    );
  }
  // Run a command inside the Repo's directory
  async command(cmd, args, opts, buffer) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, opts);
      let exit = false;
      child.stdout.on("data", (data) => buffer.stdout(data));
      child.stderr.on("data", (data) => buffer.stderr(data));
      child.on("error", (e) => {
        if (exit) {
          return;
        }
        exit = true;
        reject(e);
      });
      child.on("exit", (code) => {
        if (exit) {
          return;
        }
        exit = true;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Process returned status code ${code}`));
        }
      });
    });
  }
}

class Service extends Repo {
  constructor(name, repo, config) {
    super(name, repo, config);
    this.local = new SecretStore(this.name, "local");
    this.staging = new SecretStore(this.name, "staging");
    this.prod = new SecretStore(this.name, "prod");
  }
  async dev(buffer) {
    await this.command(
      "npm",
      ["run", "dev"],
      {
        cwd: this.dir,
      },
      buffer
    );
  }
  // Setup dependencies
  async install(buffer) {
    await this.command(
      "npm",
      ["install", "--no-progress", "--log-level=warn"],
      {
        cwd: this.dir,
      },
      buffer
    );
  }
}

module.exports = { Service, Repo, Resource };

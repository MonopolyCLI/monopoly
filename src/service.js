const { promisify } = require("util");
const { exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs/promises");
const pexec = promisify(exec);
const SecretStore = require("./secrets");
const StdBuff = require("./stdbuff");

const DIRNAME = path.join(__dirname, "..", "repos");

function formatEnvKey(str) {
  return str.replace(/-/g, "_").replace(/\//g, "_").toUpperCase();
}

// Helper function for running commands
function command(cmd, args, opts, buffer) {
  return new Promise((resolve, reject) => {
    args.shell = true;
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

class Resource {
  constructor(name, def) {
    this.name = name;
    // If a resource has any source files, the get installed under the name of the
    // resource in resources.json
    const dir = name;
    if (def.hasOwnProperty("repo")) {
      this.repo = new Repo(dir, def.repo);
    }

    this.services = [];
    // Support a short-hand property "service" when there is only one service to
    // define
    if (def.hasOwnProperty("service")) {
      // Shorthand uses the root directory of the repo
      this.services.push(new Service(dir, def.service));
    }
    if (def.hasOwnProperty("services")) {
      for (let serviceName in def.services) {
        let serviceDef = def.services[serviceName];
        // The service name is the subdirectory in the repo
        let subdir = path.join(dir, serviceName);
        this.services.push(new Service(subdir, serviceDef));
      }
    }

    // Only define a services property if resource includes at
    // least one service definition
    if (this.services.length === 0) {
      delete this.services;
    }
  }
}

class Service {
  constructor(dir, def) {
    this.name = dir;
    this.dir = path.join(DIRNAME, dir);
    // Default commands
    this.commands = {
      dev: ["npm", "run", "dev"],
      install: ["npm", "install", "--no-progress", "--log-level=warn"],
    };
    // Override defaults if provided
    if (def.hasOwnProperty("commands")) {
      this.commands = {
        ...this.commands,
        ...def.commands,
      };
      for (let command in this.commands) {
        let args = this.commands[command];
        if (args !== null && !Array.isArray(args)) {
          throw new Error(
            `${dir}.commands.${command} must be an array or null`
          );
        }
      }
    }

    // Setup our configuration
    this.config = {};
    if (def.hasOwnProperty("config")) {
      Object.keys(def.config).forEach((key) => {
        this.config[formatEnvKey(key)] = def.config[key];
      });
      this.config["HOST"] = this.config["HOST"] || "127.0.0.1";
      this.config["NODE_ENV"] = this.config["NODE_ENV"] || "development";
    }

    // Setup secrets for each env
    this.local = new SecretStore(this.name, "local");
    this.staging = new SecretStore(this.name, "staging");
    this.prod = new SecretStore(this.name, "prod");
  }
  async dev(buffer) {
    if (this.commands.dev === null) {
      return;
    }
    const cmd = this.commands.dev[0];
    const args = this.commands.dev.slice(1);
    let opts = {};
    // Only set the current working directory if our dir exists
    if (await this.hasDir()) {
      opts.cwd = this.dir;
    }
    await command(cmd, args, opts, buffer);
  }
  async install(buffer) {
    if (this.commands.install === null) {
      return;
    }
    const cmd = this.commands.install[0];
    const args = this.commands.install.slice(1);
    let opts = {};
    // Only set the current working directory if our dir exists
    if (await this.hasDir()) {
      opts.cwd = this.dir;
    }
    await command(cmd, args, opts, buffer);
  }
  // Get env file for other services
  configureService() {
    const config = this.config;
    const name = this.name;
    const keys = Object.keys(config);
    const result = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "NODE_ENV") {
        continue; // Skip node_env for other services
      }
      const value = config[key];
      result[formatEnvKey(`${name}_${key}`)] = value;
    }
    return result;
  }
  // Get env file for self
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
  async hasDir() {
    try {
      await fs.stat(this.dir);
    } catch (e) {
      return false;
    }
    return true;
  }
}

class Repo {
  constructor(name, url) {
    this.name = name;
    this.url = url;
    this.dir = path.join(DIRNAME, name);
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
    await command(
      "git",
      ["clone", "--verbose", this.url, this.dir],
      {},
      buffer
    );
  }
}

module.exports = { Service, Repo, Resource };

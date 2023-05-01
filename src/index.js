#!/usr/bin/env node
const { Resources } = require("./parsers");
const { exec } = require("child_process");
const { once } = require("events");
const chalk = require("chalk");
const prompts = require("prompts");
const logger = require("./logger");
const { StdBuff, FileWriterBuff, FileReaderBuff } = require("./stdbuff");
const fs = require("fs/promises");
const path = require("path");

const { Listr } = require("listr2");

// Load in the resource definitions and instantiate them

// The CLI object's async classes map 1:1 with commands. It's just a wrapper
// around the Service object that handles batching commands.
class CLI {
  constructor(resourceFile) {
    this.resources = new Resources(resourceFile);
    this.services = this.resources.services();
    this.repos = this.resources.repos();
  }
  async clone() {
    const clone = async (repo) => {
      if (await repo.exists()) {
        return; // Short circuit
      }
      const buffer = new StdBuff();
      let msg = [];
      buffer.on("stdout", (line) => msg.push(line));
      buffer.on("stderr", (line) => msg.push(line));
      try {
        await repo.clone(buffer);
      } catch (e) {
        buffer.flush();
        e.stdio = msg.join("\n");
        throw e;
      }
    };
    const clones = this.repos.map((repo) => ({
      title: `Cloning ${repo.name}...`,
      task: async (_, task) => {
        try {
          await clone(repo);
        } catch (e) {
          task.title = `Cloning ${repo.name}... Failed`;
          task.stdout().write(e.stdio);
          throw new Error(`Cloning ${repo.name}... ${e.message}`);
        }
        task.title = `Cloning ${repo.name}... Done!`;
      },
      options: {
        persistentOutput: true,
      },
    }));
    await new Listr(clones, {
      concurrent: true,
      exitOnError: false,
    }).run();
  }
  async dev() {
    // Ask the user which services they want to run
    const choices = this.services.map((service) => ({
      title: service.name,
      value: service.name,
    }));
    const input = await prompts({
      type: "multiselect",
      name: "names",
      message: "Which services should we start locally?",
      choices,
    });

    // Convert their response into an array of services and
    // abort if we don't have any work
    if (!input.hasOwnProperty("names")) {
      console.error(chalk.yellowBright.bold("No services selected"));
      process.exit(1);
    }
    const enabled = this.services.filter(
      (service) => input.names.indexOf(service.name) !== -1
    );

    // Start the dev server for each service
    const dev = async (service) => {
      const buffer = new FileWriterBuff(service.name);
      await buffer.open();
      try {
        logger.log(`Running`, service.name);
        await service.dev(buffer);
      } catch (e) {
        logger.error(e.toString(), service.name);
        await buffer.close();
        return process.exit(1);
      }
    };
    const devs = enabled.map((service) => dev(service));
    await Promise.all(devs);
  }
  async install() {
    const install = async (service) => {
      logger.log("npm install", service.name);
      const buffer = new StdBuff();
      let msg = [];
      buffer.on("stdout", (line) => msg.push(line));
      buffer.on("stderr", (line) => msg.push(line));
      try {
        await service.install(buffer);
        logger.log("npm install finished", service.name);
      } catch (e) {
        // Only write logs if something goes wrong
        buffer.flush();
        logger.error(e.toString(), service.name);
        const log = msg.join("\n");
        if (log.trim() !== "") {
          logger.error(log, service.name);
        }
        throw new Error(`${service.name} failed install`);
      }
    };
    const installs = this.services.map((service) => install(service));
    const results = await Promise.allSettled(installs);
    this.done(results, "Have All Dependencies", "Install Failed");
  }
  async logs() {
    // Ask the user which services they want logs from
    const choices = this.services.map((service) => ({
      title: service.name,
      value: service.name,
    }));
    const input = await prompts({
      type: "multiselect",
      name: "names",
      message: "Which services should we start locally?",
      choices,
    });

    // Convert their response into an array of services and
    // abort if we don't have any work
    if (!input.hasOwnProperty("names")) {
      console.error(chalk.yellowBright.bold("No services selected"));
      process.exit(1);
    }
    const enabled = this.services.filter(
      (service) => input.names.indexOf(service.name) !== -1
    );

    // Start the dev server for each service
    const log = async (service) => {
      const buffer = new FileReaderBuff(service.name);
      buffer.on("stdout", (data) => logger.log(data, service.name));
      buffer.on("stderr", (data) => logger.error(data, service.name));
      await buffer.follow();
    };
    const devs = enabled.map((service) => log(service));
    await Promise.all(devs);
  }
  async status() {
    const checkStatus = async (repo) => {
      const exists = await repo.exists();
      if (!exists) {
        return logger.error("Missing repository", repo.name);
      }
      const { branch, dirty } = await repo.status();
      let msg = "";
      if (branch === "main" || branch === "master") {
        msg += branch;
      } else {
        msg += chalk.yellowBright.bold(branch);
      }
      msg += ": ";
      if (dirty) {
        msg += chalk.yellowBright.bold("dirty");
        logger.log(msg, repo.name);
        logger.log(dirty, repo.name);
      } else {
        msg += "clean";
        logger.log(msg, repo.name);
      }
    };
    const checks = this.repos.map((service) => checkStatus(service));
    await Promise.all(checks);
  }
  done(results, success, error) {
    const rejected = results.filter((promise) => promise.status === "rejected");
    if (rejected.length > 0) {
      rejected
        .filter((promise) => promise.reason)
        .forEach((promise) => this.error(promise.reason));
      this.error(error);
      process.exit(1);
    } else {
      this.success(success);
    }
  }
  success(msg) {
    console.error(chalk.greenBright.bold(msg));
  }
  error(msg) {
    console.error(chalk.redBright.bold(msg));
  }
}

function help() {
  /*
  monopoly - autocode's internal polyrepo orchestrator

    init     create a monopoly repo
    clone    makes sure all repositories are cloned
    install  run install for all repositories
    status   reports the git status of each repository
    dev      start selected services
    logs     follow logs from selected services
  */
}

// Ensure we are running in a monopoly directory
async function loadResourceFile() {
  const file = path.join(process.cwd(), "monopoly.json");
  try {
    return await fs.readFile(file, "utf-8");
  } catch (e) {
    console.error(
      chalk.redBright.bold(
        "Monopoly must be run in a directory containing monopoly.json"
      )
    );
    process.exit(1);
  }
}

async function init() {
  // create monopoly.json
  const file = path.join(process.cwd(), "monopoly.json");
  try {
    await fs.stat(file);
  } catch (e) {
    await fs.writeFile(file, "{}", "utf-8");
  }
  // init git
  const git = exec("git init");
  await once(git, "close");
  console.log(chalk.greenBright.bold("Created a monopoly repository!"));
}

// Strip off node and file
const argv = process.argv.slice(2);
async function main() {
  const command = argv[0];
  const args = argv.slice(1);
  if (command === "init") {
    return init();
  }
  const cli = new CLI(await loadResourceFile());
  switch (command) {
    case "clone":
      return cli.clone();
    case "status":
      return cli.status();
    case "install":
      return cli.install();
    case "dev":
      return cli.dev();
    case "logs":
      return cli.logs();
    default:
      return console.log(help.toString().split("\n").slice(2, -2).join("\n"));
      const { repo, config } = resourceFile[name];
  }
}
main();

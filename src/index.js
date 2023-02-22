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

    // Inject env vars for locally enabled services
    let overrides = {};
    for (let i = 0; i < enabled.length; i++) {
      overrides = {
        ...overrides,
        ...this.services[i].configureService(),
      };
    }

    // Create env files for each local service with injected variables
    const envs = enabled.map(async (service) => {
      logger.log("generating .env", service.name);
      const vars = {
        ...(await service.local.vars()),
        ...overrides,
        ...service.configureSelf(),
      };
      const env = [];
      Object.keys(vars).forEach((key) => env.push(`${key}=${vars[key]}`));
      const filename = path.join(service.dir, ".env");
      fs.writeFile(filename, env.join("\n"), "utf-8");
    });
    await Promise.all(envs);

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
  async secretsSync() {
    for (let i = 0; i < this.services.length; i++) {
      const service = this.services[i];
      const envs = [service.local, service.staging, service.prod];
      for (let j = 0; j < envs.length; j++) {
        const env = envs[j];
        const diff = await env.diff();
        if (!diff) {
          console.log(
            chalk.greenBright.bold(`${service.name} ${env.name} is in sync`)
          );
          continue;
        }
        const keys = Object.keys(diff);
        console.log(
          chalk.redBright.bold(`${service.name} ${env.name} is out of sync`)
        );
        // If the file is only remote, just download it
        let bypassPrompt = true;
        for (let k = 0; k < keys.length; k++) {
          let key = keys[k];
          let state = diff[key];
          if (state === "modified") {
            bypassPrompt = false;
            console.log(chalk.green(key), "has been modified");
          } else if (state === "local") {
            bypassPrompt = false;
            console.log(chalk.green(key), `is only ${state}`);
          } else if (state === "remote") {
            console.log(chalk.green(key), `is only ${state}`);
          }
        }

        let action;
        if (bypassPrompt) {
          action = "download";
        } else {
          const input = await prompts({
            type: "select",
            name: "action",
            message: "How should we resolve this?",
            choices: [
              { title: "Replace remote copy with local copy", value: "upload" },
              {
                title: "Replace local copy with remote copy",
                value: "download",
              },
            ],
          });
          action = input.action;
        }
        if (!action) {
          console.log(chalk.yellow.bold("WARN: Taking no action"));
          continue;
        }
        if (action === "upload") {
          await env.upload();
        } else {
          await env.download();
        }
      }
    }
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
    secrets
      sync   reconcile local and remote secrets
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
    case "secrets":
      const subcommand = args[0];
      switch (subcommand) {
        case "sync":
          return cli.secretsSync();
      }
    default:
      return console.log(help.toString().split("\n").slice(2, -2).join("\n"));
      const { repo, config } = resourceFile[name];
  }
}
main();

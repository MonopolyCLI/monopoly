const Service = require("./service");
const chalk = require("chalk");
const prompts = require("prompts");
const logger = require("./logger");
const StdBuff = require("./stdbuff");

// Load in the resource definitions and instantiate them
const resourceFile = require("../resources.json");
const services = Object.keys(resourceFile).map((name) => {
  const { repo, config } = resourceFile[name];
  return new Service(name, repo, config);
});

// The CLI object's async classes map 1:1 with commands. It's just a wrapper
// around the Service object that handles batching commands.
class CLI {
  async clone() {
    const clone = async (service) => {
      if (await service.exists()) {
        return; // Short circuit
      }
      logger.log("git clone", service.name);
      const buffer = new StdBuff();
      let msg = [];
      buffer.on("stdout", (line) => msg.push(line));
      buffer.on("stderr", (line) => msg.push(line));
      try {
        await service.clone(buffer);
        logger.log("git clone finished", service.name);
      } catch (e) {
        // Only write logs if something goes wrong
        buffer.flush();
        logger.error(e.toString(), service.name);
        const log = msg.join("\n");
        if (log.trim() !== "") {
          logger.error(log, service.name);
        }
        throw new Error(`${service.name} could not be clone`);
      }
    };
    const clones = services.map((service) => clone(service));
    const results = await Promise.allSettled(clones);
    this.done(results, "Have All Repositories", "Clone Failed");
  }
  async dev() {
    // Only run services set to local
    const enabled = services.filter(
      (service) => resourceFile[service.name].target === "local"
    );
    if (enabled.length === 0) {
      console.log(chalk.yellowBright("No services set to local"));
    }
    // Create env files for each local service
    const envs = enabled.map((service) => service.local.writeEnv());
    await Promise.all(envs);
    // Start the dev server for each service
    const devs = enabled.map((service) => service.dev());
    try {
      const results = await Promise.all(devs);
    } catch (e) {
      process.exit(1);
    }
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
    const installs = services.map((service) => install(service));
    const results = await Promise.allSettled(installs);
    this.done(results, "Have All Dependencies", "Install Failed");
  }
  async status() {
    const checkStatus = async (service) => {
      const exists = await service.exists();
      if (!exists) {
        return logger.error("Missing repository", service.name);
      }
      const { branch, dirty } = await service.status();
      let msg = "";
      if (branch === "main" || branch === "master") {
        msg += branch;
      } else {
        msg += chalk.yellowBright.bold(branch);
      }
      msg += ": ";
      if (dirty) {
        msg += chalk.yellowBright.bold("dirty");
        logger.log(msg, service.name);
        logger.log(dirty, service.name);
      } else {
        msg += "clean";
        logger.log(msg, service.name);
      }
    };
    const checks = services.map((service) => checkStatus(service));
    await Promise.all(checks);
  }
  async secretsSync() {
    for (let i = 0; i < services.length; i++) {
      const service = services[i];
      const envs = [service.local, service.staging, service.prod];
      for (let j = 0; j < envs.length; j++) {
        const env = envs[j];
        const diff = await env.secrets.diff();
        if (!diff) {
          console.log(
            chalk.greenBright.bold(`${service.name} ${env.name} is in sync`)
          );
          continue;
        }
        const keys = Object.keys(diff);
        console.log(chalk.redBright.bold(`${service.name} is out of sync`));
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
          await env.secrets.upload();
        } else {
          await env.secrets.download();
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

    clone    makes sure all repositories are cloned
    install  install node modules for all projects
    status   reports the git status of each repository
    secrets
      sync   reconcile local and remote secrets
    dev      start all local services

  Configuration Files:
    ./services.json   Configure the services monopoly manages
    ./targets.json    Override .env to target remote services
  */
}

// Strip off node and file
const argv = process.argv.slice(2);
async function main() {
  const command = argv[0];
  const args = argv.slice(1);
  const cli = new CLI();
  switch (command) {
    case "clone":
      return cli.clone();
    case "status":
      return cli.status();
    case "install":
      return cli.install();
    case "dev":
      return cli.dev();
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

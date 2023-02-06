const Service = require("./service");
const repos = require("../repos.json");
const chalk = require("chalk");

// Take the repo definitions and turn them into Service objects
const services = Object.keys(repos).map((name) => {
  return new Service(name, repos[name].url);
});

// The CLI object's async classes map 1:1 with commands. It's just a wrapper
// around the Service object that handles batching commands.
class CLI {
  async clone() {
    const clones = services.map((service) => service.clone());
    const results = await Promise.allSettled(clones);
    this.done(results, "Have All Repositories", "Clone Failed");
  }
  async install() {
    const installs = services.map((service) => service.install());
    const results = await Promise.allSettled(installs);
    this.done(results, "Have All Dependencies", "Install Failed");
  }
  async status() {
    const clones = services.map((service) => service.status());
    await Promise.allSettled(clones);
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
    default:
      return console.log(help.toString().split("\n").slice(2, -2).join("\n"));
  }
}
main();

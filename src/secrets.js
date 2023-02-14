const services = require("../services.json");
const targets = require("../targets.json");
const path = require("path");
const fs = require("fs/promises");
const {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const client = new SecretsManagerClient({
  region: "us-east-1",
});
const envvars = path.join(__dirname, "..", "envfiles");

// Secret store represents a set of remote secrets
class SecretStore {
  constructor(service, env) {
    this.service = service;
    this.env = env;
    this.file = path.join(envvars, service, `.${env}.env`);
    this.bucket = `${service}/${env}`;
    this.cache = {
      remote: undefined,
      local: undefined,
    };
  }
  // Returns a map of keys that are out of sync between the remote and local files
  // i.e.:
  // {
  //    "foo": "local", # Is local but not remote
  //    "bar": "remote", # Is remote but not local
  //    "buzz": "modified", # Is both local and remote but the values don't match
  // }
  // Will return null if there is no difference
  async diff() {
    const local = (await this.local()) || {};
    const remote = (await this.remote()) || {};
    const result = {};
    const localVars = Object.keys(local);
    const remoteVars = Object.keys(remote);
    for (let i = 0; i < localVars.length; i++) {
      let varname = localVars[i];
      if (remote[varname] === undefined) {
        result[varname] = "local";
      } else if (remote[varname] !== local[varname]) {
        result[varname] = "modified";
      }
    }
    for (let i = 0; i < remoteVars.length; i++) {
      let varname = remoteVars[i];
      if (local[varname] === undefined) {
        result[varname] = "remote";
      } else if (local[varname] !== remote[varname]) {
        result[varname] = "modified";
      }
    }
    if (Object.keys(result).length === 0) {
      return null;
    }
    return result;
  }
  async hasLocal() {
    return (await this.local()) !== null;
  }
  async hasRemote() {
    return (await this.remote()) !== null;
  }
  // Returns a map of key/value pairs for all secrets stored locally
  // Returns null if there is no file
  async local() {
    if (this.cache.local) {
      return this.cache.local;
    }
    try {
      const local = await fs.readFile(this.file, "utf-8");
      const lines = local.split("\n").filter((line) => line !== "");
      const result = {};
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split("=");
        const key = parts[0];
        const val = parts[1];
        result[key] = val;
      }
      this.cache.local = result;
      return result;
    } catch (e) {
      return null;
    }
  }
  // Returns a map of key/value pairs for all secrets in the bucket
  // Returns null if there is no bucket
  async remote() {
    if (this.cache.remote) {
      return this.cache.remote;
    }
    try {
      let response = await client.send(
        new GetSecretValueCommand({ SecretId: this.bucket })
      );
      const result = JSON.parse(response.SecretString);
      this.cache.remote = result;
      return result;
    } catch (e) {
      return null;
    }
  }
  // Fetch the remote key/value pairs from the bucket and save them locally
  async download() {
    const remote = await this.remote();
    if (!remote) {
      throw new Error(`Failed to fetch ${this.bucket}`);
    }
    // Do a diff and short circuit
    const diff = await this.diff();
    if (!diff) {
      return;
    }
    const file = Object.keys(remote)
      .map((key) => `${key}=${remote[key]}`)
      .join("\n");
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, file, "utf-8");
    this.cache.local = remote;
  }
  // Take the local copy and save it to the bucket
  async upload() {
    const local = await this.local();
    if (!local) {
      throw new Error(`Missing ${this.file}`);
    }
    // Determine if we are updating or creating a secret
    const remote = await this.remote();
    // Do a diff and short circuit
    const diff = await this.diff();
    if (!diff) {
      return;
    }
    if (remote) {
      await client.send(
        new PutSecretValueCommand({
          SecretId: this.bucket,
          SecretString: JSON.stringify(local),
        })
      );
    } else {
      await client.send(
        new CreateSecretCommand({
          Name: this.bucket,
          SecretString: JSON.stringify(local),
        })
      );
    }
    this.cache.remote = local;
  }
  // Returns a map of key/value pairs for all secrets merged with the env vars defined
  // in services.json.
  // It only uses local copies and will throw an error if the local file is missing
  async vars() {
    const local = await this.local();
    if (!local) {
      throw new Error("Missing local file");
    }
    let result = { ...local };
    const names = Object.keys(services);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const service = services[name];
      const target = service.target;
      if (!target) {
        throw new Error(`No target set for ${name} in services.json`);
      }
      if (!targets[name]) {
        throw new Error(`Missing ${name} in targets.json`);
      }
      const vars = targets[name][target];
      if (!vars) {
        throw new Error(
          `Target ${target} missing from ${name} in targets.json`
        );
      }
      const overrides = Object.keys(vars);
      for (let j = 0; j < overrides.length; j++) {
        const override = overrides[j];
        if (result[override]) {
          result[override] = vars[override];
        }
      }
    }
    return result;
  }
}

module.exports = SecretStore;

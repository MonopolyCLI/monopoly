const services = require("../services.json");
const targets = require("../targets.json");
const path = require("path");
const fs = require("fs/promises");
const {
  SecretsManagerClient,
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
  }
  // Returns a map of keys that are out of sync between the remote and local files
  // i.e.:
  // {
  //    "foo": "local", # Is local but not remote
  //    "bar": "remote", # Is remote but not local
  //    "buzz": "modified", # Is both local and remote but the values don't match
  // }
  // Will return null if there is no difference
  async stale() {
    const local = await this.local();
    const remote = await this.remote();
  }
  // Returns a map of key/value pairs for all secrets stored locally
  // Returns null if there is no file
  async local() {
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
      return result;
    } catch (e) {
      return null;
    }
  }
  // Returns a map of key/value pairs for all secrets in the bucket
  // Returns null if there is no bucket
  async remote() {
    try {
      let response = await client.send(
        new GetSecretValueCommand({ SecretId: this.bucket })
      );
      return JSON.parse(response.SecretString);
    } catch (e) {
      return null;
    }
  }
  // Fetch the remote key/value pairs from the bucket and save them locally
  async download() {}
  // Take the local copy and save it to the bucket
  async upload() {}
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
      result = { ...result, ...vars };
    }
    return result;
  }
}

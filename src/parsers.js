const { Resource } = require("./service");

class Resources {
  constructor(definition) {
    this.resources = [];
    let resourcesFile = definition;
    if (typeof resourcesFile === "string") {
      resourcesFile = JSON.parse(resourcesFile);
    }
    const names = Object.keys(resourcesFile);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const def = resourcesFile[name];
      this.resources.push(new Resource(name, def));
    }
  }
  repos() {
    const result = [];
    for (let i = 0; i < this.resources.length; i++) {
      const resource = this.resources[i];
      if (resource.repo) {
        result.push(resource.repo);
      }
    }
    return result;
  }
  services() {
    const result = [];
    for (let i = 0; i < this.resources.length; i++) {
      const resource = this.resources[i];
      if (resource.services) {
        result.push(...resource.services);
      }
    }
    return result;
  }
}

module.exports = { Resources };

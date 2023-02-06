# monopoly

Autocode's polyrepo orchestrator.

`./repo.json` contains the list of services this tool orchestrates.

To add a service to this tool, add it to `./repo.json` following the same
pattern as the other services.

This tool currently automates these tasks across all tracked services:

* Cloning repositories from git
* Checking git status across all repositories

To get started:

```
git clone git@github.com:autocode/monopoly
cd monopoly
npm run install
npm run init
```

This will clone all the repositories you need to your local machine under `./monopoly/repos`.

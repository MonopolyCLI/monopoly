# monopoly

Autocode's polyrepo orchestrator.

# Getting started

You'll need the AWS CLI installed, start by following [this guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).

Run `aws configure` to setup your credentials.

Then:

```
git clone git@github.com:autocode/monopoly
cd monopoly
node src clone
node src install
node src secrets sync
```

This will:
1. Clone all the repositories you need to your local machine under `./monopoly/repos`.
2. Install all dependencies for each cloned repository.
3. Download secrets for each target environment for each service to `./envfiles`

Now open up `./services.json`. Anything set to `local` is going to be started locally
when you run `npm run dev`. For anything set to `staging`, all the services running
locally are going to be configured to point to the staging instance of that service.

If you look at `./targets.json`, it contains all the configuration settings for each
service. These key-value pairs override any environment variables for services running
locally, this lets us control which deployment (local/staging/prod) of a service our
local services talk to.

# Does it look ugly?

If the colors look wonky, you might need to enable 256-bit color in your terminal.

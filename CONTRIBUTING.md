# Contributing

Monopoly is inspired by local development experiences commonly found inside of
platform engineering organizations. It manages the lifecycle of autocode services.

To combines the workflows common in monorepos, where local development orchestration
benefits from all the company's services living under a single repository, with a
"polyrepo" setup where each service gets its own repository.

With monopoly, each autocode service lives in its own git repository. Monopoly
clones all of these into the ./repos directory and orchestrates them from
there.

# Services

The core concept in monopoly is the "service." These are defined in the
./services.json file. When the tool starts, each service defined in that file
gets turned into a `Service` class (defined in ./src/service.js). Each service
instance is bound to the environment it targets. For example `api-polybit-com`
will have 3 Service objects, representing local, staging, and production. You
can find the arrays of each of these services defined at the top of
./src/index.js.

# Secrets

The primary reason for seperating services by their target environment is for
secret management. Each environment gets its own set of secrets. These secrets
are encrypted using KMS and stored in AWS Secret Manager. The lifecycle of a
secret is managed by the `SecretStore` class in ./src/secrets.js. It keeps track
of the secrets defined localy on the engineer's laptop and the secrets stored
on AWS. It can diff both version and either upload or download a secret file to
syncronize the local version with AWS.

Secrets are stored as a single object per environment. Locally this object is a
standard .env file. You can find the env file for each service/environment tuple
under ./envfiles/{service}/.{environment}.env. On AWS this object is a single
Secret stored in Secret Manager. This secret contains a set of key/value pairs
stored under {service}/{environment}.

While the `SecretStore` class manages all the logic of diffing, uploading,
downloading, and generating env files, the logic for interactively updating them
lives in ./src/index.js.

# Targets

Each service can have a configured target. These targets are relative to the
engineer's development machine. "Local" refers to the service running localy and
"staging"/"prod" refers to their respective deployed environments.

When you set a service's target, it means all other services will talk to that
target. For example, if you set api-polybit-com's target to "staging", all services
running locally will talk to the staging deployment of api-polybit-com.

This is accomplished using environment variable overrides. These overrides are
defined in ./targets.json. You define overrides on a per-environment basis. For
each service running locally, monopoly will check to see if any of its
environment variables need to be overriden to talk to a specific deployment of
a service. If an environment variable is found that has an override, monopoly will
update it's value. After doing this diff/update step, it will generate the .env
file in the base directory of the service at ./repos/{service}/.env

# Git

Each service has a corresponding git repository. These are defined in
./services.json. Monopoly will clone these into the ./repos directory using
the service name as the target directory. Monopoly is aware of the git branch
that is currently checked out and whether your local state differs from the
state in the latest commit on that branch (we call this being "dirty").

This is all managed by the `Service` class in ./src/service.js file.

# Lifecycles

For installing dependencies, managing deployments, linting, testing and
running the service locally we defer to the individual repositories using npm
lifecycle commands.

For example, starting a service is controlled by `npm run dev` and linting
uses `npm run lint`. ./src/index.js manages these lifecycle scripts across all
repositories.

For local development flows, these lifecycle scripts should be optimized for
local development. For example, `npm run dev` should watch for file changes
and automatically restart the process without requiring the user to restart
monopoly.

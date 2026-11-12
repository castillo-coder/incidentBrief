# Deployment

One production image serves the API and built React application. The multi-stage Dockerfile installs/builds separately, retains API production dependencies only, and runs as the `node` user. Its entrypoint applies pending migrations before starting the API. A failed migration prevents startup.

Compose provides the same image plus PostgreSQL for local use. Local Compose deliberately uses development cookie settings and HTTP; it binds the application/database ports to loopback. The default image uses production settings and requires an HTTPS `APP_ORIGIN`. Keep `ENCRYPTION_KEY` stable across restarts and database restores.

GitHub and cloud setup are manual. No repository upload, workflow run, cloud resource or deployment is created by these files. The Render blueprint declares paid `starter` web and `basic-256mb` database plans; review those choices before creating resources.

## CI

`ci.yml` runs on PRs, main pushes and manual dispatch. It checks types, lint/boundaries, formatting, production dependency advisories, secrets in history, service coverage and browser behavior. A second job builds Compose from scratch and checks the container with temporary synthetic data. The isolated CI database binds to loopback; test keys are generated per run. Reports are retained for 90 days.

The reusable `deploy.yml` is called only after both jobs pass on a main push and `DEPLOY_ENABLED` is `true`. It serializes releases, skips superseded sources, requests that exact source revision from Render, and waits for live status. It then checks health, the served revision, HSTS and HTTP asset references. A queued deploy or an old served revision is not success. Render credentials are sent only to Render's API.

## Manual setup, in order

1. After publication is approved, add these workflow files to the GitHub repository. Keep Actions token permissions at read-only and require the `checks` and `container` checks before integrating changes to main.
2. Create the `production` environment. Set repository variable `DEPLOY_ENABLED` to `false` while setting up. No production credentials are required for CI.
3. Review and import `render.yaml` manually. Supply the actual HTTPS origin in `APP_ORIGIN`, without a trailing slash. Render generates a stable encryption key and supplies the private database URL. Keep automatic Render deploys off so CI controls releases.
4. Set OpenAI credentials/model in Render when enabling summaries. To provision without AI, omit those two prompt entries from the blueprint and add them later. Provision the first user in Render's shell with `node apps/api/dist/cli/create-user.js`.
5. In the GitHub `production` environment, add secret `RENDER_API_KEY` and variables `RENDER_SERVICE_ID` and `APP_URL` (the same HTTPS origin). These values never belong in source files.
6. Run CI and inspect its reports. Set repository variable `DEPLOY_ENABLED` to `true` when the service and checks are ready. Subsequent passing main pushes can deploy. A reviewer gate can be added to the production environment if desired.
7. Verify browser login/logout, Secure/HttpOnly/SameSite cookies, HTTPS assets and the expected `/version`. Retain actual run links and deployment results separately; local checks do not prove a cloud rollout happened.

The first Render creation is a manual platform operation; subsequent deployments use the gated workflow. Major schema transitions still need a maintenance window: startup migration locking serializes migrations but does not make incompatible schema changes safe for an old running version.

References: Docker's [multi-stage builds](https://docs.docker.com/build/building/multi-stage/), GitHub's [PostgreSQL services](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers), Render's [blueprint specification](https://render.com/docs/blueprint-spec), [deployment API](https://api-docs.render.com/reference/create-deploy) and [environment variables](https://render.com/docs/environment-variables).

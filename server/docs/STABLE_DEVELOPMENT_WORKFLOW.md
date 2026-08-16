# DZ HOOF — Stable Development Workflow

## Why the environment was recreated

The previous tests ran inside a temporary development sandbox. That environment is not a persistent server: when it is reset or hibernated, installed packages, Android SDK files, running processes, temporary public URLs, and MongoMemoryServer data can disappear. This is why the project sometimes appeared to need a fresh installation even though the GitHub source was already updated.

The project source of truth is now the GitHub repository `merci1994dz/dzhoot`, branch `main`. Development changes should be committed and pushed there first. The runtime should use one checkout of that repository and should not be recreated for every test.

## Two viable operating options

| Approach | Tradeoffs | Cost | Setup Complexity |
|---|---|---:|---:|
| Persistent VPS or always-on Linux host with Docker Compose and named MongoDB/Redis volumes | Best continuity, stable domain, persistent data, automatic restarts, and production-like testing. Requires hosting credentials and server setup. | Depends on the chosen VPS | Medium |
| Local development machine with the repository kept in one directory and services started only while the machine is online | Lowest additional cost and good for development. The phone cannot test the service while the machine is offline, and public access requires a tunnel. | Usually no extra hosting cost | Low to medium |

The temporary sandbox is suitable only for short one-off checks. It must not be treated as the project server or as the permanent database.

## Stable server operation

On a persistent Linux host, copy `server/.env.production.example` to `server/.env`, fill the image names and secrets once, and use `server/scripts/stable.sh`. The script provides `start`, `stop`, `restart`, `update`, `status`, `health`, `logs`, and `backup` operations. `docker-compose.selfhost.yml` uses named volumes for MongoDB and Redis, so restarting containers does not delete customer accounts, activation codes, or catalog data.

```bash
cd server
./scripts/stable.sh start
./scripts/stable.sh status
./scripts/stable.sh health
./scripts/stable.sh update
./scripts/stable.sh backup
```

The `update` operation uses fast-forward Git updates and recreates only the application containers. It does not remove the database volumes. The destructive `docker compose down -v` operation must not be used during normal development because it intentionally deletes persistent data.

## Project change policy

All source changes, Android fixes, backend fixes, migrations, and operational scripts must be committed to `main` or to a reviewed pull request. After a change is pushed, the persistent host pulls the change and runs `./scripts/stable.sh update`. APKs are rebuilt only when Android code or the compiled API base URL changes; backend-only changes do not require reinstalling the APK.

## Current limitation

The current sandbox has no Docker daemon, no Android SDK after reset, and no persistent MongoDB service. Therefore it can host a temporary test but cannot guarantee that processes, public URLs, or data survive a future sandbox reset. A VPS or a connected local machine is required for the permanent customer-facing test environment.

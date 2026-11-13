# Deploy to a shared server

The live demo runs on one Ubuntu VPS that also runs other apps. Flowboard must not open a port on that server or reach the other apps.

```
Browser ──HTTPS──▶ Tailscale Funnel relay ──tailnet──▶ tailscaled on the VPS
                                                         │
                                                         ▼
                                    127.0.0.1:8090  nginx (password barrier)
                                                         │  Docker network "flowboard_default"
                                              api:3000 ──┴── db:5432 (no published ports)
```

| Control          | How                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| No public port   | nginx listens on `127.0.0.1` only. Tailscale Funnel connects out to its relay, so the server opens no inbound port.          |
| HTTPS            | Tailscale gets a Let's Encrypt certificate for the `*.ts.net` name.                                                          |
| Password barrier | nginx basic auth for every path except `/healthz`, the API included.                                                         |
| Mock identity    | Behind the barrier. Only people with the password can send `X-User-Id`.                                                      |
| Isolation        | Own Compose project and network. No published API or database port. Memory limits: 256 MB API, 256 MB database, 64 MB nginx. |
| Secrets          | `deploy/.env` on the server only: mode 600, owner root, not in git.                                                          |

## First deploy

Prerequisites on the server: Docker with Compose v2, and Tailscale with Funnel allowed in the tailnet policy.

1. Copy the code from your machine. The server needs no GitHub access.
   ```bash
   git archive --format=tar HEAD | ssh vps 'mkdir -p /opt/flowboard/app && tar -x -C /opt/flowboard/app'
   ```
2. On the server, create `deploy/.env` from `deploy/.env.example`. Generate the passwords:
   ```bash
   cd /opt/flowboard/app
   umask 077
   printf 'BASIC_AUTH_USER=reviewer\nBASIC_AUTH_PASSWORD=%s\nPOSTGRES_PASSWORD=%s\nWEB_PORT=8090\n' \
     "$(openssl rand -base64 18 | tr -d '/+=')" "$(openssl rand -base64 32 | tr -d '/+=')" > deploy/.env
   ```
3. Build and start the stack. The API migrates and adds the demo data on its first start.
   ```bash
   docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up -d --build
   ```
4. Expose nginx through Funnel:
   ```bash
   tailscale funnel --bg --https=443 http://127.0.0.1:8090
   ```

## Update

```bash
git archive --format=tar HEAD | ssh vps 'tar -x -C /opt/flowboard/app'
ssh vps 'cd /opt/flowboard/app && docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up -d --build'
```

The update keeps `deploy/.env` and the database volume. New migrations apply at the API start.

## Check

```bash
U=https://<machine>.<tailnet>.ts.net
curl -s -o /dev/null -w '%{http_code}\n' $U/healthz   # 200
curl -s -o /dev/null -w '%{http_code}\n' $U/          # 401
E2E_BASE_URL=$U E2E_BASIC_AUTH='reviewer:<password>' pnpm e2e:web
```

## Operate

| Task                   | Command (on the server, in `/opt/flowboard/app`)                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| Read the password      | `grep BASIC_AUTH_PASSWORD deploy/.env`                                                                         |
| Change the password    | Edit `deploy/.env`, then run `docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up -d web`     |
| Logs                   | `docker compose -p flowboard logs -f api`                                                                      |
| Reset to the demo data | `docker compose -p flowboard down -v`, then the start command again                                            |
| Take the demo offline  | `tailscale funnel --https=443 off`. The stack keeps running on 127.0.0.1.                                      |
| Remove everything      | `tailscale funnel --https=443 off`, `docker compose -p flowboard down -v --rmi local`, `rm -rf /opt/flowboard` |

> **TO KEEP THE BARRIER SAFE, send the password on a different channel from the URL.** Change the password after the review.

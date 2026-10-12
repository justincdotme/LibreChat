# Zero-WAN LibreChat

Runs this fork of LibreChat in Docker behind your own TLS proxy, talking only
to a local OpenAI-compatible model server (llama.cpp), with no outbound
requests to the internet at runtime from the browser or any container. The
only internet access is one-time image pulls and the `npm ci` inside the image
build.

What the fork changes to make that true is in the client and prompt commits
on this branch; this directory holds the deployment: a compose override, the
LibreChat config, a TLS proxy site block, an egress firewall, and a headless
browser probe that proves the result.

## What you need

- A Linux Docker host with Docker Compose v2.24.4 or newer (`!override`
  support; v5.5 was used here) and Docker's iptables firewall backend (the
  default; the `DOCKER-USER` chain must exist).
- A TLS reverse proxy on the same host. The snippet here is for Caddy; any
  proxy works if it forwards to `127.0.0.1:3080`, sets `X-Forwarded-*`, and
  can add a response header.
- DNS for your chat hostname pointing at the host, and a certificate the
  browsers trust (the artifact preview and downloads need a secure context).
- A llama.cpp server (or any `/v1/chat/completions` endpoint) reachable from
  the Docker network.
- `openssl`, `curl` and `jq` on the host. For the probe, `node_modules`
  installed in the repo (`npm ci`) and the Playwright image pulled.
- The model server must listen on an address the containers can reach. A
  server on the Docker host itself must bind to the host's LAN address, not
  loopback; `setup.sh` rejects loopback URLs. Traffic from containers to the
  host itself does not traverse `DOCKER-USER`, so the model rule's counter
  stays flat in that layout.

## Files

| File | Committed | Purpose |
|---|---|---|
| `zero-wan.env.example` | yes | Site settings template. Copy to `zero-wan.env` (gitignored) and edit. |
| `setup.sh` | yes | Renders everything below from `zero-wan.env`; idempotent. |
| `override.yml` | yes | Compose override: local image build, loopback port, no RAG/vector DB/admin panel, fixed bridge and subnet. |
| `config.yaml.example` | yes | `librechat.yaml` template: one custom endpoint, web search, code execution and file search off, browser speech hidden. |
| `config.yaml` | no | Rendered; bind-mounted as `/app/librechat.yaml`. |
| `Caddyfile.snippet.example` | yes | Caddy site block with the Content-Security-Policy header. |
| `Caddyfile.snippet` | no | Rendered; you append it to your Caddyfile. |
| `env.delta` | yes | Documents what `setup.sh` changes in the project `.env`. |
| `firewall.sh` | yes | DOCKER-USER egress policy with `--status` and `--remove`. |
| `verify/run.sh`, `verify/egress.mjs` | yes | Headless Chromium probe: registers or logs in, drives both artifact types, downloads, export, and lists every host the browser contacted. |
| `verify/mock.mjs` | yes | Echo model for dry runs when the model server is offline. |
| `verify/bundle-grep.sh` | yes | Lists third-party host strings left in the built client. |

The generated files are gitignored here because they carry your hostnames and
addresses. Secrets live only in the project `.env`, which the repo already
ignores.

## 1. Settings

```bash
cp docs/zero-wan/zero-wan.env.example docs/zero-wan/zero-wan.env
$EDITOR docs/zero-wan/zero-wan.env
```

Set `CHAT_HOST`, `LLAMA_BASE_URL`, `MODEL_LABEL`, the TLS line for Caddy, and
a compose subnet that no other Docker network on the host uses. `MODEL_ID` may
stay empty; `setup.sh` reads it from the server's `/v1/models` and saves it
into `zero-wan.env`.

## 2. Render

```bash
bash docs/zero-wan/setup.sh
```

Creates `.env` from `.env.example` if it does not exist, then on every run sets
the domain, UID/GID, `ENDPOINTS`, `COMPOSE_FILE` and the `ZERO_WAN_*` values,
generates any secret that is still empty (`JWT_SECRET`, `JWT_REFRESH_SECRET`,
`CREDS_KEY`, `CREDS_IV`, `MEILI_MASTER_KEY`), renders `config.yaml` and
`Caddyfile.snippet`, and creates the bind-mounted data directories owned by
you. Rerun it after editing `zero-wan.env`; existing secrets and
`ALLOW_REGISTRATION` are never changed.

Check the merged compose file before building:

```bash
docker compose config --services
# expected, in any order: api  mongodb  meilisearch     (admin-panel, rag_api, vectordb excluded by profile)
docker compose config | sed -n '/^  api:/,/^  meilisearch:/p' | grep -A4 -E '^    (ports|depends_on):'
# expected: one ports entry with host_ip 127.0.0.1 and published "3080"; depends_on lists only mongodb
docker compose config | grep -A7 '^networks:'
# expected: your COMPOSE_BRIDGE and COMPOSE_SUBNET
```

Run compose commands from the repo root; `override.yml` is not a default Compose
filename, so nothing happens by accident inside `docs/zero-wan`.

## 3. Build (internet needed once)

```bash
docker compose build api
docker compose pull mongodb meilisearch
docker pull mcr.microsoft.com/playwright:v1.62.1-noble   # for the probe; must match @playwright/test in package-lock.json
```

## 4. TLS proxy (root)

```bash
sudo tee -a /etc/caddy/Caddyfile < docs/zero-wan/Caddyfile.snippet
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -sI https://<CHAT_HOST>/ | grep -i -E '^(HTTP/|content-security-policy|server):'
```

Append once. The block starts with a `# zero-wan` comment; after rerunning
`setup.sh` with new settings, replace that block in the Caddyfile by hand
instead of appending again, or Caddy rejects the duplicate site.

The CSP sets only `img-src`, `media-src`, `font-src`, `connect-src` and
`object-src`, so the app's inline scripts and styles are untouched. It is what
blocks a model-authored remote image in a chat message; inside markdown
artifact previews the client already drops remote image sources. If the probe
fails only on a CSP violation (`Refused to connect` in the console), drop
`connect-src 'self'` and note it.

## 5. Firewall (root)

```bash
sudo docs/zero-wan/firewall.sh
sudo docs/zero-wan/firewall.sh --status
```

Rules, all tagged `zero-wan` in `DOCKER-USER`: one `RETURN` for the model
server's address and port, one `RETURN` per `LAN_CIDRS` entry, then `LOG` with
prefix `LC-EGRESS-DROP ` and `DROP` for everything else from the compose
subnet. Docker's own rules follow. The script checks the chain exists and the
model host resolves before touching anything, inserts the `DROP` first so an
error midway leaves the network closed rather than open, and prints the rule
count on success. The rules are not persisted; rerun after a reboot or wire
the script into a unit.

What the counters mean: the model rule grows while the model answers.
Container DNS is served by Docker's embedded resolver and forwarded by `dockerd`
from the host namespace, so it never traverses this chain; neither does
traffic between the containers on the same bridge. The `LOG` and `DROP` rows
must stay at zero through every run, and any drop also appears in
`sudo journalctl -k --grep LC-EGRESS-DROP`.

Independent capture on the container side of the bridge (the interface exists
once the stack is up; use your `COMPOSE_BRIDGE` and `COMPOSE_SUBNET`):

```bash
sudo tcpdump -ni br-librechat -l 'ip and src net 172.30.0.0/24 and not dst net 10.0.0.0/8 and not dst net 172.16.0.0/12 and not dst net 192.168.0.0/16 and not dst net 224.0.0.0/4 and not dst host 255.255.255.255'
```

Expected: the `listening on` banner and nothing else.

## 6. Start

```bash
docker compose up -d
docker compose ps
docker compose logs api | grep -E 'RAG API|listening|schedules|Invalid'
curl -s http://127.0.0.1:3080/api/config | jq '{registrationEnabled, serverDomain, bundlerURL, staticBundlerURL, analyticsGtmId}'
curl -s -o /dev/null -w '%{http_code}\n' http://<host LAN IP>:3080/   # expected 000: bound to loopback only
```

Expected log lines: `RAG API is either not running or not reachable at
undefined` (the health check runs unconditionally; RAG is off), `Server
listening ... 3080`, `[schedules] engine started`. A `METRICS_SECRET is not
set` warning only means `/metrics` answers 401. No `Invalid` line.
`bundlerURL`, `staticBundlerURL` and `analyticsGtmId` must be null.

## 7. Probe

```bash
sudo docs/zero-wan/firewall.sh --status          # before
bash docs/zero-wan/verify/run.sh
sudo docs/zero-wan/firewall.sh --status          # after: LOG and DROP rows still 0
sudo journalctl -k --grep LC-EGRESS-DROP --no-pager | tail
```

The probe logs in with `TEST_EMAIL`/`TEST_PASSWORD` or registers a throwaway
account (registration does not sign the user in and is rate limited to a few
per hour). Once registration is closed, create a probe account first:
`docker compose exec -T api npm run create-user -- probe@example.invalid "Egress Probe" egressprobe <password>`
and pass its credentials. The probe then selects your endpoint, enables Artifacts, asks the model for a
markdown artifact and a shell script artifact, checks the preview and the Code
tab, downloads both and verifies their content, asks for a chat message with a
remote image to observe the CSP block, exports the conversation, and prints:

```json
{
  "hosts": ["<CHAT_HOST>"],
  "blocked": ["https://example.invalid/probe.png"],
  "failed": [],
  "downloads": [
    { "name": "Zero WAN Notes.md", "bytes": <n> },
    { "name": "backup.sh", "bytes": <n> },
    { "name": "<conversation title>.md", "bytes": <n> }
  ],
  "consoleCsp": ["Loading the image 'https://example.invalid/probe.png' violates ..."],
  "problems": []
}
```

Sizes vary with the model's wording. Exit 0 requires `hosts` to contain only
your chat host, `blocked` to contain the probe image, and `failed` to be empty.
A request counts as blocked only when Chromium's console reported a CSP
violation for that exact URL; every other failed request stays in `failed`. Results are written to
`~/zero-wan-verify/`; on a selector failure the probe saves `failure.png` and
prints the page's accessibility tree. Small models sometimes miss the exact
artifact format; retry once. Variables: `ENDPOINT_LABEL`, `MODEL_ID`,
`TEST_EMAIL`, `TEST_PASSWORD`, `BASE_URL`, `OUT`.

Dry run without the model server: `node docs/zero-wan/verify/mock.mjs &`,
add the `mock` endpoint from that file's header to `config.yaml`,
`docker compose restart api`, then
`ENDPOINT_LABEL=mock MODEL_ID=mock-model bash docs/zero-wan/verify/run.sh`
(variables set on the command line win over `zero-wan.env`). Remove the
endpoint (rerun `setup.sh`) and restart again afterwards.

## 8. Bundle audit

```bash
bash docs/zero-wan/verify/bundle-grep.sh
```

Expected hits in a v0.8.8 build of this branch, none of which can be
requested:

| String | Where it comes from | Why it is inert |
|---|---|---|
| `<script src="https://cdn.tailwindcss.com/3.4.17">` | `client/src/utils/artifacts.ts`, the `/public/index.html` template inside `sharedFiles` | Only `<SandpackProvider>` consumed that file map; nothing imports Sandpack any more. |
| `cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js` | `client/src/utils/markdown.ts`, inside a string | `useArtifactProps` still builds the `index.html` string for the download filename; nothing loads it into an iframe. |
| `cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs` | `@monaco-editor/loader` default config | Overridden by `loader.config({ monaco })` in `client/src/components/Artifacts/monaco.ts` before the first editor mounts. |
| `googletagmanager.com` | `react-gtm-module` | Gated on `analyticsGtmId` from `/api/config`, which is null. |
| `*.codesandbox.io`, `cdnjs.cloudflare.com`, `unpkg.com`, `fonts.googleapis` | none | Zero hits. A hit means a new dependency and needs investigation. |

## 9. Your account, then close registration

The first user to register becomes ADMIN, so register your own account before
anything else does. If the probe registered first, promote yourself. Then:

```bash
sed -i 's/^ALLOW_REGISTRATION=true/ALLOW_REGISTRATION=false/' .env
docker compose up -d --force-recreate api      # also clears the cached user documents
curl -s http://127.0.0.1:3080/api/config | jq .registrationEnabled    # false
```

Probe accounts: the upstream `delete-user` script waits for Redis stream
coordination or an offline confirmation while the app runs, so remove them in
Mongo instead:

```bash
docker compose exec -T mongodb mongosh LibreChat --quiet --eval '
const ids = db.users.find({ email: /@example\.invalid$/ }, { _id: 1 }).toArray().map(u => u._id);
for (const c of ["conversations","messages","files","presets","transactions","balances","sessions"]) {
  db[c].deleteMany({ $or: [ { user: { $in: ids.map(String) } }, { user: { $in: ids } } ] });
}
db.users.deleteMany({ _id: { $in: ids } });'
docker compose exec -T mongodb mongosh LibreChat --quiet --eval 'db.users.updateOne({ email: "<your email>" }, { $set: { role: "ADMIN" } })'
docker compose up -d --force-recreate api
```

## Known gaps and behavior notes

- Third-party images (`mongo`, `getmeili/meilisearch`) are trusted only as far
  as the counters and the bridge capture show them silent.
- DNS: a container looking up an internet name produces a LAN query from the
  host to your resolver, which may forward it upstream. The counters cannot see
  it. Capture `udp port 53` on the host's LAN interface during the probe if you
  want that observed; no such lookup is expected.
- Container-to-host traffic (INPUT chain) is outside `DOCKER-USER`; the
  override removes the `host.docker.internal` alias and the host exposes
  nothing to the bridge except what the proxy forwards.
- IPv4 only. The compose network declares no IPv6 subnet; confirm with
  `docker compose exec api ip -6 addr show scope global` (expected: nothing).
- Browser speech-to-text and text-to-speech are hidden for fresh browsers by
  the `speech` block; a browser with a saved setting still shows the buttons,
  and Chrome's Web Speech API would reach Google on a click.
- HTML, SVG, React and office-document artifacts show "Preview not available";
  Mermaid renders natively; code artifacts show the Code tab only. The Preview
  tab's Refresh button still renders and only spins briefly, since there is no
  bundler to refresh.
- Upgrading from upstream: re-apply the client and prompt commits by hand,
  rerun `setup.sh`, rebuild, rerun the probe and the bundle audit.

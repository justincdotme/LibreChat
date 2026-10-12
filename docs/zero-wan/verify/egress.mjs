import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const BASE_URL = must('BASE_URL');
const MODEL = must('MODEL_ID');
const EMAIL = must('TEST_EMAIL');
const PASSWORD = must('TEST_PASSWORD');
const ENDPOINT = must('ENDPOINT_LABEL');
const DOWNLOADS = process.env.DOWNLOADS_DIR ?? '/downloads';
const SLOW = 180_000;
const ALLOWED_HOST = new URL(BASE_URL).host;
const BLOCKED_IMAGE_HOST = 'example.invalid';

function must(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value;
}

const FORMAT_HINT =
  'Reply with exactly the block below and nothing else. Keep the ::: lines and the four-backtick lines on their own lines.';

const MARKDOWN_PROMPT = `${FORMAT_HINT}

:::artifact{identifier="zero-wan-notes" type="text/markdown" title="Zero WAN Notes"}
\`\`\`\`
# Zero WAN Test

This note was rendered without the WAN.

- one
- two
\`\`\`\`
:::`;

const SCRIPT_PROMPT = `${FORMAT_HINT}

:::artifact{identifier="backup-script" type="application/vnd.code" title="backup.sh"}
\`\`\`\`
#!/bin/bash
set -euo pipefail
tar -czf "/backup/home-$(date +%F).tgz" /home
\`\`\`\`
:::`;

const IMAGE_PROMPT = `Reply with exactly this one line and nothing else: ![probe](https://${BLOCKED_IMAGE_HOST}/probe.png)`;

const requests = new Map();
const consoleCsp = [];
const downloads = [];

const browser = await chromium.launch({
  args: [
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--no-first-run',
  ],
});
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1400, height: 900 },
});
context.on('request', (request) => {
  requests.set(request, { url: request.url(), host: new URL(request.url()).host, state: 'sent' });
});
context.on('requestfailed', (request) => {
  const entry = requests.get(request) ?? { url: request.url(), host: new URL(request.url()).host };
  entry.state = 'failed';
  entry.error = request.failure()?.errorText ?? '';
  requests.set(request, entry);
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);
/* A CSP violation is the only proof a failed request never left the browser;
 * Chromium names the blocked URL in the console message. */
const cspBlockedUrls = new Set();
page.on('console', (message) => {
  const text = message.text();
  if (/Content Security Policy/i.test(text)) {
    consoleCsp.push(text);
    const match = text.match(/'(https?:[^']+)'/);
    if (match) {
      cspBlockedUrls.add(match[1]);
    }
  }
});

async function saveDownload(download, mustContain) {
  const name = download.suggestedFilename();
  const target = path.join(DOWNLOADS, name);
  await download.saveAs(target);
  const text = readFileSync(target, 'utf8');
  if (mustContain && !text.includes(mustContain)) {
    throw new Error(`${name} does not contain ${JSON.stringify(mustContain)}`);
  }
  downloads.push({ name, bytes: statSync(target).size });
}

async function send(text) {
  const input = page.getByRole('textbox', { name: 'Message input' });
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  const stop = page.getByRole('button', { name: 'Stop generating' });
  await stop.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await stop.waitFor({ state: 'hidden', timeout: SLOW });
}

async function openLatestArtifact(title) {
  const trigger = page.locator('[data-artifact-trigger]').last();
  await trigger.waitFor();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  const panel = page.getByRole('region', { name: title });
  await panel.waitFor({ state: 'visible' });
  return panel;
}

async function downloadArtifact(panel, mustContain) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Download Artifact' }).click(),
  ]);
  await saveDownload(download, mustContain);
}

async function login() {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByTestId('login-button').click();
  return page
    .waitForURL(/\/c\/new/, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
}

/* Login first so reruns reuse the account; registration is rate limited and
 * does not sign the user in (it lands on /login?redirect_to=...). */
async function signIn() {
  if (await login()) {
    return;
  }
  await page.goto(`${BASE_URL}/register`);
  await page.getByLabel('Full name').fill('Egress Probe');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByTestId('password').fill(PASSWORD);
  await page.getByTestId('confirm_password').fill(PASSWORD);
  await page.getByLabel('Submit registration').click();
  await page.waitForURL(/\/login/, { timeout: 60_000 });
  if (!(await login())) {
    throw new Error('login failed after registration');
  }
}

async function run() {
  await signIn();

  const selector = page.getByRole('button', { name: 'Select a model' }).first();
  await selector.waitFor({ state: 'visible', timeout: 120_000 });
  /* The app re-applies its default endpoint shortly after first render, which
   * silently undoes a selection made in that window, so verify by URL and retry. */
  await page.waitForTimeout(5_000);
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const endpointOption = page.getByRole('option', {
    name: new RegExp(`^${escape(ENDPOINT)}( selected)?$`),
  });
  const modelOption = page.getByRole('option', {
    name: new RegExp(`^${escape(MODEL)}( selected)?$`),
  });
  let selected = false;
  for (let attempt = 0; attempt < 3 && !selected; attempt++) {
    await selector.click();
    await page.waitForTimeout(1_000);
    /* Hovering an endpoint opens its model list; the selection commits on the
     * model click. Endpoints without a model list commit on the endpoint click. */
    await endpointOption.hover();
    if (
      await modelOption
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await modelOption.click();
    } else {
      await endpointOption.click();
    }
    await page.waitForTimeout(1_500);
    const shown = (await selector.textContent()) ?? '';
    const placeholder =
      (await page.getByRole('textbox', { name: 'Message input' }).getAttribute('placeholder')) ??
      '';
    selected = shown.includes(MODEL) && placeholder.includes(ENDPOINT);
    if (!selected) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1_000);
    }
  }
  if (!selected) {
    throw new Error(`could not select endpoint ${ENDPOINT}; url is ${page.url()}`);
  }
  await expect(page.getByRole('dialog', { name: 'Select a model' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Attach and tools' }).click();
  const artifactsRow = page
    .getByRole('dialog', { name: 'Attach and tools' })
    .getByRole('button', { name: 'Artifacts', exact: true });
  if ((await artifactsRow.getAttribute('aria-pressed')) !== 'true') {
    await artifactsRow.click();
    await expect(artifactsRow).toHaveAttribute('aria-pressed', 'true');
  }
  await page.keyboard.press('Escape');

  await send(MARKDOWN_PROMPT);
  let panel = await openLatestArtifact('Zero WAN Notes');
  await panel.getByRole('radio', { name: 'Preview' }).click();
  await expect(panel.getByRole('heading', { name: 'Zero WAN Test' })).toBeVisible();
  await expect(panel.locator('iframe')).toHaveCount(0);
  await downloadArtifact(panel, '# Zero WAN Test');

  await send(SCRIPT_PROMPT);
  panel = await openLatestArtifact('backup.sh');
  await expect(panel.getByRole('radio', { name: 'Preview' })).toHaveCount(0);
  await expect(panel.locator('#artifacts-code .monaco-editor .view-lines')).toContainText(
    'bin/bash',
    { timeout: 30_000 },
  );
  await downloadArtifact(panel, 'set -euo pipefail');

  /* A remote image in an ordinary chat message is the one browser egress the
   * app cannot switch off; the Caddy CSP must stop it before it leaves. */
  await send(IMAGE_PROMPT);
  const probeImage = page.locator(`img[src*="${BLOCKED_IMAGE_HOST}"]`).last();
  await probeImage.waitFor({ state: 'attached', timeout: 15_000 });

  await page.locator('#export-menu-button').click();
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /export conversation/i });
  const [exported] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  await saveDownload(exported);
}

try {
  await run();
} catch (error) {
  /* A screenshot and the accessibility tree make a selector failure diagnosable
   * without rerunning the whole flow. */
  await page.screenshot({ path: path.join(DOWNLOADS, 'failure.png') }).catch(() => {});
  console.error('URL at failure:', page.url());
  console.error(
    (
      await page
        .locator('body')
        .ariaSnapshot()
        .catch(() => '')
    ).slice(0, 4000),
  );
  throw error;
} finally {
  await browser.close();
}

const entries = [...requests.values()];
for (const entry of entries) {
  if (entry.state === 'failed' && cspBlockedUrls.has(entry.url)) {
    entry.state = 'blocked';
  }
}
const hosts = [...new Set(entries.filter((e) => e.state !== 'blocked').map((e) => e.host))].sort();
const blocked = entries.filter((e) => e.state === 'blocked').map((e) => e.url);
const failed = entries
  .filter((e) => e.state === 'failed')
  .map((e) => ({ url: e.url, error: e.error }));

const problems = [];
if (hosts.some((host) => host !== ALLOWED_HOST)) {
  problems.push(`browser contacted hosts other than ${ALLOWED_HOST}`);
}
if (!blocked.some((url) => url.includes(BLOCKED_IMAGE_HOST))) {
  problems.push('the remote image in chat was not blocked by the CSP');
}
if (failed.length > 0) {
  problems.push('unexpected failed requests');
}

console.log(JSON.stringify({ hosts, blocked, failed, downloads, consoleCsp, problems }, null, 2));
process.exit(problems.length === 0 ? 0 : 1);

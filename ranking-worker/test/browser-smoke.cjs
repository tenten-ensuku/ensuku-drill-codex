const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseArgs } = require('node:util');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { values } = parseArgs({ options: { live: { type: 'boolean', default: false }, secret: { type: 'string' }, output: { type: 'string' } } });
if (!values.secret || !values.output) throw new Error('--secret PRIVATE_FILE --output PRIVATE_DIRECTORY required');
const secret = JSON.parse(fs.readFileSync(values.secret, 'utf8')).PROBE_TOKEN;
const root = path.resolve(__dirname, '../..');
const output = path.resolve(values.output);
if (output.startsWith(root + path.sep)) throw new Error('Keep test artifacts outside the public repository');
fs.mkdirSync(output, { recursive: true });
const base = 'https://tenten-ensuku.github.io/ensuku-drill-codex/';
const apiHost = 'ensuku-drill-ranking-api.naga-study.workers.dev';
const prefix = 'ensuku-drill-codex:';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
assert.match(source, /const APP_VERSION = 169;/);
assert(!/supabase/i.test(source));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const width of [375, 320, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 812 },
        isMobile: width < 500, hasTouch: width < 500, timezoneId: 'Asia/Tokyo' });
      const errors = [], assetFailures = [], supabaseRequests = [], apiCalls = [];
      let simulateFailure = false, loseNextPostResponse = false;
      await context.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.hostname.endsWith('.supabase.co') || url.pathname.includes('supabase-js')) {
          supabaseRequests.push(url.hostname); return route.abort();
        }
        if (url.hostname === apiHost) {
          apiCalls.push({ method: req.method(), path: url.pathname });
          if (simulateFailure) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"service_unavailable"}',
            headers: { 'access-control-allow-origin': 'https://tenten-ensuku.github.io' } });
          if (req.method() !== 'OPTIONS' && ['/v1/scores', '/v1/position'].includes(url.pathname)) {
            const response = await route.fetch({ headers: { ...req.headers(), authorization: `Bearer ${secret}` } });
            if (req.method() === 'POST' && loseNextPostResponse) {
              loseNextPostResponse = false;
              assert(response.ok(), 'The simulated lost response must follow a real successful insert');
              return route.abort('failed');
            }
            return route.fulfill({ response });
          }
          return route.continue();
        }
        if (values.live || !req.url().startsWith(base)) return route.continue();
        const relative = decodeURIComponent(url.pathname).slice('/ensuku-drill-codex/'.length) || 'index.html';
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
        const types = { '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
        return route.fulfill({ status: 200, contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      });
      const device = `qa_${Date.now()}_${width}`;
      const player = `試験${width}`;
      await context.addInitScript(({ prefix, device, player }) => {
        if (localStorage.getItem('qa-initialized')) return;
        localStorage.setItem('qa-initialized', '1');
        for (const [key, value] of Object.entries({ player_name: player, device_id: device, sound_volume: '0', sound_volume_defaulted_v2: '1', best_6: '365',
          announcement_read: JSON.stringify(['announcement-button-2026-08-12', 'ten-god-thresholds-2026-08-12', 'ranking-recovery-request-2026-09-09']) })) localStorage.setItem(prefix + key, value);
      }, { prefix, device, player });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.url().startsWith(base) && response.status() >= 400) assetFailures.push({ url: response.url(), status: response.status() });
      });
      await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
      await page.getByRole('button', { name: 'アナウンス', exact: true }).waitFor({ timeout: 45000 });
      assert.equal(await page.evaluate(() => APP_VERSION), 169);
      assert.equal(await page.evaluate(() => ONLINE_SERVICE_STATUS.enabled), false);
      if (width === 375) new vm.Script(await page.evaluate(source => Babel.transform(source, { presets: ['env', 'react'] }).code, source));
      assert.equal(await page.getByRole('button', { name: 'アナウンス', exact: true }).locator('span').last().innerText(), '1');
      await page.getByRole('button', { name: 'アナウンス', exact: true }).click();
      assert.match(await page.locator('article').first().innerText(), /成績投稿・ランキングが復旧しました/);
      await page.screenshot({ path: path.join(output, `announcement-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: '閉じる', exact: true }).click();
      await page.getByRole('button', { name: '順位', exact: false }).click();
      await page.getByRole('button', { name: '歴代', exact: true }).click();
      await page.waitForFunction(() => !document.body.innerText.includes('読み込み中'));
      await page.getByText('20位', { exact: true }).waitFor();
      assert.equal(await page.locator('section p.truncate').count(), 20);
      for (const period of ['7日間', '30日間', '今日', '歴代']) {
        await page.getByRole('button', { name: period, exact: true }).click();
        await page.waitForFunction(() => !document.body.innerText.includes('読み込み中'));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `rankings-${width}.png`), fullPage: true });

      for (const variant of width === 320 ? ['normal'] : ['normal', 'ura']) {
        await page.goto(base, { waitUntil: 'networkidle' });
        if (variant === 'ura') {
          // Unlock only in the isolated browser; no public scores or real user storage are modified.
          await page.evaluate(() => localStorage.setItem(MODES[0].bestKey, '365'));
          await page.reload({ waitUntil: 'networkidle' });
        }
        await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
        await page.getByRole('button', { name: variant === 'ura' ? '裏モード' : 'プレイ', exact: true }).first().click();
        for (let i = 0; i < 13; i++) {
          await page.getByText(`${i + 1} / 13`, { exact: true }).waitFor();
          assert.equal(await page.evaluate(() => scrollY), 0);
          if (variant === 'normal') {
            await page.locator('[data-answer-key]:not([disabled])').first().click();
            await page.getByRole('button', { name: '確定', exact: true }).click();
          } else {
            const answers = await page.evaluate(index => {
              const node = document.querySelector('.play-pad');
              let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))];
              while (fiber) {
                for (const candidate of [fiber, fiber.alternate]) {
                  const props = candidate?.memoizedProps;
                  if (props?.game?.index === index && props?.q?.answers) return props.q.answers;
                }
                fiber = fiber.return;
              }
              throw new Error('Current question not found');
            }, i);
            for (const answer of answers) await page.locator(`[data-answer-key="${answer}"]`).click();
          }
        }
        await page.getByRole('heading', { name: '成績発表', exact: true }).waitFor();
        const saved = await page.evaluate(prefix => ({ history: JSON.parse(localStorage.getItem(prefix + 'results_history')),
          daily: JSON.parse(localStorage.getItem(prefix + 'daily_summary')), stats: JSON.parse(localStorage.getItem(prefix + 'problem_stats')),
          device: localStorage.getItem(prefix + 'device_id'), player: localStorage.getItem(prefix + 'player_name') }), prefix);
        assert.equal(saved.history[0].variant, variant);
        assert.equal(saved.history[0].correctCount + saved.history[0].mistakeCount, 13);
        assert.equal(saved.device, device); assert.equal(saved.player, player);
        assert.equal(Object.keys(saved.stats).length, 13);
        await page.getByRole('button', { name: 'ランキング投稿', exact: true }).click();
        const send = page.getByRole('button', { name: `${player}で送信`, exact: true });
        if (width === 375 && variant === 'normal') loseNextPostResponse = true;
        await send.click();
        if (width === 375 && variant === 'normal') {
          await page.getByText('成績を送信できませんでした。時間をおいてもう一度お試しください。', { exact: true }).waitFor();
          await send.click();
        }
        await page.getByRole('button', { name: '送信済み', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '送信済み', exact: true }).isDisabled(), true);
        await page.getByText(/現在.*位です/).waitFor();
        assert.equal(await page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + 'results_history'))[0].submitted, prefix), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(output, `submitted-${variant}-${width}.png`), fullPage: true });
      }
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '設定', exact: true }).click();
      assert.equal(await page.getByRole('textbox').first().inputValue(), player);
      await page.screenshot({ path: path.join(output, `settings-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: '復習', exact: false }).first().click();
      await page.getByRole('button', { name: /誤答/ }).waitFor();
      await page.getByRole('button', { name: /お気に入り/ }).first().click();
      await page.getByRole('button', { name: /問題一覧/ }).click();
      await page.getByRole('button', { name: /自己分析/ }).click();
      await page.getByRole('heading', { name: '成長ログ', exact: true }).waitFor();
      simulateFailure = true;
      await page.getByRole('button', { name: '順位', exact: false }).click();
      await page.getByText('成績・ランキングを取得できませんでした。時間をおいてもう一度お試しください。', { exact: true }).waitFor();
      await page.getByRole('button', { name: /挑戦/ }).click();
      await page.getByRole('button', { name: 'プレイ', exact: true }).first().click();
      await page.getByText('1 / 13', { exact: true }).waitFor();
      assert.deepEqual(supabaseRequests, []);
      assert.deepEqual(errors, []); assert.deepEqual(assetFailures, []);
      const summary = { width, mobileTouch: width < 500, publicRanking: true, normalRunAndPost: true,
        uraRunAndPost: width !== 320, localHistoryAndSettings: true, unavailableApiDoesNotBlockPlay: true,
        lostResponseRetry: width === 375, supabaseRequests: 0, pageErrors: 0, apiCalls: apiCalls.length };
      results.push(summary); console.log(JSON.stringify(summary));
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({ live: values.live, results }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

// Optional browser smoke: start Vite, then set PLAYWRIGHT_MODULE if it is not installed locally.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    const context = await browser.newContext({ permissions: ['camera'] });
    const page = await context.newPage();
    const id = '00000000-0000-4000-8000-000000000001';
    await page.addInitScript(() => {
      window.captureCalls = 0;
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (options) => {
        window.captureCalls++;
        const stream = await original(options);
        window.captured = stream;
        return stream;
      };
    });
    await page.route('**/camera-publisher.ts*', route => route.fulfill({
      contentType: 'application/javascript',
      body: 'export const createPublisherRoom = () => ({ on() {}, removeAllListeners() {}, async disconnect() {} }); export const publishCameraStream = async () => true;',
    }));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let body = {};
      if (url.pathname.endsWith('/me')) body = { user: {id, name:'Smoke Admin',role:'ADMIN'} };
      else if (url.pathname.endsWith('/start')) body = {publishingSessionId:id,heartbeatIntervalSeconds:1,serverUrl:'wss://unused.invalid',token:'mock'};
      else if (url.pathname.endsWith('/heartbeat')) body = {lastSeenAt:new Date().toISOString(),leaseExpiresAt:new Date(Date.now()+30000).toISOString()};
      else if (url.pathname.endsWith('/reauthenticate')) return route.fulfill({status:204});
      else if (url.pathname === '/api/devices/'+id) body = {device:{id,name:'Camera smoke',location:'Test room',status:'OFFLINE',stream_version:null}};
      return route.fulfill({json:body});
    });
    await page.goto((process.env.SMOKE_URL || 'http://localhost:5174')+'/devices/'+id+'/camera');
    await page.getByRole('status').filter({hasText:/^Preview ready$/}).waitFor();
    assert.equal(await page.evaluate(() => window.captureCalls), 1);
    await page.getByRole('button',{name:'Start publishing',exact:true}).click();
    await page.getByRole('status').filter({hasText:/^Publishing$/}).waitFor();
    await page.getByRole('button',{name:'Lock controls',exact:true}).click();
    await page.getByRole('heading',{name:'Camera monitoring is locked'}).waitFor();
    assert.equal(await page.evaluate(() => window.captured.getVideoTracks()[0].readyState), 'live');
    assert.equal(await page.getByRole('button',{name:'Stop publishing',exact:true}).count(), 0);
    await page.getByLabel('Password').fill('mock-password');
    await page.getByRole('button',{name:'Unlock',exact:true}).click();
    await page.getByRole('button',{name:'Stop publishing',exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.captureCalls), 1);
    for (const width of [375,768,1440]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    }
    await page.getByRole('button',{name:'Stop publishing',exact:true}).click();
    await page.getByRole('status').filter({hasText:/^Preview ready$/}).waitFor();
    assert.equal(await page.evaluate(() => window.captured.getVideoTracks()[0].readyState), 'live');
    assert.equal(await page.evaluate(() => window.captureCalls), 1);
    console.log('PASS: automatic preview once, explicit publication, lock/unlock retains preview, Stop returns to preview-only, 375/768/1440px no horizontal overflow.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

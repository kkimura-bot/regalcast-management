import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

await page.goto('http://localhost:8081');
await page.waitForTimeout(2000);
await page.fill('#login-email', 'k_kimura@regalcast.in');
await page.fill('#login-pass', 'Regal0843');
await page.click('#login-btn');
await page.waitForTimeout(4000);

// 管理グループを開く
await page.click('#tabgroup-kanri .tab-group-header');
await page.waitForTimeout(500);

// 入社手続きタブをクリック
await page.click('[data-tab="onboarding"]');
await page.waitForTimeout(2000);

await page.screenshot({ path: '/tmp/onboarding_tab.png' });
console.log('Screenshot taken');

await browser.close();

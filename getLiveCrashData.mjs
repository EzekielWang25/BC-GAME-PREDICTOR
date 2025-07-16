import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

let browser, page;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
      defaultViewport: null,
    });
    page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
    );
    await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    console.log('🧪 Loading crash page in background...');
    await page.goto('https://bc.game/game/crash', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await sleep(8000);
    console.log('✅ Crash page loaded and ready.');
  }
}

export async function fetchLatestCrashRounds() {
  if (!page) throw new Error('Browser not initialized. Run initBrowser() first.');

  const MAX_TRIES = 10;
  let rounds = [];

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    rounds = await page.evaluate(() => {
      // only spans that end with '×'
      const spans = Array.from(document.querySelectorAll('span'))
        .filter(el => el.textContent.trim().endsWith('×'));

      // parse, remove consecutive duplicates
      const raw = spans
        .map(el => parseFloat(el.textContent.replace('×', '').trim()))
        .filter(n => !isNaN(n));

      return raw.filter((v, i, a) => i === 0 || v !== a[i - 1]);
    });

    if (rounds.length >= 8) break;
    console.log(`⚠️ Only ${rounds.length} rounds found—retrying (${attempt}/${MAX_TRIES})`);
    await sleep(1500);
  }

  if (rounds.length < 8) {
    console.warn(`⚠️ Could only fetch ${rounds.length} rounds after retries.`);
  }

  console.log('✅ Live crash data:', rounds.slice(0, 20));
  // reload quietly for next time
  page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  return rounds;
}

const puppeteer = require('puppeteer');

(async () => {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));
  page.on('requestfailed', request => {
    console.log(`REQUEST FAILED: ${request.url()} - ${request.failure().errorText}`);
  });
  
  console.log("Navigating to http://localhost:3000 ...");
  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  } catch (e) {
    console.log("Goto error:", e.message);
  }
  
  console.log("Waiting 5 seconds for initialization...");
  await new Promise(r => setTimeout(r, 5000));
  
  console.log("Clicking the Connect Wallet button (if it exists)...");
  try {
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const connectBtn = buttons.find(b => b.textContent.includes('Connect Wallet'));
      if (connectBtn) {
        console.log("Found button, clicking it...");
        connectBtn.click();
      } else {
        console.log("Connect Wallet button not found.");
      }
    });
  } catch(e) {
    console.log("Failed to click button:", e.message);
  }
  
  console.log("Waiting 3 more seconds for click response...");
  await new Promise(r => setTimeout(r, 3000));
  
  await browser.close();
  console.log("Done.");
  process.exit(0);
})();

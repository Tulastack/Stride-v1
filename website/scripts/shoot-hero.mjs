import puppeteer from 'puppeteer-core'
const OUT = process.argv[2]
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
await page.goto('http://localhost:5199', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1500))
for (let i = 0; i < 8; i++) {
  await page.screenshot({ path: `${OUT}/hero-t${i}.png` })
  await new Promise((r) => setTimeout(r, 1800))
}
await browser.close()
console.log('done')

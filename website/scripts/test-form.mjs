import puppeteer from 'puppeteer-core'

const OUT = process.argv[2] ?? '.'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
await page.goto('http://localhost:5199', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 2000))

// Scroll to waitlist, fill and submit
await page.evaluate(`document.querySelector('#waitlist').scrollIntoView()`)
await new Promise((r) => setTimeout(r, 1200))
await page.type('#waitlist input[type=email]', 'athlete@example.com')
await page.click('#waitlist button[type=submit]')
await new Promise((r) => setTimeout(r, 1200))
const success = await page.evaluate(
  `document.querySelector('#waitlist')?.innerText.includes('LANE 1')`,
)
await page.screenshot({ path: `${OUT}/form-result.png` })

// Test nav CTA scrolls to waitlist
await page.evaluate('window.scrollTo(0,0)')
await new Promise((r) => setTimeout(r, 800))
await page.click('header button')
await new Promise((r) => setTimeout(r, 2200))
const atWaitlist = await page.evaluate(
  `Math.abs(document.querySelector('#waitlist').getBoundingClientRect().top) < 300`,
)

console.log(JSON.stringify({ success, atWaitlist, errors: errors.slice(0, 6) }, null, 2))
await browser.close()

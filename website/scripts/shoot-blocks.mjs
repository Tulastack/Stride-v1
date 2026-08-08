// Capture the waitlist block-start animation at intervals across its loop.
import puppeteer from 'puppeteer-core'

const OUT = process.argv[2] ?? '.'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--hide-scrollbars'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
await page.goto('http://localhost:5199', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1500))
await page.evaluate(`(() => {
  const el = document.querySelector('#waitlist')
  window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120)
})()`)
await new Promise((r) => setTimeout(r, 1000))
for (let i = 0; i < 6; i++) {
  await page.screenshot({ path: `${OUT}/blocks-${i}.png` })
  await new Promise((r) => setTimeout(r, 1300))
}
await browser.close()
console.log('done')

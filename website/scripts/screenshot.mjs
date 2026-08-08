// Screenshot the Stride landing page at each section.
// Usage: node shoot.mjs [outDir]
import puppeteer from 'puppeteer-core'

const OUT = process.argv[2] ?? new URL('.', import.meta.url).pathname
const sections = ['problem', 'engine', 'engine-mid', 'engine-late', 'report', 'compare', 'pricing', 'waitlist', 'footer']

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1440,900', '--hide-scrollbars'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
await page.goto('http://localhost:5199', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 2500))
await page.screenshot({ path: `${OUT}/s0-hero.png` })

async function shootAt(name, yExpr) {
  await page.evaluate(yExpr)
  await new Promise((r) => setTimeout(r, 1600))
  await page.screenshot({ path: `${OUT}/s-${name}.png` })
}

const scrollTo = (sel, extra = 0) =>
  `(() => { const el = document.querySelector('${sel}'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 64 + ${extra}); })()`

await shootAt('ticker', `window.scrollTo(0, window.innerHeight * 0.9)`)
await shootAt('problem', scrollTo('#problem'))
await shootAt('engine-1', scrollTo('#engine'))
await shootAt('engine-2', scrollTo('#engine', 1400))
await shootAt('engine-3', scrollTo('#engine', 2800))
await shootAt('report', scrollTo('#report'))
await shootAt('report-2', scrollTo('#report', 500))
await shootAt('compare', scrollTo('#pricing', -900))
await shootAt('pricing', scrollTo('#pricing'))
await shootAt('waitlist', scrollTo('#waitlist'))
await shootAt('footer', `window.scrollTo(0, document.body.scrollHeight)`)

await browser.close()
console.log('done')

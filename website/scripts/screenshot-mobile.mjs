// Mobile-viewport screenshots of the Stride landing page.
import puppeteer from 'puppeteer-core'

const OUT = process.argv[2] ?? '.'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--hide-scrollbars'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
await page.goto('http://localhost:5199', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 2500))
await page.screenshot({ path: `${OUT}/m-hero.png` })

const shoot = async (name, expr) => {
  await page.evaluate(expr)
  await new Promise((r) => setTimeout(r, 1500))
  await page.screenshot({ path: `${OUT}/m-${name}.png` })
}
const at = (sel, extra = 0) =>
  `(() => { const el = document.querySelector('${sel}'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 64 + ${extra}); })()`

await shoot('hero2', 'window.scrollTo(0, window.innerHeight * 0.85)')
await shoot('problem', at('#problem'))
await shoot('engine', at('#engine', 700))
await shoot('report', at('#report', 300))
await shoot('pricing', at('#pricing'))
await shoot('waitlist', at('#waitlist'))
await browser.close()
console.log('done')

import Reveal from './Reveal'
import SectionHeading from './SectionHeading'
import { scrollToId } from '../lib/scroll'

const FREE = ['Full video analysis', 'Form score & flaw detection', '11-metric breakdown']
const PREMIUM = [
  'Everything in Free',
  'AI coach that knows your full history',
  'Progress tracking & trend charts',
  'Training plans, synced to your calendar',
  'Early access to new metrics',
]

export default function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-36">
      <SectionHeading
        index="05"
        eyebrow="PRICING"
        title="A season of coaching for less than one session."
        lede="A private sprint coach runs $200–500 per session. Stride Premium is $12 a year."
      />

      <div className="grid max-w-4xl gap-5 md:grid-cols-[1fr_1.15fr]">
        <Reveal>
          <article className="flex h-full flex-col rounded-lg border border-hairline/70 bg-graphite-850 p-8">
            <p className="font-mono text-xs tracking-[0.3em] text-muted">FREE</p>
            <p className="mt-5 flex items-baseline gap-2">
              <span className="font-mono text-5xl text-bone-100">$0</span>
              <span className="font-mono text-sm text-muted">forever</span>
            </p>
            <p className="mt-2 text-sm text-bone-300">Real analysis. No card, no trial clock.</p>
            <ul className="mt-8 flex-1 space-y-3 text-[15px] text-bone-300">
              {FREE.map((f) => (
                <li key={f} className="flex gap-3">
                  <span className="font-mono text-muted">—</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => scrollToId('#waitlist')}
              className="mt-8 rounded-[4px] border border-hairline px-5 py-3 font-display font-medium transition-colors hover:border-bone-300"
            >
              Start free
            </button>
          </article>
        </Reveal>

        <Reveal delay={0.12}>
          <article className="relative flex h-full flex-col overflow-hidden rounded-lg border border-gold/60 bg-graphite-850 p-8">
            <div className="absolute inset-x-0 top-0 h-[3px] bg-gold" />
            <p className="flex items-baseline justify-between">
              <span className="font-mono text-xs tracking-[0.3em] text-gold">PREMIUM</span>
              <span className="font-mono text-[10px] tracking-[0.2em] text-muted">
                LAUNCH PRICE — LOCKED FOR WAITLIST
              </span>
            </p>
            <p className="mt-5 flex items-baseline gap-3">
              <span className="font-mono text-5xl text-gold">$1</span>
              <span className="font-mono text-sm text-muted">/ month</span>
              <span className="font-mono text-sm text-muted line-through decoration-flaw/70">
                $200 / session
              </span>
            </p>
            <p className="mt-2 text-sm text-bone-300">
              The full coaching loop: analyze, correct, schedule, improve.
            </p>
            <ul className="mt-8 flex-1 space-y-3 text-[15px] text-bone-300">
              {PREMIUM.map((f) => (
                <li key={f} className="flex gap-3">
                  <span className="font-mono text-gold">+</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => scrollToId('#waitlist')}
              className="mt-8 rounded-[4px] bg-gold px-5 py-3.5 font-display text-base font-semibold text-graphite-900 transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              Lock in $1/month →
            </button>
            <p className="mt-3 text-center font-mono text-[10px] tracking-wide text-muted">
              Cancel anytime · Waitlist members keep launch pricing
            </p>
          </article>
        </Reveal>
      </div>
    </section>
  )
}

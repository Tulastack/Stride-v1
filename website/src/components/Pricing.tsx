import Reveal from './Reveal'
import SectionHeading from './SectionHeading'
import { scrollToId } from '../lib/scroll'

export default function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-36">
      <SectionHeading
        index="05"
        eyebrow="PRICING"
        title="A coach for the price of a gel."
        lede="One session with a private sprint coach costs $200–500. Stride's entire premium tier costs a dollar a month."
      />

      <div className="grid max-w-4xl gap-5 md:grid-cols-2">
        <Reveal>
          <article className="flex h-full flex-col rounded-lg border border-hairline/70 bg-graphite-850 p-8">
            <p className="font-mono text-xs tracking-[0.3em] text-muted">FREE</p>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-5xl text-bone-100">$0</span>
            </p>
            <ul className="mt-8 flex-1 space-y-3 text-[15px] text-bone-300">
              {['Full video analysis', 'Form score & flaw detection', '11-metric breakdown'].map(
                (f) => (
                  <li key={f} className="flex gap-3">
                    <span className="font-mono text-muted">—</span> {f}
                  </li>
                ),
              )}
            </ul>
            <button
              onClick={() => scrollToId('#waitlist')}
              className="mt-8 rounded-[4px] border border-hairline px-5 py-3 font-display font-medium transition-colors hover:border-bone-300"
            >
              Join waitlist
            </button>
          </article>
        </Reveal>

        <Reveal delay={0.12}>
          <article className="relative flex h-full flex-col overflow-hidden rounded-lg border border-volt/50 bg-graphite-850 p-8">
            <div className="absolute inset-x-0 top-0 h-px bg-volt" />
            <p className="flex items-center justify-between font-mono text-xs tracking-[0.3em]">
              <span className="text-volt">PREMIUM</span>
              <span className="rounded-[3px] border border-volt/40 px-2 py-0.5 text-[9px] text-volt">
                90% CHOOSE THIS
              </span>
            </p>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-5xl text-volt">$1</span>
              <span className="font-mono text-sm text-muted">/ month</span>
            </p>
            <ul className="mt-8 flex-1 space-y-3 text-[15px] text-bone-300">
              {[
                'Everything in Free',
                'AI coach with your full history',
                'Progress tracking & trends',
                'Training plans, synced to calendar',
              ].map((f) => (
                <li key={f} className="flex gap-3">
                  <span className="font-mono text-volt">+</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => scrollToId('#waitlist')}
              className="mt-8 rounded-[4px] bg-volt px-5 py-3 font-display font-semibold text-graphite-900 transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              Get early access
            </button>
          </article>
        </Reveal>
      </div>
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'motion/react'
import Reveal from './Reveal'
import SectionHeading from './SectionHeading'

function ScoreRing({ score }: { score: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const [display, setDisplay] = useState(0)
  const r = 52
  const c = 2 * Math.PI * r

  useEffect(() => {
    if (!inView) return
    const start = performance.now()
    const dur = 1400
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min((now - start) / dur, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(eased * score))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, score])

  return (
    <div ref={ref} className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#221F1A" strokeWidth="7" />
        <motion.circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="#E8C87D"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={inView ? { strokeDashoffset: c * (1 - score / 100) } : {}}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-3xl text-bone-100">{display}</span>
        <span className="font-mono text-[10px] tracking-[0.1em] text-muted">FORM SCORE</span>
      </div>
    </div>
  )
}

const TILES = [
  { k: 'HIP EXTENSION', v: '162.4°', tier: 'TRUSTED', tone: 'improve' },
  { k: 'GROUND CONTACT', v: '0.104s', tier: 'TRUSTED', tone: '' },
  { k: 'FLIGHT TIME', v: '0.132s', tier: 'TRUSTED', tone: '' },
  { k: 'CADENCE', v: '4.61/s', tier: 'TRUSTED', tone: '' },
  { k: 'TRUNK LEAN', v: '8.9°', tier: 'TRUSTED', tone: 'improve' },
  { k: 'ARM CARRY', v: 'T2', tier: 'EXPERIMENTAL', tone: 'muted' },
]

export default function Metrics() {
  return (
    <section id="report" className="mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-36">
      <SectionHeading
        index="03"
        eyebrow="THE REPORT"
        title="Numbers a coach would charge for. Language anyone can use."
        lede="Every analysis returns a scored report: what's off, by how many degrees, why it costs you speed, and exactly which drill fixes it."
      />

      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        {/* Report card mock */}
        <Reveal>
          <article className="relative overflow-hidden rounded-xl border border-hairline/70 bg-graphite-850 shadow-2xl shadow-black/40">
            {/* Header */}
            <header className="flex items-center justify-between border-b border-hairline/60 bg-graphite-900/60 px-5 py-3">
              <span className="font-mono text-[10px] tracking-[0.12em] text-muted">
                ANALYSIS 0027 · 100M · LANE 4
              </span>
              <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.1em] text-gold">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                COMPLETE · 14.2s
              </span>
            </header>

            {/* Score row */}
            <div className="flex items-center gap-5 border-b border-hairline/40 px-5 py-4">
              <ScoreRing score={82} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg font-semibold leading-snug text-bone-100">
                  Dynamic acceleration setup. Noticeable hip collapse at toe-off.
                </p>
                <p className="mt-2 font-mono text-[10px] tracking-[0.12em] text-muted">
                  RTMPOSE · GRAVITY-ANCHORED · 11 METRICS
                </p>
              </div>
            </div>

            {/* Primary issue */}
            <div className="p-5">
              <div className="rounded-md border border-hairline/60 border-l-4 border-l-flaw bg-graphite-800 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.1em] text-flaw">
                    #1 · LOW KNEE DRIVE
                  </span>
                  <span className="rounded-sm bg-flaw px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em] text-graphite-900">
                    HIGH
                  </span>
                </div>

                <div className="mt-3 flex items-end gap-3">
                  <span className="font-mono text-4xl font-light text-bone-100">81.2°</span>
                  <div className="mb-1 flex flex-col gap-0.5">
                    <span className="font-mono text-[10px] tracking-[0.08em] text-muted">MEASURED</span>
                    <span className="font-mono text-[10px] tracking-[0.08em] text-gold">OPTIMAL 90–95°</span>
                  </div>
                </div>

                {/* Range bar */}
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-graphite-700">
                  <div className="relative h-full w-full">
                    <div
                      className="absolute h-full rounded-full bg-flaw/70"
                      style={{ width: '54%' }}
                    />
                    <div
                      className="absolute h-full rounded-full bg-gold/50"
                      style={{ left: '60%', width: '5%' }}
                    />
                  </div>
                </div>
                <div className="mt-1 flex justify-between font-mono text-[9px] text-muted">
                  <span>60°</span>
                  <span className="text-gold">90–95° optimal</span>
                  <span>110°</span>
                </div>

                <p className="mt-3 text-[15px] leading-relaxed text-bone-300">
                  Your lead thigh is dropping early, reducing vertical flight time and
                  restricting horizontal stride length.
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-hairline/60 bg-graphite-700 px-3 py-2.5">
                  <span className="font-mono text-[10px] tracking-[0.08em] text-gold">
                    ↗ KNEE DRIVE A-SKIPS
                  </span>
                  <span className="font-mono text-[10px] text-muted">3 × 20m</span>
                  <span className="text-[13px] italic text-bone-300">
                    "Punch lead foot down directly under hip center."
                  </span>
                </div>
              </div>
            </div>
          </article>
        </Reveal>

        {/* Metric tiles + copy */}
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
            {TILES.map((t, i) => (
              <Reveal key={t.k} delay={0.05 * i}>
                <div className="rounded-md border border-hairline/60 bg-graphite-850 p-4 transition-colors duration-300 hover:border-bone-300/40">
                  <p className="font-mono text-[10px] tracking-[0.1em] text-muted">{t.k}</p>
                  <p
                    className={`mt-2 font-mono text-xl ${
                      t.tone === 'improve'
                        ? 'text-gold'
                        : t.tone === 'muted'
                          ? 'text-muted'
                          : 'text-bone-100'
                    }`}
                  >
                    {t.v}
                  </p>
                  <p
                    className={`mt-2 font-mono text-[10px] tracking-[0.1em] ${
                      t.tier === 'TRUSTED' ? 'text-gold/80' : 'text-muted'
                    }`}
                  >
                    {t.tier}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* AI Coach card */}
          <Reveal delay={0.15}>
            <article className="mt-4 rounded-md border border-hairline/60 bg-graphite-850">
              <header className="flex items-center justify-between border-b border-hairline/50 px-5 py-3">
                <span className="font-mono text-[11px] tracking-[0.1em] text-gold">
                  AI COACH
                </span>
                <span className="font-mono text-[10px] tracking-[0.08em] text-muted">
                  KNOWS YOUR HISTORY · DRILLS · CALENDAR
                </span>
              </header>
              <div className="space-y-3 px-5 py-4">
                <p className="ml-auto w-fit max-w-[85%] rounded-md bg-graphite-700 px-4 py-2.5 text-[15px] text-bone-100">
                  Why is my knee drive flagged?
                </p>
                <div className="w-fit max-w-[92%] rounded-md border border-hairline/60 bg-graphite-700 px-4 py-2.5 text-[15px] leading-relaxed text-bone-300">
                  Your lead thigh peaked at{' '}
                  <span className="font-mono text-bone-100">81.2°</span>. Your last three
                  runs averaged <span className="font-mono text-bone-100">83°</span>, so
                  this is a pattern, not a one-off. It's costing you stride length. I've
                  put <span className="text-gold">A-skips, 3 × 20m</span> on Thursday.
                </div>
              </div>
              <footer className="border-t border-hairline/50 px-5 py-2.5">
                <p className="font-mono text-[10px] tracking-[0.08em] text-muted">
                  GROUNDED IN YOUR MEASUREMENTS. NOT GENERIC ADVICE. PREMIUM.
                </p>
              </footer>
            </article>
          </Reveal>

          <Reveal delay={0.22}>
            <ul className="mt-8 space-y-4">
              {[
                [
                  'Trust-tiered honesty',
                  'Metrics are labeled trusted or experimental based on camera angle, fps and keypoint confidence. Only trusted metrics raise flaws.',
                ],
                [
                  'Optimal ranges, not vibes',
                  'Every measurement is compared against sprint-literature ranges. You see measured vs optimal, in degrees and milliseconds.',
                ],
              ].map(([title, body]) => (
                <li key={title} className="flex gap-4">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                  <div>
                    <p className="font-display font-semibold">{title}</p>
                    <p className="mt-1 text-[15px] leading-relaxed text-bone-300">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

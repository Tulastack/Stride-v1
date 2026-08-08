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
    <div ref={ref} className="relative h-32 w-32">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#1E2127" strokeWidth="7" />
        <motion.circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="#CDFF4F"
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
        <span className="font-mono text-[9px] tracking-[0.25em] text-muted">FORM SCORE</span>
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
          <article className="relative overflow-hidden rounded-lg border border-hairline/70 bg-graphite-850">
            <header className="flex items-center justify-between border-b border-hairline/60 px-6 py-4">
              <span className="font-mono text-[10px] tracking-[0.3em] text-muted">
                ANALYSIS 0027 · 100M · LANE 4
              </span>
              <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-improve">
                <span className="h-1.5 w-1.5 rounded-full bg-improve animate-blink" />
                COMPLETE · 14.2s
              </span>
            </header>

            <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
              <ScoreRing score={82} />
              <div className="flex-1">
                <p className="font-display text-lg leading-snug font-semibold">
                  Dynamic acceleration setup. Noticeable hip collapse at toe-off.
                </p>
                <p className="mt-2 font-mono text-[10px] tracking-[0.25em] text-muted">
                  RTMPOSE · GRAVITY-ANCHORED · 11 METRICS
                </p>
              </div>
            </div>

            {/* Primary issue */}
            <div className="mx-6 mb-6 rounded-md border border-flaw/30 bg-flaw/[0.06] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs tracking-[0.2em] text-flaw">
                  #1 · LOW KNEE DRIVE
                </span>
                <span className="rounded-[3px] border border-flaw/50 px-2 py-0.5 font-mono text-[9px] tracking-[0.2em] text-flaw">
                  SEVERITY HIGH
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-4 font-mono">
                <span className="text-3xl text-bone-100">81.2°</span>
                <span className="text-sm text-muted">measured</span>
                <span className="text-sm text-improve">optimal 90–95°</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-bone-300">
                Your lead thigh is dropping early, reducing vertical flight time and
                restricting horizontal stride length.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline/40 pt-4">
                <span className="font-mono text-xs text-volt">FIX: KNEE DRIVE A-SKIPS</span>
                <span className="font-mono text-xs text-muted">3 × 20m</span>
                <span className="text-xs text-bone-300">
                  “Punch lead foot down directly under hip center.”
                </span>
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
                  <p className="font-mono text-[9px] tracking-[0.25em] text-muted">{t.k}</p>
                  <p
                    className={`mt-2 font-mono text-xl ${
                      t.tone === 'improve'
                        ? 'text-improve'
                        : t.tone === 'muted'
                          ? 'text-muted'
                          : 'text-bone-100'
                    }`}
                  >
                    {t.v}
                  </p>
                  <p
                    className={`mt-2 font-mono text-[8px] tracking-[0.25em] ${
                      t.tier === 'TRUSTED' ? 'text-improve/80' : 'text-muted'
                    }`}
                  >
                    {t.tier}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.2}>
            <ul className="mt-8 space-y-4">
              {[
                [
                  'Trust-tiered honesty',
                  'Metrics are labeled trusted or experimental based on camera angle, fps and keypoint confidence. Only trusted metrics raise flaws.',
                ],
                [
                  'Optimal ranges, not vibes',
                  'Every measurement is compared against sprint-literature ranges — you see measured vs. optimal, in degrees and milliseconds.',
                ],
                [
                  'Drills with volumes and cues',
                  'Each flaw maps to corrective drills with exact sets, distances and coaching cues — ready to schedule.',
                ],
              ].map(([title, body]) => (
                <li key={title} className="flex gap-4">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-volt" />
                  <div>
                    <p className="font-display font-semibold">{title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-bone-300">{body}</p>
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

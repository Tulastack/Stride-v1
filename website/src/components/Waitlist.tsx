import { lazy, Suspense, useState, type FormEvent } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Reveal from './Reveal'

const BlocksScene = lazy(() => import('./three/BlocksScene'))

const ENDPOINT = import.meta.env.VITE_WAITLIST_ENDPOINT as string | undefined

export default function Waitlist() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState('error')
      return
    }
    setState('busy')
    try {
      if (ENDPOINT) {
        await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, source: 'stride-landing' }),
        })
      }
      setState('done')
    } catch {
      setState('done')
    }
  }

  return (
    <section
      id="waitlist"
      className="relative overflow-hidden border-t border-hairline/40"
    >
      {/* Faint LED dot field */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage: 'radial-gradient(circle, #2E2A24 1.2px, transparent 1.2px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse 80% 90% at 50% 50%, black 25%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 90% at 50% 50%, black 25%, transparent 75%)',
        }}
      />
      {/* Dot-matrix sprinter out of the blocks — full-section backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <Suspense fallback={null}>
          <BlocksScene />
        </Suspense>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

      <div className="relative mx-auto max-w-4xl px-5 pt-20 pb-24 text-center md:pt-24 md:pb-32">
        
        <Reveal delay={0.08}>
          <h2 className="font-display text-4xl font-bold tracking-tight text-balance md:text-6xl">
            Be the first out of the blocks.
          </h2>
        </Reveal>

        <Reveal delay={0.16}>
          <AnimatePresence mode="wait">
            {state === 'done' ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto mt-9 max-w-md rounded-md border border-gold/40 bg-gold/[0.07] px-6 py-5"
              >
                <p className="font-mono text-sm tracking-wide text-gold">
                  ✓ YOU'RE IN LANE 1
                </p>
                <p className="mt-1.5 text-sm text-bone-300">
                  We'll be in touch before the gun goes off.
                </p>
              </motion.div>
            ) : (
              <motion.form
                key="form"
                exit={{ opacity: 0, y: -10 }}
                onSubmit={submit}
                className="mx-auto mt-9 flex max-w-md flex-col gap-3 sm:flex-row"
              >
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (state === 'error') setState('idle')
                  }}
                  placeholder="you@fast.com"
                  className={`h-13 flex-1 rounded-[4px] border bg-graphite-800/90 px-4 font-mono text-sm text-bone-100 placeholder:text-muted focus:outline-none ${
                    state === 'error' ? 'border-flaw' : 'border-hairline focus:border-gold'
                  } transition-colors`}
                />
                <button
                  type="submit"
                  disabled={state === 'busy'}
                  className="h-13 rounded-[4px] bg-gold px-7 font-display font-semibold text-graphite-900 transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98] disabled:opacity-60"
                >
                  {state === 'busy' ? 'Joining…' : 'Join waitlist'}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </Reveal>

        <Reveal delay={0.24}>
          <p className="mx-auto mt-6 max-w-xl text-lg text-bone-300">
            Stride launches on the App Store soon. Early access — free analyses on day one.
          </p>
        </Reveal>

        <Reveal delay={0.32}>
          <p className="mt-10 font-mono text-[11px] tracking-wide text-muted">
            Coach a team? We're running school pilot programs —{' '}
            <a
              href="mailto:adhibanarul@gmail.com?subject=Stride%20team%20pilot"
              className="text-bone-300 underline decoration-hairline underline-offset-4 transition-colors hover:text-gold"
            >
              talk to us
            </a>
            .
          </p>
        </Reveal>
      </div>
    </section>
  )
}

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { motion, useScroll, useTransform } from 'motion/react'
import { scrollToId } from '../lib/scroll'

const RunnerScene = lazy(() => import('./three/RunnerScene'))

function useIsDesktop() {
  const [desktop, setDesktop] = useState(
    () => window.matchMedia('(min-width: 768px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = (e: MediaQueryListEvent) => setDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return desktop
}

const EASE = [0.22, 1, 0.36, 1] as const

const STATS = [
  { value: '11', label: 'metrics per run' },
  { value: '~15s', label: 'video to report' },
  { value: '360°', label: 'any camera angle' },
]

export default function Hero() {
  const ref = useRef<HTMLElement>(null)
  const isDesktop = useIsDesktop()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const sceneOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0])
  const textY = useTransform(scrollYProgress, [0, 1], [0, 120])
  const textOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0])

  return (
    <section ref={ref} id="top" className="relative min-h-screen overflow-hidden">
      {/* LED dot-matrix field behind the scene */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: 'radial-gradient(circle, #2A2E36 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage:
            'radial-gradient(ellipse 75% 85% at 68% 45%, black 15%, transparent 72%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 75% 85% at 68% 45%, black 15%, transparent 72%)',
        }}
      />
      {/* 3D scene — right side on desktop, below text on mobile */}
      {isDesktop && (
        <motion.div
          style={{ opacity: sceneOpacity }}
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute inset-y-0 right-0 w-[62%]">
            <Suspense fallback={null}>
              <RunnerScene />
            </Suspense>
            {/* fade scene into the page background on its left edge */}
            <div className="absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-graphite-900 to-transparent" />
          </div>
        </motion.div>
      )}

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col justify-center px-5 pt-28 pb-16 md:px-8 md:pt-16">
        <motion.div style={{ y: textY, opacity: textOpacity }} className="max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.35 }}
            className="mb-6 flex items-center gap-2.5 font-mono text-xs tracking-[0.25em] text-bone-300"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-volt animate-blink" />
            3D BIOMETRIC FORM ANALYSIS
          </motion.p>

          <h1 className="font-display text-5xl leading-[1.02] font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">
            {['Elite sprint analysis.', 'Any phone. Any angle.'].map((line, i) => (
              <span key={line} className="block overflow-hidden">
                <motion.span
                  className="block"
                  initial={{ y: '110%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.9, ease: EASE, delay: 0.45 + i * 0.12 }}
                >
                  {i === 1 ? (
                    <>
                      Any phone. <span className="text-volt">Any angle.</span>
                    </>
                  ) : (
                    line
                  )}
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.8 }}
            className="mt-7 max-w-xl text-lg leading-relaxed text-bone-300"
          >
            Film a sprint. Stride reconstructs your biomechanics — joint angles, stride
            timing, form flaws — and hands you a coaching plan in about{' '}
            <span className="font-mono text-base text-bone-100">15 seconds</span>.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.95 }}
            className="mt-9 flex flex-wrap items-center gap-4"
          >
            <button
              onClick={() => scrollToId('#waitlist')}
              className="group rounded-[4px] bg-volt px-6 py-3.5 font-display text-base font-semibold text-graphite-900 transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]"
            >
              Join the waitlist
              <span className="ml-2 inline-block transition-transform duration-200 group-hover:translate-x-1">
                →
              </span>
            </button>
            <button
              onClick={() => scrollToId('#engine')}
              className="rounded-[4px] border border-hairline px-6 py-3.5 font-display text-base font-medium text-bone-100 transition-colors duration-200 hover:border-bone-300"
            >
              See the engine
            </button>
          </motion.div>

          <motion.dl
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 1.1 }}
            className="mt-14 flex gap-10 border-t border-hairline/60 pt-6"
          >
            {STATS.map((s) => (
              <div key={s.label}>
                <dt className="sr-only">{s.label}</dt>
                <dd className="font-mono text-2xl text-bone-100">{s.value}</dd>
                <dd className="mt-1 text-xs tracking-wide text-muted uppercase">{s.label}</dd>
              </div>
            ))}
          </motion.dl>
        </motion.div>

        {/* Mobile scene */}
        {!isDesktop && (
          <div className="mt-10 h-[380px] w-full">
            <Suspense fallback={null}>
              <RunnerScene />
            </Suspense>
          </div>
        )}
      </div>

      {/* Scroll cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.6, duration: 1 }}
        style={{ opacity: textOpacity }}
        className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 md:block"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          className="h-8 w-px bg-gradient-to-b from-transparent via-bone-300/60 to-transparent"
        />
      </motion.div>
    </section>
  )
}

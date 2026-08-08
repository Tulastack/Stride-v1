import { lazy, Suspense, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import SectionHeading from './SectionHeading'

const LIVE_METRICS = [
  { k: 'KNEE DRIVE', v: '81.2°', tone: 'flaw' },
  { k: 'HIP EXT', v: '168.4°', tone: 'gold' },
  { k: 'TRUNK LEAN', v: '9.1°', tone: 'bone' },
  { k: 'CADENCE', v: '4.6/s', tone: 'bone' },
  { k: 'CONTACT', v: '0.104s', tone: 'bone' },
  { k: 'OVERSTRIDE', v: '7.2%', tone: 'gold' },
  { k: 'ARM SWING', v: '94°', tone: 'bone' },
  { k: 'FLIGHT', v: '0.132s', tone: 'bone' },
]

const PipelineScene = lazy(() => import('./three/PipelineScene'))

const STEPS = [
  {
    tag: 'FILM',
    title: 'Any angle. Any distance.',
    body: 'Record or import a clip. Race footage, practice reps, head-on, 45 degrees. No tripods, no lab, no controlled conditions.',
    caption: 'ORBIT 360 · ANY CAMERA ANGLE',
  },
  {
    tag: 'EXTRACT',
    title: 'Pose estimation, every frame',
    body: 'RTMPose reads 17 keypoints per frame including nose, shoulders, elbows, wrists, hips, knees, ankles and feet. IoU-based tracking locks onto your athlete even in crowded multi-runner clips.',
    caption: '17 KEYPOINTS / FRAME',
  },
  {
    tag: 'CANONICALIZE',
    title: 'Gravity-anchored 3D',
    body: 'A monocular 3D lift combined with phone accelerometer data aligns every measurement to true vertical. Camera tilt stops corrupting your angles.',
    caption: 'GRAVITY LOCK · TRUE VERTICAL',
  },
  {
    tag: 'MEASURE',
    title: 'The 11-metric sagittal engine',
    body: 'Joint angles, stride phases, gait timing. Every metric is trust-tiered so only measurements the engine can fully validate raise flaws.',
    caption: 'LIVE JOINT ANGLES · TRUST-TIERED',
  },
  {
    tag: 'COACH',
    title: 'Grounded advice, on your calendar',
    body: 'An AI coach grounded in your actual numbers writes the report, prescribes corrective drills with volumes and cues, and syncs a training plan to your calendar.',
    caption: 'DRILLS PRESCRIBED · CALENDAR SYNC',
  },
]

export default function Pipeline() {
  const [active, setActive] = useState(0)

  return (
    <section id="engine" className="border-y border-hairline/40 bg-graphite-850/40">
      <div className="mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-36">
        <SectionHeading
          index="02"
          eyebrow="THE ENGINE"
          title="From shaky phone video to lab-grade biomechanics."
          lede="Five stages, about 15 seconds, under 2 cents of compute per analysis."
        />

        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Steps — scrolling column */}
          <div>
            {STEPS.map((s, i) => (
              <motion.div
                key={s.tag}
                onViewportEnter={() => setActive(i)}
                viewport={{ margin: '-46% 0px -46% 0px' }}
                className="flex min-h-[40vh] items-center lg:min-h-[52vh]"
              >
                <div
                  className={`border-l-2 py-2 pl-7 transition-all duration-500 ${
                    active === i ? 'border-gold' : 'border-hairline/60'
                  }`}
                >
                  <p
                    className={`font-mono text-xs tracking-[0.3em] transition-colors duration-500 ${
                      active === i ? 'text-gold' : 'text-muted'
                    }`}
                  >
                    0{i + 1} · {s.tag}
                  </p>
                  <h3
                    className={`mt-3 font-display text-2xl font-semibold transition-colors duration-500 md:text-3xl ${
                      active === i ? 'text-bone-100' : 'text-muted'
                    }`}
                  >
                    {s.title}
                  </h3>
                  <p
                    className={`mt-3 max-w-md leading-relaxed transition-colors duration-500 ${
                      active === i ? 'text-bone-300' : 'text-muted/70'
                    }`}
                  >
                    {s.body}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Sticky live 3D panel */}
          <div className="hidden lg:block">
            <div className="sticky top-0 flex h-screen items-center justify-center">
              <div className="relative h-[72vh] max-h-[700px] w-full">
                <div className="absolute inset-0 rounded-lg border border-hairline/60 bg-graphite-850" />
                {[
                  'top-2 left-2 border-t border-l',
                  'top-2 right-2 border-t border-r',
                  'bottom-2 left-2 border-b border-l',
                  'bottom-2 right-2 border-b border-r',
                ].map((pos) => (
                  <div key={pos} className={`absolute h-3 w-3 border-bone-300/40 ${pos}`} />
                ))}
                <div className="absolute inset-0 overflow-hidden rounded-lg">
                  <Suspense fallback={null}>
                    <PipelineScene step={active} />
                  </Suspense>
                </div>

                {/* Metric burst — only on step 3 (MEASURE) */}
                <AnimatePresence>
                  {active === 3 && (
                    <motion.div
                      key="metrics-burst"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.35 }}
                      className="pointer-events-none absolute inset-0 flex flex-wrap content-center items-center justify-center gap-2 px-6"
                    >
                      {LIVE_METRICS.map((m, i) => (
                        <motion.div
                          key={m.k}
                          initial={{ opacity: 0, scale: 0.7, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.7, y: -6 }}
                          transition={{ delay: i * 0.06, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                          className="rounded border border-hairline/60 bg-graphite-900/90 px-3 py-2 backdrop-blur-sm"
                        >
                          <p className="font-mono text-[9px] tracking-[0.25em] text-muted">{m.k}</p>
                          <p className={`mt-1 font-mono text-base ${
                            m.tone === 'flaw' ? 'text-flaw' :
                            m.tone === 'gold' ? 'text-gold' : 'text-bone-100'
                          }`}>{m.v}</p>
                          <p className="mt-0.5 font-mono text-[8px] tracking-[0.2em] text-gold/70">TRUSTED</p>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="absolute inset-x-0 bottom-3 flex items-center justify-between px-4">
                  <motion.span
                    key={active}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="font-mono text-[10px] tracking-[0.25em] text-gold"
                  >
                    {STEPS[active].caption}
                  </motion.span>
                  <span className="font-mono text-[10px] tracking-[0.3em] text-muted">
                    0{active + 1} / 05
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

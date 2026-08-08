import { lazy, Suspense, useState } from 'react'
import { motion } from 'motion/react'
import SectionHeading from './SectionHeading'

const PipelineScene = lazy(() => import('./three/PipelineScene'))

const STEPS = [
  {
    tag: 'FILM',
    title: 'Any angle. Any distance.',
    body: 'Record or import a clip — race footage, practice reps, head-on, 45°. No tripods, no lab, no controlled conditions.',
    caption: 'ORBIT 360° — ANY CAMERA ANGLE',
  },
  {
    tag: 'EXTRACT',
    title: 'Pose estimation, every frame',
    body: 'RTMPose reads 17 keypoints per frame, while IoU-based tracking locks onto your athlete — even in crowded, multi-runner clips.',
    caption: '17 KEYPOINTS / FRAME',
  },
  {
    tag: 'CANONICALIZE',
    title: 'Gravity-anchored 3D',
    body: 'A monocular 3D lift plus phone accelerometer data aligns every measurement to true vertical. Camera tilt stops lying to your angles.',
    caption: 'GRAVITY LOCK — TRUE VERTICAL',
  },
  {
    tag: 'MEASURE',
    title: 'The 11-metric sagittal engine',
    body: 'Joint angles, stride phases, gait timing. Every metric is trust-tiered — only measurements the engine can validate at full confidence raise flaws.',
    caption: 'LIVE JOINT ANGLES · TRUST-TIERED',
  },
  {
    tag: 'COACH',
    title: 'Grounded advice, on your calendar',
    body: 'An AI coach grounded in your actual numbers writes the report, prescribes corrective drills with volumes and cues, and syncs a plan to your calendar.',
    caption: 'SLOW-MOTION REVIEW · DRILLS PRESCRIBED',
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
          lede="Five stages, ~15 seconds, under 2¢ of compute per analysis."
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

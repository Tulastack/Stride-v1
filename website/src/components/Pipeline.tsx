import { useState } from 'react'
import { motion } from 'motion/react'
import SectionHeading from './SectionHeading'
import PipelineVisual from './PipelineVisual'

const STEPS = [
  {
    tag: 'FILM',
    title: 'Any angle. Any distance.',
    body: 'Record or import a clip — race footage, practice reps, head-on, 45°. No tripods, no lab, no controlled conditions.',
  },
  {
    tag: 'EXTRACT',
    title: 'Pose estimation, every frame',
    body: 'RTMPose reads 17 keypoints per frame, while IoU-based tracking locks onto your athlete — even in crowded, multi-runner clips.',
  },
  {
    tag: 'CANONICALIZE',
    title: 'Gravity-anchored 3D',
    body: 'A monocular 3D lift plus phone accelerometer data aligns every measurement to true vertical. Camera tilt stops lying to your angles.',
  },
  {
    tag: 'MEASURE',
    title: 'The 11-metric sagittal engine',
    body: 'Joint angles, stride phases, gait timing. Every metric is trust-tiered — only measurements the engine can validate at full confidence raise flaws.',
  },
  {
    tag: 'COACH',
    title: 'Grounded advice, on your calendar',
    body: 'An AI coach grounded in your actual numbers writes the report, prescribes corrective drills with volumes and cues, and syncs a plan to your calendar.',
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
                    active === i ? 'border-volt' : 'border-hairline/60'
                  }`}
                >
                  <p
                    className={`font-mono text-xs tracking-[0.3em] transition-colors duration-500 ${
                      active === i ? 'text-volt' : 'text-muted'
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

          {/* Sticky visual */}
          <div className="hidden lg:block">
            <div className="sticky top-0 flex h-screen items-center justify-center">
              <PipelineVisual step={active} />
            </div>
          </div>
        </div>

      </div>
    </section>
  )
}

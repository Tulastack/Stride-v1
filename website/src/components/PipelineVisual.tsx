import { AnimatePresence, motion } from 'motion/react'

const EASE = [0.22, 1, 0.36, 1] as const

// Small keypoint figure (sagittal runner, mid knee-drive) shared by steps.
const KP: [number, number][] = [
  [200, 96], // head
  [196, 128], // neck
  [192, 168], // chest
  [184, 214], // pelvis
  [206, 218], // hipR
  [238, 252], // kneeR (driving)
  [232, 300], // ankleR
  [252, 306], // toeR
  [166, 216], // hipL
  [162, 268], // kneeL (behind)
  [128, 296], // ankleL
  [118, 312], // toeL
  [214, 136], // shoulderR
  [232, 172], // elbowR
  [252, 140], // wristR
  [178, 138], // shoulderL
  [150, 168], // elbowL
  [128, 196], // wristL
]
const LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 7],
  [3, 8],
  [8, 9],
  [9, 10],
  [10, 11],
  [1, 12],
  [12, 13],
  [13, 14],
  [1, 15],
  [15, 16],
  [16, 17],
]

function Skeleton({ color = '#ECE7DC', dim = false }: { color?: string; dim?: boolean }) {
  return (
    <g opacity={dim ? 0.45 : 1}>
      {LINKS.map(([a, b], i) => (
        <motion.line
          key={i}
          x1={KP[a][0]}
          y1={KP[a][1]}
          x2={KP[b][0]}
          y2={KP[b][1]}
          stroke={color}
          strokeWidth="1.5"
          strokeOpacity="0.55"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, delay: 0.3 + i * 0.03, ease: EASE }}
        />
      ))}
      {KP.map(([x, y], i) => (
        <motion.circle
          key={i}
          cx={x}
          cy={y}
          r={i === 0 ? 7 : 3}
          fill={i === 5 ? '#CDFF4F' : color}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.15 + i * 0.035, ease: EASE }}
        />
      ))}
    </g>
  )
}

function MonoLabel({
  x,
  y,
  children,
  color = '#8A8E97',
  delay = 0.6,
}: {
  x: number
  y: number
  children: string
  color?: string
  delay?: number
}) {
  return (
    <motion.text
      x={x}
      y={y}
      fill={color}
      fontFamily="'Space Mono', monospace"
      fontSize="10"
      letterSpacing="2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.5 }}
    >
      {children}
    </motion.text>
  )
}

/* Step 0 — FILM: phone frame, angle arcs */
function StepFilm() {
  return (
    <g>
      <motion.rect
        x={140}
        y={64}
        width={124}
        height={272}
        rx={14}
        fill="#16181D"
        stroke="#353A44"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
      />
      <Skeleton dim />
      {[0, 1, 2].map((i) => (
        <motion.path
          key={i}
          d={`M ${92 - i * 26} 200 A ${110 + i * 26} ${110 + i * 26} 0 0 1 ${200} ${
            90 - i * 26
          }`}
          fill="none"
          stroke="#CDFF4F"
          strokeOpacity={0.5 - i * 0.13}
          strokeWidth="1.2"
          strokeDasharray="3 6"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, delay: 0.4 + i * 0.18, ease: EASE }}
        />
      ))}
      <MonoLabel x={54} y={340}>
        NO TRIPOD. NO LAB.
      </MonoLabel>
      <MonoLabel x={54} y={358} color="#CDFF4F" delay={0.8}>
        RACE FOOTAGE OK
      </MonoLabel>
    </g>
  )
}

/* Step 1 — EXTRACT: keypoints light up with confidence readouts */
function StepExtract() {
  return (
    <g>
      <Skeleton color="#CDFF4F" />
      {[
        [252, 252, '0.97'],
        [120, 288, '0.94'],
        [262, 132, '0.91'],
      ].map(([x, y, c], i) => (
        <motion.text
          key={i}
          x={Number(x)}
          y={Number(y)}
          fill="#8A8E97"
          fontFamily="'Space Mono', monospace"
          fontSize="9"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 + i * 0.15 }}
        >
          {c}
        </motion.text>
      ))}
      <motion.rect
        x={96}
        y={70}
        width={210}
        height={260}
        fill="none"
        stroke="#CDFF4F"
        strokeOpacity="0.6"
        strokeWidth="1"
        strokeDasharray="5 4"
        initial={{ opacity: 0, scale: 1.08 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
      />
      <MonoLabel x={96} y={58} color="#CDFF4F" delay={0.5}>
        ATHLETE LOCK · IoU
      </MonoLabel>
      <MonoLabel x={96} y={356}>
        17 KEYPOINTS / FRAME
      </MonoLabel>
    </g>
  )
}

/* Step 2 — CANONICALIZE: tilted frame rights itself to true vertical */
function StepGravity() {
  return (
    <g>
      <motion.g
        style={{ transformOrigin: '200px 200px' }}
        initial={{ rotate: -14 }}
        animate={{ rotate: 0 }}
        transition={{ duration: 1.4, delay: 0.5, ease: EASE }}
      >
        <rect
          x={120}
          y={80}
          width={160}
          height={240}
          fill="#16181D"
          stroke="#353A44"
          strokeWidth="1"
        />
        <Skeleton dim />
      </motion.g>
      <motion.line
        x1={200}
        y1={48}
        x2={200}
        y2={352}
        stroke="#CDFF4F"
        strokeWidth="1"
        strokeDasharray="2 7"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, delay: 0.3 }}
      />
      <motion.g
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2, duration: 0.5 }}
      >
        <line x1={318} y1={120} x2={318} y2={168} stroke="#ECE7DC" strokeWidth="1.4" />
        <path d="M 312 160 L 318 172 L 324 160 Z" fill="#ECE7DC" />
        <text
          x={330}
          y={150}
          fill="#ECE7DC"
          fontFamily="'Space Mono', monospace"
          fontSize="12"
        >
          g
        </text>
      </motion.g>
      <MonoLabel x={132} y={356} color="#CDFF4F" delay={1.5}>
        TRUE VERTICAL LOCKED
      </MonoLabel>
    </g>
  )
}

/* Step 3 — MEASURE: metric bars + trust tiers */
function StepMeasure() {
  const bars = [
    ['HIP EXT', 0.82, '162.4°', true],
    ['KNEE DRIVE', 0.54, '81.2°', true],
    ['CONTACT', 0.7, '0.104s', true],
    ['CADENCE', 0.76, '4.61/s', true],
    ['ARM CARRY', 0.44, 'T2', false],
  ] as const
  return (
    <g>
      {bars.map(([label, w, val, trusted], i) => (
        <g key={label}>
          <MonoLabel x={70} y={102 + i * 44} delay={0.15 + i * 0.1}>
            {label}
          </MonoLabel>
          <rect
            x={70}
            y={112 + i * 44}
            width={220}
            height={6}
            fill="#1E2127"
            rx={1}
          />
          <motion.rect
            x={70}
            y={112 + i * 44}
            height={6}
            rx={1}
            fill={trusted ? '#CDFF4F' : '#8A8E97'}
            initial={{ width: 0 }}
            animate={{ width: 220 * w }}
            transition={{ duration: 0.9, delay: 0.3 + i * 0.12, ease: EASE }}
          />
          <motion.text
            x={300}
            y={119 + i * 44}
            fill="#ECE7DC"
            fontFamily="'Space Mono', monospace"
            fontSize="11"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 + i * 0.12 }}
          >
            {val}
          </motion.text>
          <motion.text
            x={70}
            y={134 + i * 44}
            fill={trusted ? '#5BE5A0' : '#8A8E97'}
            fontFamily="'Space Mono', monospace"
            fontSize="8"
            letterSpacing="2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 + i * 0.12 }}
          >
            {trusted ? 'TRUSTED' : 'EXPERIMENTAL'}
          </motion.text>
        </g>
      ))}
    </g>
  )
}

/* Step 4 — COACH: report line + drill chips landing on calendar */
function StepCoach() {
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI']
  return (
    <g>
      <motion.rect
        x={64}
        y={72}
        width={272}
        height={88}
        rx={6}
        fill="#16181D"
        stroke="#353A44"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      />
      <MonoLabel x={80} y={96} color="#CDFF4F" delay={0.3}>
        COACH
      </MonoLabel>
      <motion.text
        x={80}
        y={118}
        fill="#ECE7DC"
        fontFamily="'Hanken Grotesk Variable', sans-serif"
        fontSize="12"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45 }}
      >
        Lead thigh drops early — costing stride length.
      </motion.text>
      <motion.text
        x={80}
        y={140}
        fill="#B8B4AB"
        fontFamily="'Hanken Grotesk Variable', sans-serif"
        fontSize="12"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        A-skips, 3 × 20 m. Punch the foot down under the hip.
      </motion.text>

      {days.map((d, i) => (
        <g key={d}>
          <motion.rect
            x={64 + i * 56}
            y={216}
            width={48}
            height={96}
            rx={4}
            fill="#121419"
            stroke="#2A2E36"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + i * 0.07, duration: 0.5, ease: EASE }}
          />
          <MonoLabel x={74 + i * 56} y={234} delay={0.6 + i * 0.07}>
            {d}
          </MonoLabel>
        </g>
      ))}
      {[
        [1, '#CDFF4F', 'A-SKIP'],
        [3, '#5BE5A0', 'REST'],
        [4, '#CDFF4F', 'DRILL'],
      ].map(([day, color, label], i) => (
        <motion.g
          key={i}
          initial={{ opacity: 0, y: -18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1 + i * 0.2, duration: 0.5, ease: EASE }}
        >
          <rect
            x={68 + Number(day) * 56}
            y={246}
            width={40}
            height={20}
            rx={3}
            fill={String(color)}
            fillOpacity={0.14}
            stroke={String(color)}
            strokeOpacity={0.7}
            strokeWidth="1"
          />
          <text
            x={74 + Number(day) * 56}
            y={259}
            fill={String(color)}
            fontFamily="'Space Mono', monospace"
            fontSize="7"
            letterSpacing="1"
          >
            {String(label)}
          </text>
        </motion.g>
      ))}
      <MonoLabel x={64} y={340} delay={1.7}>
        SYNCED TO YOUR CALENDAR
      </MonoLabel>
    </g>
  )
}

const STEPS = [StepFilm, StepExtract, StepGravity, StepMeasure, StepCoach]

export default function PipelineVisual({ step }: { step: number }) {
  const Active = STEPS[step] ?? StepFilm
  return (
    <div className="relative aspect-square w-full max-w-[440px]">
      <div className="absolute inset-0 rounded-lg border border-hairline/60 bg-graphite-850" />
      {/* corner ticks */}
      {[
        'top-2 left-2 border-t border-l',
        'top-2 right-2 border-t border-r',
        'bottom-2 left-2 border-b border-l',
        'bottom-2 right-2 border-b border-r',
      ].map((pos) => (
        <div key={pos} className={`absolute h-3 w-3 border-bone-300/40 ${pos}`} />
      ))}
      <AnimatePresence mode="wait">
        <motion.svg
          key={step}
          viewBox="0 0 400 400"
          className="relative h-full w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          transition={{ duration: 0.35 }}
        >
          <Active />
        </motion.svg>
      </AnimatePresence>
      <div className="absolute right-4 bottom-3 font-mono text-[10px] tracking-[0.3em] text-muted">
        0{step + 1} / 05
      </div>
    </div>
  )
}

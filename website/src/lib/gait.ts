// Procedural sprint-gait kinematics for the hero skeleton.
//
// Sagittal-plane joint angles over one gait cycle, keyframed from sprint
// biomechanics references (initial contact -> stance -> toe-off -> heel
// recovery -> knee drive -> extension), interpolated with a periodic
// Catmull-Rom spline. Left leg runs the same cycle offset by half a phase.

export type Vec3 = [number, number, number]

export interface Pose {
  joints: Record<JointName, Vec3>
  /** Live readouts, degrees. */
  kneeR: number
  hipR: number
  cycle: number
}

export type JointName =
  | 'head'
  | 'neck'
  | 'chest'
  | 'pelvis'
  | 'hipL'
  | 'hipR'
  | 'kneeL'
  | 'kneeR'
  | 'ankleL'
  | 'ankleR'
  | 'toeL'
  | 'toeR'
  | 'shoulderL'
  | 'shoulderR'
  | 'elbowL'
  | 'elbowR'
  | 'wristL'
  | 'wristR'

export const BONES: [JointName, JointName][] = [
  ['head', 'neck'],
  ['neck', 'chest'],
  ['chest', 'pelvis'],
  ['pelvis', 'hipL'],
  ['pelvis', 'hipR'],
  ['hipL', 'kneeL'],
  ['hipR', 'kneeR'],
  ['kneeL', 'ankleL'],
  ['kneeR', 'ankleR'],
  ['ankleL', 'toeL'],
  ['ankleR', 'toeR'],
  ['neck', 'shoulderL'],
  ['neck', 'shoulderR'],
  ['shoulderL', 'elbowL'],
  ['shoulderR', 'elbowR'],
  ['elbowL', 'wristL'],
  ['elbowR', 'wristR'],
]

// Segment lengths (~1.8u tall athlete)
const THIGH = 0.46
const SHANK = 0.44
const FOOT = 0.15
const SPINE = 0.34
const CHEST_NECK = 0.13
const NECK_HEAD = 0.15
const HIP_W = 0.1
const SHOULDER_W = 0.19
const UPPER_ARM = 0.3
const FOREARM = 0.27

// Gait keyframes over cycle phase [0,1). Phase 0 = right foot initial contact.
// thigh: thigh angle from vertical, +forward. knee: flexion (0 = straight).
// foot: offset (deg) from perpendicular-to-shank; + = toes up (dorsiflexion).
const KEYS: { t: number; thigh: number; knee: number; foot: number }[] = [
  { t: 0.0, thigh: 27, knee: 25, foot: 10 }, // initial contact
  { t: 0.08, thigh: 12, knee: 42, foot: 6 }, // loading / mid-stance
  { t: 0.18, thigh: -8, knee: 32, foot: -2 }, // late stance
  { t: 0.27, thigh: -24, knee: 30, foot: -14 }, // toe-off
  { t: 0.38, thigh: -14, knee: 85, foot: -8 }, // early swing
  { t: 0.5, thigh: 12, knee: 122, foot: 0 }, // heel recovery
  { t: 0.64, thigh: 48, knee: 112, foot: 4 }, // swing-through
  { t: 0.74, thigh: 62, knee: 88, foot: 8 }, // peak knee drive
  { t: 0.86, thigh: 48, knee: 45, foot: 10 }, // extension toward ground
  { t: 0.95, thigh: 33, knee: 26, foot: 10 }, // pre-contact
]

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u
  const u3 = u2 * u
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  )
}

function sampleLeg(phase: number): { thigh: number; knee: number; foot: number } {
  const t = ((phase % 1) + 1) % 1
  const n = KEYS.length
  let i = n - 1
  for (let k = 0; k < n; k++) {
    const cur = KEYS[k]
    const next = KEYS[(k + 1) % n]
    const end = next.t <= cur.t ? next.t + 1 : next.t
    if (t >= cur.t && t < end) {
      i = k
      break
    }
  }
  const k0 = KEYS[(i - 1 + n) % n]
  const k1 = KEYS[i]
  const k2 = KEYS[(i + 1) % n]
  const k3 = KEYS[(i + 2) % n]
  const t1 = k1.t
  let t2 = k2.t
  if (t2 <= t1) t2 += 1
  const tt = t < t1 ? t + 1 : t
  const u = (tt - t1) / (t2 - t1)
  return {
    thigh: catmullRom(k0.thigh, k1.thigh, k2.thigh, k3.thigh, u),
    knee: catmullRom(k0.knee, k1.knee, k2.knee, k3.knee, u),
    foot: catmullRom(k0.foot, k1.foot, k2.foot, k3.foot, u),
  }
}

const D2R = Math.PI / 180

/** Rotate a 2D vector CCW (x right, y up). */
function rot(v: [number, number], a: number): [number, number] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]
}

/**
 * Compute the full skeleton for cycle phase `t` (0..1 = one full stride of the
 * right leg). Runner faces +x, y up, z lateral.
 */
export function computePose(t: number): Pose {
  const lean = 9 * D2R

  const phR = t
  const phL = t + 0.5

  const bounce = 0.035 * Math.cos(4 * Math.PI * (t - 0.1))
  const pelvisY = 0.98 + bounce
  const pelvisX = 0.02 * Math.sin(4 * Math.PI * t)
  const pelvisYaw = 8 * D2R * Math.sin(2 * Math.PI * t)
  const shoulderYaw = -10 * D2R * Math.sin(2 * Math.PI * t)

  const pelvis: Vec3 = [pelvisX, pelvisY, 0]
  const chest: Vec3 = [
    pelvis[0] + SPINE * Math.sin(lean),
    pelvis[1] + SPINE * Math.cos(lean),
    0,
  ]
  const neck: Vec3 = [
    chest[0] + CHEST_NECK * Math.sin(lean),
    chest[1] + CHEST_NECK * Math.cos(lean),
    0,
  ]
  const head: Vec3 = [
    neck[0] + NECK_HEAD * Math.sin(lean * 0.6),
    neck[1] + NECK_HEAD * Math.cos(lean * 0.6),
    0,
  ]

  const joints = { pelvis, chest, neck, head } as Record<JointName, Vec3>

  let kneeRAngle = 0
  let hipRAngle = 0
  const legs: { side: 'L' | 'R'; ph: number; zSign: number }[] = [
    { side: 'R', ph: phR, zSign: 1 },
    { side: 'L', ph: phL, zSign: -1 },
  ]
  for (const { side, ph, zSign } of legs) {
    const { thigh, knee, foot } = sampleLeg(ph)
    const hipZ = zSign * HIP_W
    const hip: Vec3 = [
      pelvis[0] + hipZ * Math.sin(pelvisYaw),
      pelvis[1] - 0.06,
      pelvis[2] + hipZ * Math.cos(pelvisYaw),
    ]
    const thighAng = thigh * D2R
    // Direction vectors in the sagittal (x-y) plane; straight down = (0,-1).
    const thighDir = rot([0, -1], thighAng) // + rotates forward (CCW brings -y toward +x)
    const knee3: Vec3 = [hip[0] + THIGH * thighDir[0], hip[1] + THIGH * thighDir[1], hip[2]]
    const shankAng = thighAng - knee * D2R
    const shankDir = rot([0, -1], shankAng)
    const ankle3: Vec3 = [
      knee3[0] + SHANK * shankDir[0],
      knee3[1] + SHANK * shankDir[1],
      knee3[2],
    ]
    // Foot roughly perpendicular to shank (toes lead the shank by ~90deg)
    const footDir = rot(shankDir, (90 + foot) * D2R)
    const toe3: Vec3 = [
      ankle3[0] + FOOT * footDir[0],
      ankle3[1] + FOOT * footDir[1],
      ankle3[2],
    ]
    joints[`hip${side}` as JointName] = hip
    joints[`knee${side}` as JointName] = knee3
    joints[`ankle${side}` as JointName] = ankle3
    joints[`toe${side}` as JointName] = toe3
    if (side === 'R') {
      kneeRAngle = 180 - knee
      hipRAngle = thigh
    }
  }

  const arms: { side: 'L' | 'R'; ph: number; zSign: number }[] = [
    { side: 'R', ph: phL, zSign: 1 }, // arms counter-phase to same-side leg
    { side: 'L', ph: phR, zSign: -1 },
  ]
  for (const { side, ph, zSign } of arms) {
    const swing = 40 * D2R * Math.sin(2 * Math.PI * (ph + 0.03))
    const shoulderZ = zSign * SHOULDER_W
    const shoulder: Vec3 = [
      neck[0] + shoulderZ * Math.sin(shoulderYaw),
      neck[1] - 0.05,
      neck[2] + shoulderZ * Math.cos(shoulderYaw),
    ]
    const upperAng = lean + swing
    const upperDir = rot([0, -1], upperAng)
    const elbow: Vec3 = [
      shoulder[0] + UPPER_ARM * upperDir[0],
      shoulder[1] + UPPER_ARM * upperDir[1],
      shoulder[2] + zSign * 0.02,
    ]
    // Included elbow angle: ~80deg as the hand drives up front (hand at chin),
    // opens toward ~125deg at the bottom of the backswing.
    const included = (102 - 22 * Math.sin(2 * Math.PI * (ph + 0.03))) * D2R
    const foreDir = rot(upperDir, Math.PI - included)
    const wrist: Vec3 = [
      elbow[0] + FOREARM * foreDir[0],
      elbow[1] + FOREARM * foreDir[1],
      elbow[2] + zSign * 0.02,
    ]
    joints[`shoulder${side}` as JointName] = shoulder
    joints[`elbow${side}` as JointName] = elbow
    joints[`wrist${side}` as JointName] = wrist
  }

  return { joints, kneeR: kneeRAngle, hipR: hipRAngle, cycle: t % 1 }
}

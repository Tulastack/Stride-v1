// Procedural sprint kinematics.
//
// A parametric forward-kinematics body (computeFromParams) driven by two
// generators:
//   - gaitParams(t): cyclic sprint gait, keyframed from sprint biomechanics
//     references and interpolated with a periodic Catmull-Rom spline.
//   - startParams(time): a block start — set position, slow-motion drive
//     phase, then acceleration blending into the gait cycle.

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

const D2R = Math.PI / 180

export interface LegParams {
  /** Thigh angle from vertical, degrees, +forward. */
  thigh: number
  /** Knee flexion, degrees, 0 = straight. */
  knee: number
  /** Foot offset from perpendicular-to-shank, degrees, + = toes up. */
  foot: number
}

export interface ArmParams {
  /** Upper-arm swing from vertical (before lean is added), degrees, +forward. */
  swing: number
  /** Included elbow angle, degrees, 180 = straight. */
  included: number
}

export interface BodyParams {
  /** Pelvis position in the sagittal plane. */
  pelvisX: number
  pelvisY: number
  /** Torso lean from vertical, degrees, +forward. */
  lean: number
  pelvisYaw: number
  shoulderYaw: number
  /** Extra head pitch, degrees (0 = looking ahead, + = looking down). */
  headDrop: number
  legR: LegParams
  legL: LegParams
  armR: ArmParams
  armL: ArmParams
}

/** Rotate a 2D vector CCW (x right, y up). */
function rot(v: [number, number], a: number): [number, number] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]
}

export function computeFromParams(p: BodyParams): Pose {
  const lean = p.lean * D2R
  const pelvis: Vec3 = [p.pelvisX, p.pelvisY, 0]
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
  const headAng = lean * 0.6 + p.headDrop * D2R
  const head: Vec3 = [
    neck[0] + NECK_HEAD * Math.sin(headAng),
    neck[1] + NECK_HEAD * Math.cos(headAng),
    0,
  ]

  const joints = { pelvis, chest, neck, head } as Record<JointName, Vec3>

  const pelvisYaw = p.pelvisYaw * D2R
  const shoulderYaw = p.shoulderYaw * D2R

  const legs: { side: 'L' | 'R'; lp: LegParams; zSign: number }[] = [
    { side: 'R', lp: p.legR, zSign: 1 },
    { side: 'L', lp: p.legL, zSign: -1 },
  ]
  for (const { side, lp, zSign } of legs) {
    const hipZ = zSign * HIP_W
    const hip: Vec3 = [
      pelvis[0] + hipZ * Math.sin(pelvisYaw),
      pelvis[1] - 0.06,
      pelvis[2] + hipZ * Math.cos(pelvisYaw),
    ]
    const thighAng = lp.thigh * D2R
    const thighDir = rot([0, -1], thighAng)
    const knee3: Vec3 = [hip[0] + THIGH * thighDir[0], hip[1] + THIGH * thighDir[1], hip[2]]
    const shankAng = thighAng - lp.knee * D2R
    const shankDir = rot([0, -1], shankAng)
    const ankle3: Vec3 = [
      knee3[0] + SHANK * shankDir[0],
      knee3[1] + SHANK * shankDir[1],
      knee3[2],
    ]
    const footDir = rot(shankDir, (90 + lp.foot) * D2R)
    const toe3: Vec3 = [
      ankle3[0] + FOOT * footDir[0],
      ankle3[1] + FOOT * footDir[1],
      ankle3[2],
    ]
    joints[`hip${side}` as JointName] = hip
    joints[`knee${side}` as JointName] = knee3
    joints[`ankle${side}` as JointName] = ankle3
    joints[`toe${side}` as JointName] = toe3
  }

  const arms: { side: 'L' | 'R'; ap: ArmParams; zSign: number }[] = [
    { side: 'R', ap: p.armR, zSign: 1 },
    { side: 'L', ap: p.armL, zSign: -1 },
  ]
  for (const { side, ap, zSign } of arms) {
    const shoulderZ = zSign * SHOULDER_W
    const shoulder: Vec3 = [
      neck[0] + shoulderZ * Math.sin(shoulderYaw),
      neck[1] - 0.05,
      neck[2] + shoulderZ * Math.cos(shoulderYaw),
    ]
    const upperAng = lean + ap.swing * D2R
    const upperDir = rot([0, -1], upperAng)
    const elbow: Vec3 = [
      shoulder[0] + UPPER_ARM * upperDir[0],
      shoulder[1] + UPPER_ARM * upperDir[1],
      shoulder[2] + zSign * 0.02,
    ]
    const foreDir = rot(upperDir, Math.PI - ap.included * D2R)
    const wrist: Vec3 = [
      elbow[0] + FOREARM * foreDir[0],
      elbow[1] + FOREARM * foreDir[1],
      elbow[2] + zSign * 0.02,
    ]
    joints[`shoulder${side}` as JointName] = shoulder
    joints[`elbow${side}` as JointName] = elbow
    joints[`wrist${side}` as JointName] = wrist
  }

  return {
    joints,
    kneeR: 180 - p.legR.knee,
    hipR: p.legR.thigh,
    cycle: 0,
  }
}

// ─── Cyclic sprint gait ──────────────────────────────────────────────

// Phase 0 = right foot initial contact.
const KEYS: { t: number; thigh: number; knee: number; foot: number }[] = [
  { t: 0.0, thigh: 27, knee: 25, foot: 10 },
  { t: 0.08, thigh: 12, knee: 42, foot: 6 },
  { t: 0.18, thigh: -8, knee: 32, foot: -2 },
  { t: 0.27, thigh: -24, knee: 30, foot: -14 },
  { t: 0.38, thigh: -14, knee: 85, foot: -8 },
  { t: 0.5, thigh: 12, knee: 122, foot: 0 },
  { t: 0.64, thigh: 48, knee: 112, foot: 4 },
  { t: 0.74, thigh: 62, knee: 88, foot: 8 },
  { t: 0.86, thigh: 48, knee: 45, foot: 10 },
  { t: 0.95, thigh: 33, knee: 26, foot: 10 },
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

function sampleLeg(phase: number): LegParams {
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

function armAt(ph: number): ArmParams {
  return {
    swing: 40 * Math.sin(2 * Math.PI * (ph + 0.03)),
    included: 102 - 22 * Math.sin(2 * Math.PI * (ph + 0.03)),
  }
}

export function gaitParams(t: number, lean = 9): BodyParams {
  const phR = t
  const phL = t + 0.5
  return {
    pelvisX: 0.02 * Math.sin(4 * Math.PI * t),
    pelvisY: 0.98 + 0.035 * Math.cos(4 * Math.PI * (t - 0.1)),
    lean,
    pelvisYaw: 8 * Math.sin(2 * Math.PI * t),
    shoulderYaw: -10 * Math.sin(2 * Math.PI * t),
    headDrop: 0,
    legR: sampleLeg(phR),
    legL: sampleLeg(phL),
    armR: armAt(phL), // arms counter-phase to same-side leg
    armL: armAt(phR),
  }
}

export function computePose(t: number): Pose {
  const pose = computeFromParams(gaitParams(t))
  pose.cycle = ((t % 1) + 1) % 1
  return pose
}

// ─── Block start sequence ────────────────────────────────────────────

/**
 * "Set" position, matched to real side-view footage: hips raised ABOVE the
 * shoulders (torso pitched past horizontal, lean > 90°), shoulders stacked
 * over the hands with the arms straight down to the line, front knee ~90° on
 * the front pedal, rear leg longer back to the rear pedal, eyes down.
 */
const SET_POSE: BodyParams = {
  pelvisX: -0.16,
  pelvisY: 0.74,
  lean: 102,
  pelvisYaw: 0,
  shoulderYaw: 0,
  headDrop: 18,
  legL: { thigh: 38, knee: 108, foot: 25 }, // front pedal, ~90° knee
  legR: { thigh: -19, knee: 33, foot: 30 }, // rear pedal, nearly extended
  armR: { swing: -97, included: 178 }, // straight down, hands at the line
  armL: { swing: -97, included: 178 },
}

/**
 * End of the drive: full triple extension off the front pedal — push leg one
 * straight line hip to toe, rear knee punched through, arms ripped apart.
 */
const DRIVE_POSE: BodyParams = {
  pelvisX: 0.34,
  pelvisY: 0.84,
  lean: 46,
  pelvisYaw: 6,
  shoulderYaw: -8,
  headDrop: 16,
  legL: { thigh: -32, knee: 8, foot: -24 }, // extended push leg
  legR: { thigh: 64, knee: 94, foot: 4 }, // driving knee
  armR: { swing: -54, included: 134 }, // arms split
  armL: { swing: 50, included: 78 },
}

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * u
}
function lerpLeg(a: LegParams, b: LegParams, u: number): LegParams {
  return {
    thigh: lerp(a.thigh, b.thigh, u),
    knee: lerp(a.knee, b.knee, u),
    foot: lerp(a.foot, b.foot, u),
  }
}
function lerpArm(a: ArmParams, b: ArmParams, u: number): ArmParams {
  return {
    swing: lerp(a.swing, b.swing, u),
    included: lerp(a.included, b.included, u),
  }
}
function lerpBody(a: BodyParams, b: BodyParams, u: number): BodyParams {
  return {
    pelvisX: lerp(a.pelvisX, b.pelvisX, u),
    pelvisY: lerp(a.pelvisY, b.pelvisY, u),
    lean: lerp(a.lean, b.lean, u),
    pelvisYaw: lerp(a.pelvisYaw, b.pelvisYaw, u),
    shoulderYaw: lerp(a.shoulderYaw, b.shoulderYaw, u),
    headDrop: lerp(a.headDrop, b.headDrop, u),
    legR: lerpLeg(a.legR, b.legR, u),
    legL: lerpLeg(a.legL, b.legL, u),
    armR: lerpArm(a.armR, b.armR, u),
    armL: lerpArm(a.armL, b.armL, u),
  }
}
function easeInOut(u: number) {
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
}

export const START_LOOP = 4.6 // seconds
const DRIVE_AT = 1.4 // gun goes off
const DRIVE_LEN = 0.45 // real block clearance is ~0.35-0.45s
const RUN_AT = DRIVE_AT + DRIVE_LEN

export interface StartFrame {
  pose: Pose
  /** Forward travel of the athlete, world units. */
  travel: number
  /** Overall figure opacity 0..1 (fade at loop edges). */
  fade: number
}

/**
 * Block start on a repeating loop, timed like the real thing:
 * 0.0-1.4s    set position, held (breathing micro-sway)
 * 1.4-1.85s   the drive — one explosive triple extension off the front pedal
 * 1.85s+      acceleration strides: quick turnover, lean rising 46° -> 12°
 * last 0.6s   fade, loop restarts in the blocks
 */
export function startFrame(time: number): StartFrame {
  const t = ((time % START_LOOP) + START_LOOP) % START_LOOP

  let params: BodyParams
  let travel = 0

  if (t < DRIVE_AT) {
    // SET — breathing micro-sway
    const sway = Math.sin(t * 2.4) * 0.007
    params = { ...SET_POSE, pelvisY: SET_POSE.pelvisY + sway }
  } else if (t < RUN_AT) {
    // DRIVE — explosive, ease-out (fastest at the gun)
    const u = (t - DRIVE_AT) / DRIVE_LEN
    const e = 1 - (1 - u) * (1 - u)
    params = lerpBody(SET_POSE, DRIVE_POSE, e)
    travel = e * 0.5
  } else {
    // ACCELERATE — blend into the gait cycle over one drive-step,
    // turnover ramping from ~1.9 to ~2.4 strides/s
    const tt = t - RUN_AT
    const blend = Math.min(tt / 0.35, 1)
    const runPhase = 0.72 + 1.9 * tt + 0.06 * tt * tt
    const lean = lerp(46, 12, Math.min(tt / 2.2, 1))
    const run = gaitParams(runPhase, lean)
    params = blend < 1 ? lerpBody(DRIVE_POSE, run, easeInOut(blend)) : run
    travel = 0.5 + 1.5 * tt + 0.25 * tt * tt
  }

  const fadeIn = t < 0.25 ? t / 0.25 : 1
  const fadeOut = t > START_LOOP - 0.3 ? Math.max(0, (START_LOOP - t) / 0.3) : 1

  return {
    pose: computeFromParams(params),
    travel,
    fade: Math.min(fadeIn, fadeOut),
  }
}

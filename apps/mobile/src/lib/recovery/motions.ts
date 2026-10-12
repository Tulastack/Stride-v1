/** Authored exercise rigs: reusable demonstration geometry, never athlete data
 * or a treatment prescription. Bone lengths remain fixed across each cycle. */
export type Vec3 = [number,number,number];
export type Exercise = 'heel_raise' | 'ankle_pump' | 'bridge';
export const EXERCISES: {key: Exercise; name: string; cue: string}[] = [
  { key: 'heel_raise', name: 'Heel raise', cue: 'Rise slowly onto the balls of your feet; lower with control.' },
  { key: 'ankle_pump', name: 'Ankle pumps', cue: 'Keep the leg supported; gently point the foot and draw the toes back.' },
  { key: 'bridge', name: 'Glute bridge', cue: 'Feet planted, knees bent. Lift and lower the hips without arching the back.' },
];
export const EDGES: [string,string][] = [['hip','chest'],['chest','neck'],['neck','head'], ...['L','R'].flatMap(s => [[`shoulder${s}`,`elbow${s}`],[`elbow${s}`,`hand${s}`],[`hip${s}`,`knee${s}`],[`knee${s}`,`ankle${s}`],[`ankle${s}`,`toe${s}`]] as [string,string][])];
export function exerciseFor(name: string): Exercise | null {
  const n=name.toLowerCase();
  if (/ankle.?pump/.test(n)) return 'ankle_pump';
  if (/glute.?bridge|bridging|^bridge$/.test(n)) return 'bridge';
  if (/heel.?raise|calf.?raise/.test(n)) return 'heel_raise';
  return null;
}
const add=(a:Vec3,b:Vec3):Vec3=>a.map((v,i)=>v+b[i]) as Vec3;
export function recoveryPose(exercise: Exercise, phase: number): Record<string,Vec3> {
  const p:Record<string,Vec3>={};
  const t=(1-Math.cos(phase*2*Math.PI))/2;
  if(exercise==='heel_raise') {
    const lift=t*.14;
    p.hip=[0,1.0+lift,0]; p.chest=[0,1.55+lift,0];p.neck=[0,1.7+lift,0];p.head=[0,1.85+lift,0];
    for(const [s,z] of [['L',-.14],['R',.14]] as const) {
      p[`hip${s}`]=[0,1+lift,z];p[`knee${s}`]=[0,.55+lift,z];p[`ankle${s}`]=[0,.1+lift,z];
      const a=Math.asin(lift/.23);p[`toe${s}`]=[Math.cos(a)*.23,.1+lift-Math.sin(a)*.23,z];
      p[`shoulder${s}`]=[0,1.55+lift,z*1.4];p[`elbow${s}`]=[0,1.26+lift,z*1.5];p[`hand${s}`]=[0,.97+lift,z*1.5];
    }
  } else {
    const bridge=exercise==='bridge';const theta=bridge?t*.38:0;
    p.chest=[-.4,.22,0];p.hip=add(p.chest,[Math.cos(theta)*.55,Math.sin(theta)*.55,0]);p.neck=[-.52,.23,0];p.head=[-.68,.23,0];
    for(const [s,z] of [['L',-.14],['R',.14]] as const) {
      p[`hip${s}`]=[p.hip[0],p.hip[1],z];
      if(bridge) {
        // Two-bone inverse kinematics from hip to the fixed planted ankle.
        const ankle:Vec3=[.85,.1,z],h=p[`hip${s}`];const dx=ankle[0]-h[0],dy=ankle[1]-h[1];const d=Math.hypot(dx,dy),mid:Vec3=[(h[0]+ankle[0])/2,(h[1]+ankle[1])/2,z];const height=Math.sqrt(Math.max(0,.45**2-(d/2)**2));
        p[`knee${s}`]=[mid[0]-dy/d*height,mid[1]+dx/d*height,z];p[`ankle${s}`]=ankle;p[`toe${s}`]=[1.08,.1,z];
      }else{p[`knee${s}`]=[p.hip[0]+.45,.22,z];p[`ankle${s}`]=[p.hip[0]+.9,.22,z];const a=-.4+t*.8;p[`toe${s}`]=add(p[`ankle${s}`],[Math.sin(a)*.23,Math.cos(a)*.23,0]);}
      p[`shoulder${s}`]=[-.4,.22,z*1.4];p[`elbow${s}`]=[-.1,.15,z*1.6];p[`hand${s}`]=[.2,.15,z*1.6];
    }
  }
  return p;
}

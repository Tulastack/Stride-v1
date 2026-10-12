import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import Svg, { Line, Circle, Ellipse } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { Button } from '../ui';
import { type as typo } from '../theme';
import { EDGES, EXERCISES, recoveryPose, type Exercise } from '../lib/recovery/motions';

export function RecoveryExerciseDemo({ exercise }: { exercise: Exercise }) {
  const { colors, reduceMotion } = useTheme();
  const [phase,setPhase]=useState(0),[playing,setPlaying]=useState(false),[front,setFront]=useState(false);
  const meta=EXERCISES.find(e=>e.key===exercise)!;
  useEffect(()=>{setPhase(0);setPlaying(false);},[exercise]);
  useEffect(()=>{if(!playing||reduceMotion)return; const start=Date.now()-phase*4000;const timer=setInterval(()=>setPhase(((Date.now()-start)%4000)/4000),40);return()=>clearInterval(timer);},[playing,reduceMotion,exercise]);
  const pose=recoveryPose(exercise,phase),yaw=(front?80:25)*Math.PI/180;
  const points=Object.fromEntries(Object.entries(pose).map(([k,[x,y,z]])=>[k,{x:170+(x*Math.cos(yaw)+z*Math.sin(yaw))*130,y:255-y*115,depth:-x*Math.sin(yaw)+z*Math.cos(yaw)}]));
  return <View testID={`recovery-demo-${exercise}`} style={{gap:12,paddingVertical:12}}>
    <Text style={[typo.bodyMedium,{color:colors.text}]}>{meta.name} · movement demo</Text>
    <Svg viewBox="0 0 360 280" width="100%" height={280} accessibilityLabel={`${meta.name} demonstration`}>
      <Ellipse cx="180" cy="260" rx="145" ry="8" fill={colors.border} opacity={.35}/>
      {EDGES.filter(([a,b])=>points[a]&&points[b]).sort(([a,b],[c,d])=>(points[b].depth+points[a].depth)-(points[c].depth+points[d].depth)).map(([a,b])=><Line key={a+b} x1={points[a].x} y1={points[a].y} x2={points[b].x} y2={points[b].y} stroke={colors.goldInk} strokeWidth={a==='hip'?23:10} strokeLinecap="round" opacity={points[a].depth>0?.55:1}/>)}
      <Circle cx={points.head.x} cy={points.head.y} r="15" fill={colors.goldInk}/>
    </Svg>
    <Text style={[typo.caption,{color:colors.muted}]}>{meta.cue}</Text>
    <View style={{flexDirection:'row',gap:8}}><Button label={playing?'Pause demo':'Play demo'} variant="secondary" disabled={reduceMotion} onPress={()=>setPlaying(!playing)}/><Button label={front?'Side view':'Front view'} variant="quiet" onPress={()=>setFront(!front)}/><Button label="Next position" variant="quiet" onPress={()=>{setPlaying(false);setPhase((phase+.25)%1);}}/></View>
    <Text style={[typo.tiny,{color:colors.muted}]}>Illustrated technique reference. Use the exercise and range of motion your clinician or coach assigned.</Text>
  </View>;
}

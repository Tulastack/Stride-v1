import { recoveryPose, exerciseFor } from '../lib/recovery/motions';
import { recoverAngleSeries } from '../lib/poseInstrument';
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
test('bridge uses fixed length leg bones and planted feet through the cycle',()=>{
  for(let i=0;i<40;i++){
    const p=recoveryPose('bridge',i/40);
    expect(distance(p.hipL,p.kneeL)).toBeCloseTo(.45,5);
    expect(distance(p.kneeL,p.ankleL)).toBeCloseTo(.45,5);
    expect(p.ankleL).toEqual([.85,.1,-.14]);
  }
});
test('unknown exercises never receive an unrelated demo',()=>{
  expect(exerciseFor('Glute bridges')).toBe('bridge');
  expect(exerciseFor('Ankle pumps')).toBe('ankle_pump');
  expect(exerciseFor('Unknown treatment')).toBeNull();
});
test('short recovered gaps are marked and never extrapolated across long losses',()=>{
  const result=recoverAngleSeries([{time:0,value:90},{time:100,value:null},{time:200,value:110},{time:600,value:null},{time:1000,value:130}]);
  expect(result[1]).toEqual({time:100,value:100,recovered:true});
  expect(result[3].value).toBeNull();
});

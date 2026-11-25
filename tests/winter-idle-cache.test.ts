import{it,expect}from'vitest';
import{prepareIdlePose,idleDisplacement}from'../src/presentation/pixi/idleBreathing';
for(const id of ['mage','summoner','shapeshifter','orc_warrior','missing'])it(`prepared idle is equivalent for ${id}`,()=>{
 const base=new Float32Array(Array.from({length:66},(_,i)=>i%2?(i*17)%300:(i*31)%200)),sample=prepareIdlePose(id,base,200,300);
 for(const phase of [0,.13,1,2.5,Math.PI,6.1,100]){const actual=sample(phase,true);for(let i=0;i<base.length;i+=2){const old=idleDisplacement(id,base[i]!/200,base[i+1]!/300,phase);expect(actual[i]).toBeCloseTo(old.x,12);expect(actual[i+1]).toBeCloseTo(old.y,12);}}
 expect([...sample(1,false)].every(v=>v===0)).toBe(true);
});

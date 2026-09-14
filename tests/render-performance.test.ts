import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveRenderBudget, budgetDpr, graphicsBudget, RenderFrameHistory, ShadowRevision, GpuFrameTimer, type FrameSample } from '../src/render/performance';

function run(budget:AdaptiveRenderBudget,seconds:number,sample:FrameSample) {
  let changes=0;
  for(let i=0;i<Math.ceil(seconds*1000/sample.frameMs);i++)if(budget.observe(sample))changes++;
  return changes;
}

test('Auto starts with bounded native resolution and mobile uses a smaller direct-render budget',()=>{
  const desktop=new AdaptiveRenderBudget(),mobile=new AdaptiveRenderBudget(true);
  assert.equal(desktop.targetMs,1000/120);assert.equal(mobile.targetMs,1000/60);
  assert.equal(desktop.budget.tier,'balanced');assert.equal(desktop.budget.bloom,false);
  assert.equal(mobile.budget.shadowLights,1);assert.equal(mobile.budget.bloom,false);
  assert.equal(budgetDpr(desktop.budget,1920,1080,1),1,'a 1× display must never be forced to 1.5×');
  assert.equal(budgetDpr(mobile.budget,390,844,3),1,'phone density does not allocate a 3× framebuffer');
  for(const quality of ['auto','high','ultra','performance'] as const)for(const [w,h]of [[1920,1080],[3840,2160],[600,2400],[15000,12000]]){
    const budget=graphicsBudget(quality),dpr=budgetDpr(budget,w,h,3,8192,4096);
    assert.ok(w*h*dpr*dpr<=budget.pixels+1);assert.ok(w*dpr<=8192+.001&&h*dpr<=4096+.001);
  }
});

test('sustained overload removes extra shadow passes before reducing resolution, and cannot oscillate per frame',()=>{
  const budget=new AdaptiveRenderBudget(),initial=budget.budget;
  const slow={frameMs:1000/120,cpuMs:12,gpuMs:14};
  assert.equal(run(budget,2,slow),0,'startup warmup is excluded');
  assert.equal(run(budget,3.3,slow),1);
  assert.equal(budget.budget.tier,'fast');assert.equal(budget.budget.shadowLights,1);
  assert.equal(budget.budget.maxDpr,initial.maxDpr);assert.equal(budget.budget.pixels,initial.pixels);
  assert.equal(run(budget,3,slow),0,'one downgrade is followed by a cooldown');
  run(budget,30,slow);assert.equal(budget.budget.tier,'minimum');
  assert.equal(run(budget,20,slow),0,'the floor is bounded');
});

test('refresh-limited 60 Hz with CPU headroom does not degrade to chase 120 FPS',()=>{
  const budget=new AdaptiveRenderBudget();
  assert.equal(run(budget,8,{frameMs:1000/60,cpuMs:2,gpuMs:null}),0);
  assert.equal(budget.budget.tier,'balanced');
  run(budget,20,{frameMs:1000/60,cpuMs:2,gpuMs:null});assert.equal(budget.budget.tier,'refined');
});

test('without GPU timers, stable 30 or 20 FPS is treated as overload rather than an upgrade opportunity',()=>{
  for(const fps of [30,20]){
    const budget=new AdaptiveRenderBudget();
    assert.ok(run(budget,7,{frameMs:1000/fps,cpuMs:2,gpuMs:null})>=1);
    assert.notEqual(budget.budget.tier,'balanced');assert.notEqual(budget.budget.tier,'refined');
  }
});

test('GPU pressure still downgrades when a CPU-only measurement looks inexpensive',()=>{
  const budget=new AdaptiveRenderBudget();
  run(budget,7,{frameMs:1000/60,cpuMs:1.4,gpuMs:15});
  assert.equal(budget.budget.tier,'fast');
});

test('Auto reserves GPU headroom instead of holding a measured 114 FPS workload just below its nominal deadline',()=>{
  const budget=new AdaptiveRenderBudget();
  assert.equal(run(budget,5.3,{frameMs:8.8,cpuMs:2.27,gpuMs:7.21}),1);
  assert.equal(budget.budget.tier,'fast');
  assert.equal(run(budget,30,{frameMs:1000/120,cpuMs:2,gpuMs:4.3}),0,'healthy but modest headroom must not immediately restore the expensive tier');
});

test('sustained misses after observed 120 Hz count as pressure, but an actual 60 Hz cadence does not',()=>{
  const fastDisplay=new AdaptiveRenderBudget();
  run(fastDisplay,4,{frameMs:1000/120,cpuMs:2,gpuMs:6.2});
  assert.equal(run(fastDisplay,2.3,{frameMs:8.9,cpuMs:2,gpuMs:6.2}),1);
  const normalDisplay=new AdaptiveRenderBudget();
  assert.equal(run(normalDisplay,30,{frameMs:1000/60,cpuMs:2,gpuMs:6.2}),0);
  assert.equal(normalDisplay.budget.tier,'balanced');
});

test('asset captures, tab wake and occasional long frames do not pump quality',()=>{
  const budget=new AdaptiveRenderBudget();
  run(budget,4,{frameMs:1000/120,cpuMs:6,gpuMs:6});
  budget.observe({frameMs:150,cpuMs:130,gpuMs:null,maintenance:true});
  assert.equal(run(budget,4,{frameMs:1000/120,cpuMs:6,gpuMs:6}),0);
  budget.observe({frameMs:10000,cpuMs:6,gpuMs:null});
  assert.equal(run(budget,1,{frameMs:1000/120,cpuMs:30,gpuMs:30}),0);
  assert.equal(budget.budget.tier,'balanced');
});

test('manual quality is stable, while returning to Auto restores the device starting budget',()=>{
  const budget=new AdaptiveRenderBudget();budget.setQuality('ultra');
  assert.equal(run(budget,30,{frameMs:40,cpuMs:30,gpuMs:35}),0);assert.equal(budget.budget.tier,'ultra');
  budget.setQuality('auto');assert.equal(budget.budget.tier,'balanced');
  const mobile=new AdaptiveRenderBudget(true);run(mobile,60,{frameMs:1000/120,cpuMs:1,gpuMs:1});
  assert.equal(mobile.budget.tier,'fast','mobile never upgrades into bloom or desktop pixel density');
});

test('frame statistics report actual cadence, p95 stalls and elapsed CPU/GPU separately',()=>{
  const history=new RenderFrameHistory();
  for(let i=0;i<100;i++)history.record({frameMs:i<10?25:8,cpuMs:2,gpuMs:i%4===0?5:null});
  const stats=history.snapshot();assert.ok(Math.abs(stats.fps-100000/970)<1e-9);
  assert.equal(stats.p95FrameMs,25);assert.equal(stats.cpuMs,2);assert.equal(stats.gpuMs,5);assert.ok(Object.isFrozen(stats));
  history.record({frameMs:10000,cpuMs:2,gpuMs:null});assert.equal(history.snapshot().samples,0);
  for(let i=0;i<600;i++)history.record({frameMs:10,cpuMs:3,gpuMs:null});
  assert.equal(history.snapshot().samples,300);assert.equal(history.snapshot().fps,100);assert.equal(history.snapshot().gpuMs,null);
});

test('shadow revision catches visibility, flight height, nested cue/coin transforms and removal',()=>{
  const revision=new ShadowRevision(),transforms=[1,1,0,.16,0,0,0,0,1,1,1,1];
  assert.equal(revision.changed(transforms),true);assert.equal(revision.changed([...transforms]),false);
  for(const [index,value]of [[3,.4],[1,0],[5,.15]]){transforms[index]=value;assert.equal(revision.changed(transforms),true);assert.equal(revision.changed(transforms),false);}
  assert.equal(revision.changed([...transforms,2,1,.3]),true);assert.equal(revision.changed(transforms),true);
  revision.invalidate();assert.equal(revision.changed(transforms),true);
});

test('GPU telemetry never reads an unfinished query and discards disjoint or maintenance results',()=>{
  let ready=false,disjoint=false,reads=0,ends=0,deletes=0;
  const extension={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2};
  const gl={
    QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4,getExtension:()=>extension,isContextLost:()=>false,
    getParameter:()=>disjoint,createQuery:()=>({}),beginQuery:()=>{},endQuery:()=>{ends++;},deleteQuery:()=>{deletes++;},
    getQueryParameter:(_query:unknown,parameter:number)=>{if(parameter===3)return ready;assert.ok(ready);reads++;return 4_500_000;},
  } as unknown as WebGL2RenderingContext;
  const timer=new GpuFrameTimer(gl);assert.equal(timer.supported,true);
  assert.equal(timer.begin(),null);timer.end();assert.equal(ends,1);
  assert.equal(timer.begin(),null);timer.end();assert.equal(reads,0);
  ready=true;assert.equal(timer.begin(),4.5);timer.end();assert.equal(reads,1);
  timer.begin();timer.end();timer.begin();timer.end(true);assert.equal(ends,2);assert.equal(reads,1);
  timer.begin();timer.end();timer.begin();timer.end();timer.begin();timer.end();timer.begin();timer.end();
  disjoint=true;assert.equal(timer.begin(),null);assert.equal(reads,1);assert.ok(deletes>=3);timer.dispose();
});

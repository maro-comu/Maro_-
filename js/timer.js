(function(){
  const Store = window.AppStore;
  let tickHandle = null;

  function format(seconds){
    seconds=Math.max(0,Math.floor(seconds||0));
    const h=Math.floor(seconds/3600), m=Math.floor(seconds%3600/60), s=seconds%60;
    return [h,m,s].map(v=>String(v).padStart(2,"0")).join(":");
  }

  function addElapsedSinceVisible(){
    const t=Store.state.timer;
    if(!t.active || !t.visibleStartedAt) return;
    const now=Date.now();
    const delta=Math.max(0,Math.floor((now-t.visibleStartedAt)/1000));
    if(delta>0){
      const key=Store.todayKey();
      Store.state.dailyStudySeconds[key]=(Store.state.dailyStudySeconds[key]||0)+delta;
      t.sessionSeconds=(t.sessionSeconds||0)+delta;
      t.visibleStartedAt=now;
      Store.save();
    }
  }

  function updateUi(){
    addElapsedSinceVisible();
    const t=Store.state.timer;
    const today=Store.state.dailyStudySeconds[Store.todayKey()]||0;
    const header=document.getElementById("headerTodayTime"); if(header) header.textContent=format(today);
    const dot=document.getElementById("timerStatusDot"); if(dot) dot.classList.toggle("running",!!t.active);
    const practice=document.getElementById("practiceSessionTime");
    const csat=document.getElementById("csatSessionTime");
    if(practice) practice.textContent=t.active&&t.mode==="practice"?format(t.sessionSeconds):"00:00:00";
    if(csat) csat.textContent=t.active&&t.mode==="csat"?format(t.sessionSeconds):"00:00:00";
    if(window.Dashboard) window.Dashboard.updateSummaryOnly();
  }

  function start(mode,label){
    const t=Store.state.timer;
    if(t.active) return false;
    t.active=true; t.mode=mode; t.label=label||""; t.startedAt=Date.now(); t.sessionSeconds=0;
    t.visibleStartedAt=document.visibilityState==="visible"?Date.now():null;
    Store.save(); updateUi(); return true;
  }

  function stop(){
    addElapsedSinceVisible();
    const t=Store.state.timer;
    if(!t.active) return null;
    const result={mode:t.mode,label:t.label,seconds:t.sessionSeconds||0};
    Store.state.timer={active:false,mode:null,label:"",startedAt:null,visibleStartedAt:null,sessionSeconds:0};
    Store.save(); updateUi(); return result;
  }

  document.addEventListener("visibilitychange",()=>{
    const t=Store.state.timer;
    if(!t.active) return;
    if(document.visibilityState==="hidden"){
      addElapsedSinceVisible(); t.visibleStartedAt=null; Store.save();
    }else{ t.visibleStartedAt=Date.now(); Store.save(); }
  });

  window.addEventListener("beforeunload",()=>addElapsedSinceVisible());

  window.StudyTimer={
    start, stop, format,
    activeMode(){ return Store.state.timer.active?Store.state.timer.mode:null; },
    activeLabel(){ return Store.state.timer.label||""; },
    init(){
      // 예전 버전의 메인 타이머가 실행 중인 채 저장됐더라도 새 PDF 풀이 방식에서는
      // 다시 시작하지 않는다. 실제 공부시간은 시험 창이 보이고 선택된 동안만 기록한다.
      if(Store.state.timer.active){
        Store.state.timer={active:false,mode:null,label:"",startedAt:null,visibleStartedAt:null,sessionSeconds:0};
        Store.save();
      }
      if(!tickHandle) tickHandle=setInterval(updateUi,1000);
      updateUi();
    }
  };
})();

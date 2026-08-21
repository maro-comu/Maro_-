(function(){
  "use strict";

  const Store=window.AppStore;
  const Catalog=window.PdfCatalog;
  const STORAGE_PREFIX="studyAppCsatSession:";
  const ACTIVE_SESSION_KEY="studyAppCsatActiveSession";
  let activeExamWindow=null;

  const PRACTICE_RULES=Object.freeze({
    practiceBreakMinutes:10,
    sections:Object.freeze({
      korean:Object.freeze({durationMinutes:80}),
      math:Object.freeze({durationMinutes:100}),
      english:Object.freeze({durationMinutes:70,listeningQuestions:17,listeningWithinMinutes:25}),
      history:Object.freeze({durationMinutes:30}),
      inquiry1:Object.freeze({durationMinutes:30}),
      inquiry2:Object.freeze({durationMinutes:30}),
      secondForeign:Object.freeze({durationMinutes:40})
    })
  });

  function subjectName(item){ return typeof item==="string"?item:String(item?.subject||item?.name||""); }
  function subjectsFor(area){ return (Catalog?.listSubjects?.(area)||[]).map(subjectName).filter(Boolean); }
  function pairedPapers(area,subject){
    return (Catalog?.listPapers?.({area,subject})||[]).filter(paper=>Number(paper.year)>=2022&&paper.questionPath&&paper.answerPath&&Number(paper.questionCount)>0);
  }
  function encodeChoice(area,subject){ return `${area}\u0000${subject}`; }
  function decodeChoice(value){
    const [area,subject]=String(value||"").split("\u0000");
    return area&&subject?{area,subject}:null;
  }
  function selectedConfig(){
    const inquiry=[
      decodeChoice(document.getElementById("inquiryFirstSelect")?.value),
      decodeChoice(document.getElementById("inquirySecondSelect")?.value)
    ].filter(Boolean);
    return {
      includeKorean:Boolean(document.getElementById("includeKorean")?.checked),
      includeMath:Boolean(document.getElementById("includeMath")?.checked),
      includeEnglish:Boolean(document.getElementById("includeEnglish")?.checked),
      includeHistory:Boolean(document.getElementById("includeHistory")?.checked),
      korean:document.querySelector('input[name="korean-elective"]:checked')?.value||"화법과 작문",
      math:document.querySelector('input[name="math-elective"]:checked')?.value||"확률과 통계",
      inquiry,
      secondForeign:decodeChoice(document.getElementById("secondForeignSelect")?.value)
    };
  }

  function makeOption(value,label){
    const option=document.createElement("option");
    option.value=value;option.textContent=label;
    return option;
  }
  function renderInquiryChoices(){
    const first=document.getElementById("inquiryFirstSelect");
    const second=document.getElementById("inquirySecondSelect");
    if(!first||!second) return;
    const entries=[
      ...subjectsFor("사회탐구").map(subject=>({area:"사회탐구",subject})),
      ...subjectsFor("과학탐구").map(subject=>({area:"과학탐구",subject})),
      ...subjectsFor("직업탐구").map(subject=>({area:"직업탐구",subject}))
    ].filter(item=>pairedPapers(item.area,item.subject).length);
    [first,second].forEach(select=>{
      select.innerHTML="";
      select.appendChild(makeOption("","선택 안 함"));
      ["사회탐구","과학탐구","직업탐구"].forEach(area=>{
        const group=document.createElement("optgroup");group.label=area==="직업탐구"?"직업탐구 · 응시 자격 확인":area;
        entries.filter(entry=>entry.area===area).forEach(entry=>{
          const papers=pairedPapers(entry.area,entry.subject);
          const auto=papers.filter(paper=>paper.answerMode==="auto").length;
          group.appendChild(makeOption(encodeChoice(entry.area,entry.subject),`${entry.subject} · ${papers.length}회분${auto?` · 자동채점 ${auto}`:" · 정답지 제공"}`));
        });
        if(group.children.length) select.appendChild(group);
      });
    });
    const firstDefault=encodeChoice("사회탐구","생활과 윤리");
    const secondDefault=encodeChoice("사회탐구","사회·문화");
    if([...first.options].some(option=>option.value===firstDefault)) first.value=firstDefault;
    if([...second.options].some(option=>option.value===secondDefault)) second.value=secondDefault;
    syncInquiryOrder();
  }
  function renderSecondForeignChoices(){
    const select=document.getElementById("secondForeignSelect");
    if(!select) return;
    select.innerHTML="";select.appendChild(makeOption("","응시 안 함"));
    subjectsFor("제2외국어·한문").forEach(subject=>{
      const papers=pairedPapers("제2외국어·한문",subject);
      if(!papers.length) return;
      const auto=papers.filter(paper=>paper.answerMode==="auto").length;
      select.appendChild(makeOption(encodeChoice("제2외국어·한문",subject),`${subject} · ${papers.length}회분${auto?` · 자동채점 ${auto}`:" · 정답지 제공"}`));
    });
  }
  function syncInquiryOrder(changed){
    const first=document.getElementById("inquiryFirstSelect");
    const second=document.getElementById("inquirySecondSelect");
    if(!first||!second) return;
    if(first.value&&first.value===second.value){
      if(changed===first) second.value=""; else first.value="";
      window.AppUi?.toast?.("탐구 제1·제2선택은 서로 다른 과목이어야 합니다.");
    }
    [...first.options].forEach(option=>{ option.disabled=Boolean(option.value&&option.value===second.value); });
    [...second.options].forEach(option=>{ option.disabled=Boolean(option.value&&option.value===first.value); });
    const count=[first.value,second.value].filter(Boolean).length;
    const countNode=document.getElementById("inquirySelectedCount");
    if(countNode) countNode.textContent=`${count} / 2`;
    setButtons();
  }

  function sectionSpecs(config){
    const specs=[];
    if(config.includeKorean) specs.push({id:"korean",area:"국어",subject:config.korean,label:`국어 · ${config.korean}`,durationMinutes:80,required:false});
    if(config.includeMath) specs.push({id:"math",area:"수학",subject:config.math,label:`수학 · ${config.math}`,durationMinutes:100,required:false});
    if(config.includeEnglish){
      const subject=subjectsFor("영어").find(name=>pairedPapers("영어",name).length)||"영어";
      specs.push({id:"english",area:"영어",subject,label:"영어",durationMinutes:70,required:false,listeningQuestions:17,listeningWithinMinutes:25});
    }
    if(config.includeHistory){
      const historySubject=subjectsFor("한국사").find(name=>pairedPapers("한국사",name).length)||"한국사";
      specs.push({id:"history",area:"한국사",subject:historySubject,label:"한국사",durationMinutes:30,required:false});
    }
    if(config.inquiry.length===2){
      const first=config.inquiry[0],second=config.inquiry[1];
      specs.push({id:"inquiry1",area:first.area,subject:first.subject,label:`탐구 1 · ${first.subject}`,durationMinutes:30,required:false});
      specs.push({id:"inquiry2",area:second.area,subject:second.subject,label:`탐구 2 · ${second.subject}`,durationMinutes:30,required:false});
    }else if(config.inquiry.length===1){
      const only=config.inquiry[0];
      specs.push({id:"inquiry2",area:only.area,subject:only.subject,label:`탐구 · ${only.subject}`,durationMinutes:30,required:false,singleInquiry:true});
    }
    if(config.secondForeign){
      specs.push({id:"secondForeign",area:config.secondForeign.area,subject:config.secondForeign.subject,label:`제2외국어·한문 · ${config.secondForeign.subject}`,durationMinutes:40,required:false});
    }
    return specs;
  }

  function buildStages(config,sections){
    const selected=(sections||[]).filter(section=>section&&section.id);
    const stages=[];
    selected.forEach((section,index)=>{
      stages.push({id:`exam-${section.id}`,type:"exam",label:section.label||section.subject||"선택 과목",durationMinutes:Math.max(1,Number(section.durationMinutes)||1),sectionId:section.id});
      if(index<selected.length-1){
        stages.push({id:`break-after-${section.id}`,type:"break",label:"다음 과목 전 10분 휴식",durationMinutes:10});
      }
    });
    return stages.map((stage,index)=>({...stage,order:index+1}));
  }

  function eventSignature(paper){ return `${paper.examType||""}|${paper.year||""}|${paper.month??""}`; }
  function eventLabel(signature){
    const [type,year,month]=String(signature||"").split("|");
    return type==="수능"?`${year}학년도 수능`:`${year}년 ${month}월 모의고사`;
  }
  function randomItem(items){
    if(!items.length) return null;
    if(window.crypto?.getRandomValues){ const value=new Uint32Array(1);window.crypto.getRandomValues(value);return items[value[0]%items.length]; }
    return items[Math.floor(Math.random()*items.length)];
  }
  function selectionPapers(area,subject){
    const papers=pairedPapers(area,subject);
    const automatic=papers.filter(paper=>paper.answerMode==="auto"&&Object.keys(paper.answerKey||{}).length>0);
    return automatic.length?automatic:papers;
  }
  function commonSignatures(specs){
    const pools=specs.map(spec=>selectionPapers(spec.area,spec.subject));
    if(!pools.length||pools.some(pool=>!pool.length)) return [];
    let common=new Set(pools[0].map(eventSignature));
    pools.slice(1).forEach(pool=>{ const available=new Set(pool.map(eventSignature));common=new Set([...common].filter(signature=>available.has(signature))); });
    return [...common];
  }
  function pickPaper(pool,signature,lastId){
    let choices=signature?pool.filter(paper=>eventSignature(paper)===signature):pool.slice();
    if(lastId&&choices.length>1) choices=choices.filter(paper=>paper.id!==lastId);
    const odd=choices.filter(paper=>!paper.form||String(paper.form).includes("홀수"));
    return randomItem(odd.length?odd:choices);
  }
  function selectPapers(specs){
    const signatures=commonSignatures(specs);
    const lastSignature=sessionStorage.getItem("last_csat_session_signature");
    const signature=randomItem(signatures.length>1?signatures.filter(value=>value!==lastSignature):signatures);
    const sections=specs.map(spec=>{
      const pool=selectionPapers(spec.area,spec.subject);
      const lastKey=`last_csat_pdf_${spec.area}_${spec.subject}`;
      const paper=pickPaper(pool,signature,sessionStorage.getItem(lastKey));
      if(!paper) return null;
      sessionStorage.setItem(lastKey,paper.id);
      return {...spec,paperId:paper.id,paperTitle:paper.title,answerMode:paper.answerMode,questionCount:Number(paper.questionCount)||0,gradedQuestionCount:Number(paper.gradedQuestionCount)||Object.keys(paper.answerKey||{}).length,questionNumberStart:Number(paper.questionNumberStart)||1,answerKeyScope:paper.answerKeyScope||"none"};
    }).filter(Boolean);
    if(signature) sessionStorage.setItem("last_csat_session_signature",signature);
    return {sections,signature:signature||null,selectionMode:signature?"common-event":"per-subject"};
  }

  function scheduleGapLabel(stage){
    return `다음 과목 전 쉬는 시간 ${stage.durationMinutes}분`;
  }
  function renderSchedule(config,specs){
    const host=document.getElementById("csatSessionSchedule");
    if(!host) return;
    const stages=buildStages(config,specs);
    host.innerHTML="";
    if(!stages.length){
      host.innerHTML='<div class="empty-state">응시할 과목을 하나 이상 선택하면 연습 순서가 표시됩니다.</div>';
      const summary=document.getElementById("csatSessionSummary");
      if(summary) summary.textContent="선택 과목 없음";
      return;
    }
    let examOrder=0;
    stages.forEach(stage=>{
      if(stage.type!=="exam"){
        const gap=document.createElement("div");gap.className=`csat-gap ${stage.type}`;
        gap.textContent=scheduleGapLabel(stage);host.appendChild(gap);return;
      }
      const section=specs.find(item=>item.id===stage.sectionId);
      const pool=section?pairedPapers(section.area,section.subject):[];
      const auto=pool.filter(paper=>paper.answerMode==="auto").length;
      const card=document.createElement("article");card.className="csat-schedule-item";
      examOrder+=1;
      card.innerHTML=`<time>${examOrder}번째<small>선택 과목</small></time><span><b>${section?.label||stage.label}</b><small>${section?.area||""} · ${pool.length}회분 · ${auto?`자동채점 ${auto}회분 포함`:"답안 기록·정답지 제공"}</small></span><strong>${stage.durationMinutes}분</strong>`;
      host.appendChild(card);
    });
    const examMinutes=stages.filter(stage=>stage.type==="exam").reduce((sum,stage)=>sum+stage.durationMinutes,0);
    const intervalMinutes=stages.filter(stage=>stage.type!=="exam").reduce((sum,stage)=>sum+stage.durationMinutes,0);
    const summary=document.getElementById("csatSessionSummary");
    if(summary) summary.textContent=`${specs.length}개 과목 · 시험 ${examMinutes}분 · 10분 휴식 ${Math.max(0,specs.length-1)}회 (${intervalMinutes}분)`;
  }
  function setButtons(){
    if(!Catalog) return;
    const config=selectedConfig();
    const specs=sectionSpecs(config);
    const missing=specs.filter(spec=>!pairedPapers(spec.area,spec.subject).length);
    const noneSelected=specs.length===0;
    const button=document.getElementById("startCsatBtn");
    if(button) button.disabled=noneSelected||Boolean(missing.length);
    const title=document.getElementById("csatTimerTitle");
    const stages=buildStages(config,specs);
    const minutes=stages.filter(stage=>stage.type==="exam").reduce((sum,stage)=>sum+stage.durationMinutes,0);
    if(title) title.textContent=noneSelected?"응시할 과목을 하나 이상 선택하세요":missing.length?`${missing.map(item=>item.subject).join(", ")} PDF 없음`:`${specs.length}개 과목 · 순수 시험 ${minutes}분`;
    const manual=specs.filter(spec=>pairedPapers(spec.area,spec.subject).some(paper=>paper.answerMode!=="auto"));
    const help=document.getElementById("csatStartHelp");
    if(help) help.textContent=noneSelected?"체크하거나 고른 과목만 출제됩니다. 최소 한 과목을 선택해 주세요.":missing.length?"선택 과목의 문제·정답 PDF를 찾을 수 없어 시작할 수 없습니다.":manual.length?"선택 과목만 실제 제한시간으로 풀고, 과목 사이에는 10분씩 쉽니다. 미검증 문항은 답안을 저장하고 정답 PDF를 제공합니다.":"선택 과목만 실제 제한시간으로 풀고, 과목 사이에는 10분씩 쉰 뒤 자동 채점합니다.";
    const common=commonSignatures(specs);
    const notice=document.getElementById("csatRoundNotice");
    if(notice) notice.textContent=noneSelected?"과목을 선택하면 가능한 회차와 연습 순서를 계산합니다.":common.length?`선택한 모든 과목을 같은 회차로 구성할 수 있습니다. 공통 시험 회차 ${common.length}개 중 하나를 무작위로 엽니다.`:"선택 과목 전체에 공통인 회차가 없어 과목별로 회차를 무작위 선택합니다.";
    document.querySelectorAll('input[name="korean-elective"]').forEach(input=>{ input.disabled=!config.includeKorean;input.closest("label")?.classList.toggle("choice-disabled",!config.includeKorean); });
    document.querySelectorAll('input[name="math-elective"]').forEach(input=>{ input.disabled=!config.includeMath;input.closest("label")?.classList.toggle("choice-disabled",!config.includeMath); });
    renderSchedule(config,specs);
    refreshResumePanel();
  }

  function sessionId(){
    if(window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  }
  function activeStoredSessions(){
    const inactive=new Set(["completed","complete","finished","cancelled","canceled","expired"]);
    const sessions=[];
    const obsoleteKeys=[];
    for(let index=0;index<localStorage.length;index+=1){
      const key=localStorage.key(index);
      if(!key?.startsWith(STORAGE_PREFIX)) continue;
      try{
        const session=JSON.parse(localStorage.getItem(key)||"null");
        const sections=Array.isArray(session?.sections)?session.sections:[];
        const modern=sections.length>0&&sections.every(section=>{
          const linked=Catalog?.getPaper?.(section?.paperId);
          return linked&&Number(linked.year)>=2022;
        });
        if(!modern){ obsoleteKeys.push(key); continue; }
        if(session?.id&&!inactive.has(String(session.status||"ready"))) sessions.push(session);
      }catch(error){ /* 손상된 이전 세션은 복구 후보에서 제외 */ }
    }
    obsoleteKeys.forEach(key=>localStorage.removeItem(key));
    const preferred=localStorage.getItem(ACTIVE_SESSION_KEY);
    if(preferred&&!sessions.some(session=>String(session.id)===String(preferred))) localStorage.removeItem(ACTIVE_SESSION_KEY);
    return sessions.sort((a,b)=>{
      if(a.id===preferred) return -1;if(b.id===preferred) return 1;
      return String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||""));
    });
  }
  function activeStoredSession(){ return activeStoredSessions()[0]||null; }
  function refreshResumePanel(){
    const session=activeStoredSession();
    const panel=document.getElementById("csatResumePanel");
    const startButton=document.getElementById("startCsatBtn");
    if(panel) panel.classList.toggle("hidden",!session);
    if(startButton) startButton.textContent=session?"기존 종료 후 새 연습 시작":"선택 과목 연습 시작";
    if(!session) return;
    localStorage.setItem(ACTIVE_SESSION_KEY,session.id);
    const stage=session.stages?.[Number(session.currentStageIndex)||0];
    const title=document.getElementById("csatResumeTitle");
    const meta=document.getElementById("csatResumeMeta");
    if(title) title.textContent=stage?.label?`중단 위치 · ${stage.label}`:"중단한 수능 연습 세션이 있습니다";
    if(meta) meta.textContent=`${session.sections?.length||0}개 과목 · ${session.paperSelection?.label||"저장된 회차"} · 답안과 남은 시간이 보존됩니다.`;
  }
  function markActiveSessionsCancelled(){
    activeStoredSessions().forEach(session=>{
      const cancelled={...session,status:"cancelled",cancelledAt:new Date().toISOString()};
      localStorage.setItem(`${STORAGE_PREFIX}${session.id}`,JSON.stringify(cancelled));
    });
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }
  function sessionUrl(id){
    const url=new URL("exam.html",location.href);
    url.searchParams.set("mode","start");url.searchParams.set("context","csat-session");url.searchParams.set("session",id);
    if(new URLSearchParams(location.search).get("qa")==="1") url.searchParams.set("qa","1");
    return url;
  }
  function resumeExam(){
    const session=activeStoredSession();
    if(!session){ refreshResumePanel();window.AppUi.toast("이어서 풀 수능 연습 세션이 없습니다.");return; }
    localStorage.setItem(ACTIVE_SESSION_KEY,session.id);
    if(launch(sessionUrl(session.id).href,`csatSession_${session.id}`)) window.AppUi.toast("저장된 과목과 답안에서 이어서 시작합니다.");
  }
  function replaceActiveSession(){
    if(activeExamWindow&&!activeExamWindow.closed){ activeExamWindow.focus();window.AppUi.toast("열린 시험 창을 먼저 종료해 주세요.");return; }
    if(!window.confirm("진행 중인 수능 연습 세션을 종료하고 새 연습을 시작할까요? 저장된 진행 상황은 이어서 풀 수 없게 됩니다.")) return;
    markActiveSessionsCancelled();refreshResumePanel();openExam({activeConfirmed:true});
  }
  function createSessionPayload(){
    const config=selectedConfig();
    const specs=sectionSpecs(config);
    if(!specs.length) return null;
    if(specs.some(spec=>!pairedPapers(spec.area,spec.subject).length)) return null;
    const selected=selectPapers(specs);
    if(selected.sections.length!==specs.length) return null;
    const id=sessionId();
    const payload={
      version:2,id,createdAt:new Date().toISOString(),status:"ready",currentStageIndex:0,
      config,sections:selected.sections,stages:buildStages(config,selected.sections),
      paperSelection:{mode:selected.selectionMode,signature:selected.signature,label:selected.signature?eventLabel(selected.signature):"과목별 무작위 회차"}
    };
    if(new URLSearchParams(location.search).get("qa")==="1") payload.qaDurations={exam:3,break:2};
    return payload;
  }
  function launch(url,name){
    if(activeExamWindow&&!activeExamWindow.closed){ activeExamWindow.focus();window.AppUi.toast("이미 진행 중인 수능 연습 세션이 있습니다.");return null; }
    activeExamWindow=window.open(url,name,"popup=yes,width=1540,height=960,resizable=yes,scrollbars=yes");
    if(!activeExamWindow){ window.AppUi.toast("시험 창이 차단되었습니다. 팝업을 허용한 뒤 다시 눌러주세요.");return null; }
    activeExamWindow.focus();return activeExamWindow;
  }
  function openExam(options){
    const specs=sectionSpecs(selectedConfig());
    if(!specs.length){ window.AppUi.toast("응시할 과목을 하나 이상 선택해 주세요.");return; }
    if(activeExamWindow&&!activeExamWindow.closed){ activeExamWindow.focus();window.AppUi.toast("이미 진행 중인 수능 연습 세션이 있습니다.");return; }
    if(activeStoredSessions().length&&!options?.activeConfirmed){ replaceActiveSession();return; }
    const payload=createSessionPayload();
    if(!payload){ window.AppUi.toast("선택 과목의 문제·정답 PDF를 찾지 못했습니다.");return; }
    const storageKey=`${STORAGE_PREFIX}${payload.id}`;
    try{
      localStorage.setItem(storageKey,JSON.stringify(payload));
      localStorage.setItem(ACTIVE_SESSION_KEY,payload.id);
    }catch(error){ window.AppUi.toast("수능 세션을 저장할 공간이 부족합니다.");return; }
    const url=sessionUrl(payload.id);
    if(!launch(url.href,`csatSession_${payload.id}`)){ localStorage.removeItem(storageKey);localStorage.removeItem(ACTIVE_SESSION_KEY);refreshResumePanel();return; }
    const title=document.getElementById("csatTimerTitle");
    if(title) title.textContent="수능 연습 세션 진행 중";
    window.AppUi.toast(`${payload.sections.length}개 선택 과목 연습을 시작했습니다.`);
  }
  function openReview(id){
    const record=Store.state.csatResults.find(item=>String(item.id)===String(id));
    const fullSession=Boolean(record&&(record.sessionId||record.context==="csat-session"||Array.isArray(record.sections)||Array.isArray(record.sectionResults)));
    const url=new URL("exam.html",location.href);
    url.searchParams.set("mode","review");url.searchParams.set("context",fullSession?"csat-session":"csat");url.searchParams.set("id",String(id));
    activeExamWindow=null;launch(url.href,`csatReview_${id}`);
  }
  function syncFromExam(message){
    if(message.origin!==location.origin) return;
    const data=message?.data||{};
    if(data.type==="csat-session-progress"){
      const activeId=localStorage.getItem(ACTIVE_SESSION_KEY);
      const messageId=String(data.sessionId||data.id||"");
      if(!activeId||messageId!==activeId||(activeExamWindow&&!activeExamWindow.closed&&message.source!==activeExamWindow)) return;
      const title=document.getElementById("csatTimerTitle");
      if(title) title.textContent=data.label||"수능 연습 세션 진행 중";
      return;
    }
    const legacyFinished=data.type==="pdf-exam-finished"&&data.context==="csat";
    const sessionFinished=data.type==="csat-session-finished";
    if(!legacyFinished&&!sessionFinished) return;
    if(sessionFinished){
      const activeId=localStorage.getItem(ACTIVE_SESSION_KEY);
      const messageId=String(data.sessionId||data.id||"");
      if(!activeId||messageId!==activeId||(activeExamWindow&&!activeExamWindow.closed&&message.source!==activeExamWindow)) return;
    }else if(message.source!==activeExamWindow) return;
    Store.reload();window.Dashboard.render();
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    activeExamWindow=null;
    const title=document.getElementById("csatTimerTitle");
    if(title) title.textContent="선택 과목 연습 준비 완료";
    refreshResumePanel();
    window.AppUi.toast(sessionFinished?"수능 연습 세션 결과가 대시보드에 저장되었습니다.":"수능 연습 결과가 저장되었습니다.");
  }
  function init(){
    const button=document.getElementById("startCsatBtn");
    if(!Catalog){ if(button) button.disabled=true;return; }
    renderInquiryChoices();renderSecondForeignChoices();
    ["includeKorean","includeMath","includeEnglish","includeHistory","secondForeignSelect"].forEach(id=>document.getElementById(id)?.addEventListener("change",setButtons));
    document.querySelectorAll('input[name="korean-elective"],input[name="math-elective"]').forEach(input=>input.addEventListener("change",setButtons));
    const first=document.getElementById("inquiryFirstSelect"),second=document.getElementById("inquirySecondSelect");
    first?.addEventListener("change",()=>syncInquiryOrder(first));second?.addEventListener("change",()=>syncInquiryOrder(second));
    button?.addEventListener("click",()=>openExam());
    document.getElementById("resumeCsatBtn")?.addEventListener("click",resumeExam);
    document.getElementById("replaceCsatBtn")?.addEventListener("click",replaceActiveSession);
    window.addEventListener("message",syncFromExam);
    window.addEventListener("storage",()=>{ Store.reload();window.Dashboard.render();refreshResumePanel(); });
    setButtons();
  }

  window.CsatPractice=Object.freeze({init,openReview,setButtons,PRACTICE_RULES,buildStages,createSessionPayload,selectedConfig,activeStoredSessions});
})();

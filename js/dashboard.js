(function(){
  const Store=window.AppStore;

  function esc(v){
    return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
  }

  function fmtDuration(sec){
    const h=Math.floor((sec||0)/3600),m=Math.floor((sec||0)%3600/60);
    return h?`${h}시간 ${m}분`:`${m}분`;
  }

  function finiteNumber(value){
    if(value===null||value===undefined||value==="") return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  }

  function estimateGradeFromScore(value){
    const score=finiteNumber(value);
    if(score===null) return null;
    if(score>=90) return 1;
    if(score>=80) return 2;
    if(score>=70) return 3;
    if(score>=60) return 4;
    if(score>=50) return 5;
    if(score>=40) return 6;
    if(score>=30) return 7;
    if(score>=20) return 8;
    return 9;
  }

  function normalizedGrade(value){
    const grade=finiteNumber(value);
    return grade!==null&&Number.isInteger(grade)&&grade>=1&&grade<=9?grade:null;
  }

  function storedGrade(record){
    if(!record||typeof record!=="object") return null;
    const resultGrade=[record.resultGrade,record.result?.resultGrade]
      .map(normalizedGrade).find(grade=>grade!==null);
    if(resultGrade!==undefined) return {grade:resultGrade,label:"결과"};
    const estimatedGrade=[record.estimatedGrade,record.result?.estimatedGrade]
      .map(normalizedGrade).find(grade=>grade!==null);
    if(estimatedGrade!==undefined) return {grade:estimatedGrade,label:"예상"};
    const legacyGrade=[record.grade,record.result?.grade,record.averageGrade]
      .map(normalizedGrade).find(grade=>grade!==null);
    return legacyGrade===undefined?null:{grade:legacyGrade,label:"결과"};
  }

  function estimatedGradeLabel(value,record){
    const saved=storedGrade(record);
    if(saved) return `${saved.label} ${saved.grade}등급`;
    const grade=estimateGradeFromScore(value);
    return grade===null?"":`정답률 기준 예상 ${grade}등급`;
  }

  function estimatedGradeChip(value,record){
    const label=estimatedGradeLabel(value,record);
    return label?`<span class="chip grade-estimate-chip">${label}</span>`:"";
  }

  function countValue(value){
    const number=finiteNumber(value);
    return number===null?null:Math.max(0,Math.trunc(number));
  }

  function answerKeyCount(value){
    if(Array.isArray(value)) return value.filter(item=>item!==null&&item!==undefined&&String(item?.correct??item).trim()!=="").length;
    if(!value||typeof value!=="object") return 0;
    return Object.entries(value).filter(([key,answer])=>Number.isInteger(Number(key))&&Number(key)>0&&answer!==null&&answer!==undefined&&String(answer).trim()!=="").length;
  }

  function gradedCount(record){
    const explicit=[record?.result?.gradedCount,record?.gradedQuestionCount,record?.result?.gradedQuestionCount]
      .map(countValue).find(value=>value!==null);
    return explicit===undefined?answerKeyCount(record?.answerKey):explicit;
  }

  function presentedCount(record){
    const explicit=[record?.result?.presentedTotal,record?.presentedQuestionCount,record?.totalQuestions,record?.paperSnapshot?.questionCount]
      .map(countValue).find(value=>value!==null);
    return Math.max(gradedCount(record),explicit===undefined?0:explicit);
  }

  function allDates(){
    const keys=new Set(Object.keys(Store.state.dailyStudySeconds));
    Store.state.problemResults.forEach(r=>keys.add(r.date));
    Store.state.csatResults.forEach(r=>keys.add(r.date));
    if(!keys.size) keys.add(Store.todayKey());
    return [...keys].sort().reverse();
  }

  function annotationValueExists(value){
    if(value===true) return true;
    if(Array.isArray(value)) return value.length>0;
    if(value&&typeof value==="object"){
      if(value.pages&&typeof value.pages==="object"){
        return Object.values(value.pages).some(page=>Array.isArray(page)?page.length>0:annotationValueExists(page));
      }
      return Object.keys(value).length>0;
    }
    return typeof value==="string"&&value.trim().length>0;
  }

  function hasSavedAnnotations(record){
    if(!record||typeof record!=="object") return false;
    if(record.hasAnnotations===true||String(record.annotatedPdfKey||"").trim()||annotationValueExists(record.annotations)) return true;
    return Array.isArray(record.sessionSections)&&record.sessionSections.some(hasSavedAnnotations);
  }

  function isSkippedResult(record){
    if(!record||typeof record!=="object") return false;
    if(record.skipped===true||record.skippedSubject===true||record.subjectSkipped===true) return true;
    if(record.result?.skipped===true||record.result?.skippedSubject===true) return true;
    const status=String(record.result?.status??record.status??"").trim().toLowerCase();
    return ["skipped","skip","subject-skipped","skipped-subject","omitted"].includes(status);
  }

  function addQuestionNumbers(target,raw){
    if(Array.isArray(raw)){
      raw.forEach((value,index)=>{
        const explicit=finiteNumber(value?.number);
        const number=explicit!==null?explicit:index+1;
        if(Number.isInteger(number)&&number>0) target.add(number);
      });
      return;
    }
    if(!raw||typeof raw!=="object") return;
    Object.keys(raw).forEach(key=>{
      const number=Number(key);
      if(Number.isInteger(number)&&number>0) target.add(number);
    });
  }

  function answerAt(raw,number){
    if(Array.isArray(raw)) return raw[number-1];
    if(!raw||typeof raw!=="object") return "";
    if(Object.prototype.hasOwnProperty.call(raw,number)) return raw[number];
    if(Object.prototype.hasOwnProperty.call(raw,String(number))) return raw[String(number)];
    return "";
  }

  function skippedQuestionNumbers(record){
    const numbers=new Set();
    const values=[record?.skippedQuestions,record?.skippedQuestionNumbers,record?.result?.skippedQuestions,record?.result?.skippedQuestionNumbers];
    values.forEach(raw=>{
      if(Array.isArray(raw)){
        raw.forEach(value=>{
          const number=Number(value?.number??value);
          if(Number.isInteger(number)&&number>0) numbers.add(number);
        });
      }else if(raw&&typeof raw==="object"){
        Object.entries(raw).forEach(([key,value])=>{
          const number=Number(key);
          if(value&&Number.isInteger(number)&&number>0) numbers.add(number);
        });
      }
    });
    return numbers;
  }

  function sourceLabel(record){
    const snapshot=record?.paperSnapshot&&typeof record.paperSnapshot==="object"?record.paperSnapshot:{};
    const question=record?.questionSnapshot&&typeof record.questionSnapshot==="object"?record.questionSnapshot:{};
    const year=question.year??snapshot.year??record?.year;
    const month=question.month??snapshot.month??record?.month;
    const examType=String(question.examType??snapshot.examType??record?.examType??"");
    if(year===null||year===undefined||String(year).trim()==="") return "연도 미상";
    if(examType.includes("수능")) return `${year}학년도`;
    if(month!==null&&month!==undefined&&String(month).trim()!=="") return `${year}년 ${month}월`;
    return `${year}년`;
  }

  function questionGroup(record,label){
    if(!record||typeof record!=="object") return null;
    const numbers=new Set();
    const snapshotNumber=Number(record.questionSnapshot?.number);
    if(Number.isInteger(snapshotNumber)&&snapshotNumber>0) numbers.add(snapshotNumber);
    else{
      addQuestionNumbers(numbers,record.answerKey);
      addQuestionNumbers(numbers,record.answers);
    }
    if(!numbers.size){
      const total=Number(record.presentedQuestionCount??record.result?.presentedTotal??record.totalQuestions??record.paperSnapshot?.questionCount);
      const start=Number(record.questionNumberStart??record.paperSnapshot?.questionNumberStart)||1;
      if(Number.isInteger(total)&&total>0&&total<=200){
        for(let offset=0;offset<total;offset+=1) numbers.add(start+offset);
      }
    }
    if(!numbers.size) return null;
    return {
      label:label||record.label||record.subject||record.paperTitle||"문제",
      source:sourceLabel(record),
      answers:record.answers||{},
      numbers:[...numbers].sort((a,b)=>a-b),
      skippedQuestions:skippedQuestionNumbers(record),
      subjectSkipped:isSkippedResult(record)
    };
  }

  function questionProvenance(groups){
    const available=(groups||[]).filter(Boolean);
    const total=available.reduce((sum,group)=>sum+group.numbers.length,0);
    if(!total) return "";
    const markup=available.map(group=>`<section class="provenance-group">
      <h5>${esc(group.label)} <small>${esc(group.source)}</small>${group.subjectSkipped?'<em class="provenance-skip">과목 건너뜀</em>':""}</h5>
      <div class="provenance-list">${group.numbers.map(number=>{
        const answer=String(answerAt(group.answers,number)??"").trim();
        const skipped=group.subjectSkipped||(!answer&&group.skippedQuestions.has(number));
        const status=group.subjectSkipped?"과목 건너뜀":skipped?"문제 건너뜀":answer?`내 답 ${esc(answer)}`:"미응답";
        return `<span class="provenance-item${skipped?" skipped":""}${!answer&&!skipped?" unanswered":""}"><span>${esc(group.source)}</span><b>${number}번</b><em>${status}</em></span>`;
      }).join("")}</div>
    </section>`).join("");
    return `<details class="question-provenance"><summary><span>문항 출처 · ${total}문항</span><small>연도·문항 번호 보기</small></summary><div class="provenance-groups">${markup}</div></details>`;
  }

  function reviewButton(kind,id,title,label){
    if(id===null||id===undefined||id==="") return "";
    const attribute=kind==="practice"?"data-practice-review-id":"data-csat-review-id";
    return `<button class="record-review-action" type="button" ${attribute}="${esc(id)}" title="${esc(title)}">${esc(label)}</button>`;
  }

  function resultScore(record){
    return finiteNumber(record?.result?.score??record?.score);
  }

  function mergeSessionRecords(record){
    const subjects=Array.isArray(record?.subjects)?record.subjects:[];
    const rich=Array.isArray(record?.sessionSections)&&record.sessionSections.length
      ?record.sessionSections
      :Array.isArray(record?.sections)&&record.sections.length?record.sections:[];
    const sectionResults=Array.isArray(record?.sectionResults)?record.sectionResults:[];
    const papers=Array.isArray(record?.papers)?record.papers:[];
    const sources=rich.length?rich:subjects;
    return sources.map((section,index)=>{
      const sectionId=String(section?.sectionId??section?.id??"");
      const subject=subjects.find(item=>String(item?.sectionId??item?.id??"")===sectionId)||subjects[index]||{};
      const storedResult=sectionResults.find(item=>String(item?.sectionId??item?.id??"")===sectionId)||sectionResults[index]||{};
      const paperId=String(section?.paperId??subject?.paperId??"");
      const paper=section?.paperSnapshot||papers.find(item=>String(item?.id??item?.paperId??"")===paperId)||papers[index]||subject?.paperSnapshot||null;
      const topAnswers=record?.answers&&typeof record.answers==="object"?record.answers[sectionId]:null;
      const topKeys=record?.answerKey&&typeof record.answerKey==="object"?record.answerKey[sectionId]:null;
      return {
        ...subject,...section,
        sectionId:sectionId||String(index),
        paperSnapshot:paper,
        answers:section?.answers||subject?.answers||topAnswers||{},
        answerKey:section?.answerKey||subject?.answerKey||storedResult?.answerKey||topKeys||{},
        result:{...(subject?.result||{}),...storedResult,...(section?.result||{})}
      };
    });
  }

  function problemItem(r){
    const clickable=!!r.paperId;
    const score=finiteNumber(r.score);
    const graded=gradedCount(r),presented=presentedCount(r);
    const scoreLabel=clickable?(score===null?"정답률 기록 없음":`정답률 ${score.toFixed(0)}%`):`맞은 점수 ${esc(r.score??0)}점`;
    const solved=clickable&&presented?` · ${r.correctCount||0}/${presented}문항`:"";
    const provenance=questionProvenance([questionGroup(r,r.paperTitle||r.subject)]);
    return `<article class="record-item${clickable?" record-link":""}">
      <div class="record-top"><b>${esc(r.paperTitle||r.subject)}</b><em>${fmtDuration(r.seconds||0)}</em></div>
      <div class="record-meta">
        <span class="chip">${scoreLabel}${solved}</span>
        ${estimatedGradeChip(score,r)}
        ${clickable?`<span class="chip">자동채점 ${graded}/${presented}문항</span>`:""}
        <span class="chip">오답 ${r.wrong?.length||0}개</span>
        ${clickable?`<span class="chip">${esc(r.examType||"기출")} · ${esc(r.year||r.paperSnapshot?.year||"")}</span>`:""}
        ${hasSavedAnnotations(r)?'<span class="chip annotation-chip">필기 저장됨</span>':""}
        ${isSkippedResult(r)?'<span class="chip skipped-chip">결과 건너뜀</span>':""}
      </div>
      <div class="record-detail"><b>오답:</b> ${r.wrong?.length?esc(r.wrong.join(", ")):"없음"}\n<b>${clickable?"정답지":"오답 해설"}:</b> ${esc(r.explanation||"작성 안 함")}</div>
      ${provenance}
      ${clickable?reviewButton("practice",r.id,"이 PDF 기출 다시 보기","문제 PDF · 내 답 · 필기 다시 보기"):""}
    </article>`;
  }

  function csatItem(r){
    const isSession=r.sessionType==="full-csat-mock"||r.reviewType==="csat-session"||r.context==="csat-session"||Array.isArray(r.sessionSections);
    const isPdf=!!r.paperId;
    const clickable=isPdf||isSession;
    const subjects=isSession?mergeSessionRecords(r):(Array.isArray(r.subjects)?r.subjects:[]);
    const scoreLabel=score=>score===null?"정답키 미검증":`정답률 ${score.toFixed(0)}%`;
    const subjectText=subjects.map(subject=>{
      if(isSkippedResult(subject)) return `${subject.label||subject.subject} 건너뜀`;
      const score=resultScore(subject);
      const grade=estimatedGradeLabel(score,subject);
      if(isSession) return `${subject.label||subject.subject} ${scoreLabel(score)}${grade?` · ${grade}`:""}`;
      return isPdf?`${subject.subject} ${scoreLabel(score)}${grade?` · ${grade}`:""}`:`${subject.subject} ${grade||"등급 산출 불가"}`;
    }).join(" · ");
    const details=subjects.map(subject=>{
      if(isSkippedResult(subject)) return `${subject.label||subject.subject} | 과목 건너뜀`;
      const score=resultScore(subject);
      if(isSession){
        const graded=gradedCount(subject);
        const presented=presentedCount(subject);
        const ungraded=Number(subject.result?.ungradedCount??subject.ungradedCount??Math.max(0,presented-graded));
        const wrong=subject.result?.wrong??subject.wrong;
        const grade=estimatedGradeLabel(score,subject);
        const grading=graded?`${scoreLabel(score)}${grade?` · ${grade}`:""} · 자동채점 ${graded}문항`:"자동채점 가능한 검증 정답키 없음";
        return `${subject.label||subject.subject} | ${grading}${ungraded?` · 채점 제외 ${ungraded}문항`:""} | 오답: ${wrong?.length?wrong.map(item=>item?.number??item).join(", "):graded?"없음":"채점 안 함"}\n정답지: ${subject.explanation||"전체 종료 후 영역별 확인"}`;
      }
      const wrong=subject.wrong||[];
      const grade=estimatedGradeLabel(score,subject);
      return isPdf?`${subject.subject} | ${scoreLabel(score)}${grade?` · ${grade}`:""} | 오답: ${wrong.length?wrong.join(", "):"없음"}\n정답지: ${subject.explanation||"연결 안 됨"}`
        :`${subject.subject} | ${score===null?"점수 기록 없음":`${score}점`} | ${grade||"등급 산출 불가"} | 오답: ${wrong.length?wrong.join(", "):"없음"}\n해설: ${subject.explanation||"작성 안 함"}`;
    }).join("\n\n");
    const storedTotalGraded=countValue(r.gradedQuestionCount??r.result?.gradedCount);
    const storedTotalPresented=countValue(r.totalQuestions??r.presentedQuestionCount??r.result?.presentedTotal);
    const totalGraded=storedTotalGraded===null?subjects.reduce((sum,subject)=>sum+gradedCount(subject),0):storedTotalGraded;
    const totalPresented=Math.max(totalGraded,storedTotalPresented===null?subjects.reduce((sum,subject)=>sum+presentedCount(subject),0):storedTotalPresented);
    const averageScore=finiteNumber(r.averageScore??r.score);
    const targetGrade=finiteNumber(r.targetGrade);
    const skippedCount=subjects.filter(isSkippedResult).length;
    const provenanceGroups=isSession
      ?subjects.map(subject=>questionGroup(subject,subject.label||subject.subject))
      :[questionGroup(r,r.paperTitle||r.subject)];
    const provenance=questionProvenance(provenanceGroups);
    const scoreChip=isSession
      ?`<span class="chip">${averageScore===null?"자동채점 결과 없음":`검증 문항 정답률 ${averageScore.toFixed(0)}%`}</span>`
      :`<span class="chip">${averageScore===null?"점수 기록 없음":`${isPdf?"정답률":"점수"} ${averageScore.toFixed(0)}${isPdf?"%":"점"}`}</span>`;
    const coverageChip=isSession
      ?`<span class="chip">${subjects.length}개 영역 · 자동채점 ${totalGraded}/${totalPresented}문항</span>`
      :isPdf?`<span class="chip">자동채점 ${totalGraded}/${totalPresented}문항</span>`:"";
    const wholeSkipped=isSkippedResult(r);
    return `<article class="record-item${clickable?" record-link":""}">
      <div class="record-top"><b>${esc(isSession?"실전 수능 전체 세션":r.paperTitle||(isPdf?"선택 구성 PDF 기출":"수능 연습"))}${clickable?" · 다시 보기":""}</b><em>${fmtDuration(r.seconds||0)}</em></div>
      <div class="record-meta">
        ${scoreChip}
        ${wholeSkipped?"":estimatedGradeChip(averageScore,r)}
        ${coverageChip}
        <span class="chip">오답 ${r.wrongCount??subjects.reduce((n,subject)=>n+Number((subject.result?.wrong??subject.wrong)?.length||0),0)}개</span>
        ${hasSavedAnnotations(r)||subjects.some(hasSavedAnnotations)?'<span class="chip annotation-chip">필기 저장됨</span>':""}
        ${skippedCount?`<span class="chip skipped-chip">건너뛴 과목 ${skippedCount}개</span>`:""}
        ${wholeSkipped?'<span class="chip skipped-chip">결과 건너뜀</span>':""}
      </div>
      <div class="probability-row target-grade-row"><span>${esc(r.targetUniversity||"목표 대학 미설정")} ${esc(r.targetMajor||"")}</span><b>${targetGrade===null?"목표 미설정":`학습목표 ${targetGrade.toFixed(1)}등급`}</b></div>
      <div class="record-detail"><b>${isPdf||isSession?"채점":"예상 등급"}:</b> ${esc(subjectText||"기록 없음")}\n\n${esc(details||"기록 없음")}</div>
      ${provenance}
      ${clickable?reviewButton("csat",r.id,isSession?"전체 수능 세션 결과 다시 보기":"이 PDF 시험 다시 보기","문제 PDF · 내 답 · 필기 다시 보기"):""}
    </article>`;
  }

  function bindReviewButtons(){
    document.querySelectorAll("[data-practice-review-id]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const id=Number(btn.dataset.practiceReviewId);
        if(window.Practice) window.Practice.openReview(id);
      });
    });
    document.querySelectorAll("[data-csat-review-id]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const id=Number(btn.dataset.csatReviewId);
        if(window.CsatPractice) window.CsatPractice.openReview(id);
      });
    });
  }

  function render(){
    const wrap=document.getElementById("dailyDashboard");
    if(!wrap) return;

    wrap.innerHTML=allDates().map(date=>{
      const problems=Store.state.problemResults.filter(r=>r.date===date);
      const csats=Store.state.csatResults.filter(r=>r.date===date);
      const seconds=Store.state.dailyStudySeconds[date]||0;
      return `<article class="day-card">
        <header class="day-head">
          <h3>${Store.formatDate(date)}${date===Store.todayKey()?" · 오늘":""}</h3>
          <span class="day-time">순수 공부시간 ${fmtDuration(seconds)}</span>
        </header>
        <div class="day-sections">
          <section class="day-section">
            <div class="day-section-title"><h4>일반 문제 연습</h4><span>${problems.length}회</span></div>
            <div class="record-list">${problems.length?problems.map(problemItem).join(""):'<div class="empty-state">이날 저장된 일반 문제 결과가 없습니다.</div>'}</div>
          </section>
          <section class="day-section">
            <div class="day-section-title"><h4>수능 연습</h4><span>${csats.length}회</span></div>
            <div class="record-list">${csats.length?csats.map(csatItem).join(""):'<div class="empty-state">이날 저장된 수능 연습 결과가 없습니다.</div>'}</div>
          </section>
        </div>
      </article>`;
    }).join("");

    bindReviewButtons();
    updateSummaryOnly();
  }

  function updateSummaryOnly(){
    const today=Store.todayKey();
    const sec=Store.state.dailyStudySeconds[today]||0;
    const p=Store.state.problemResults.filter(r=>r.date===today).length;
    const c=Store.state.csatResults.filter(r=>r.date===today).length;
    const t=document.getElementById("dashTodayTime"); if(t)t.textContent=fmtDuration(sec);
    const ps=document.getElementById("dashProblemSessions"); if(ps)ps.textContent=`${p}회`;
    const cs=document.getElementById("dashCsatSessions"); if(cs)cs.textContent=`${c}회`;
  }

  window.Dashboard={render,updateSummaryOnly,estimateGradeFromScore};
})();

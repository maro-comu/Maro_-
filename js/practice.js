(function(){
  "use strict";

  const Catalog=window.PdfCatalog;
  let selectedArea="";
  let selectedSubject="";
  let activeExamWindow=null;

  function subjectName(item){ return typeof item==="string"?item:String(item?.subject||item?.name||""); }
  function selectedSource(){ return document.querySelector('input[name="practice-source"]:checked')?.value||""; }
  function filters(){
    const result={area:selectedArea,subject:selectedSubject};
    const source=selectedSource();
    if(source) result.examType=source;
    return result;
  }
  function pairedPapers(criteria){
    return (Catalog?.listPapers?.(criteria)||[]).filter(paper=>Number(paper.year)>=2022&&paper.questionPath&&paper.answerPath&&Number(paper.questionCount)>0);
  }
  function pool(){ return pairedPapers(filters()); }
  function gradingSummary(papers){
    const auto=papers.filter(paper=>paper.answerMode==="auto").length;
    return {auto,manual:papers.length-auto};
  }
  function setButtons(){
    const papers=selectedSubject?pool():[];
    const grades=gradingSummary(papers);
    const start=document.getElementById("startPracticeBtn");
    start.disabled=!selectedSubject||papers.length===0;
    document.getElementById("practicePoolCount").textContent=`${papers.length}회분`;
    if(!selectedSubject){
      document.getElementById("selectedPracticeSubject").textContent="영역과 세부과목을 선택해 주세요";
      document.getElementById("practiceStatusText").textContent="2022년도 이후 문제·정답 PDF를 전체 문서 형태로 출제합니다.";
      return;
    }
    const source=selectedSource()||"수능+모의고사 전체";
    document.getElementById("selectedPracticeSubject").textContent=`${selectedArea} · ${selectedSubject}`;
    document.getElementById("practiceStatusText").textContent=papers.length
      ?`${source} ${papers.length}회분 · 자동 채점 ${grades.auto}회분${grades.manual?` · 정답지 직접 확인 ${grades.manual}회분`:""}`
      :"이 조건에는 2022년도 이후 문제·정답 PDF가 없습니다.";
  }
  function selectTopic(subject,button){
    selectedSubject=subject;
    document.querySelectorAll(".topic-chip").forEach(item=>item.classList.remove("selected"));
    button?.classList.add("selected");
    setButtons();
  }
  function renderTopics(area){
    selectedArea=area;
    selectedSubject="";
    const panel=document.getElementById("practiceTopicPanel");
    const grid=document.getElementById("practiceTopicGrid");
    panel.classList.remove("hidden");
    document.getElementById("practiceAreaTitle").textContent=`${area} 세부과목`;
    grid.innerHTML="";
    const subjects=(Catalog?.listSubjects?.(area)||[]).map(subjectName).filter(Boolean);
    subjects.forEach(subject=>{
      const papers=pairedPapers({area,subject});
      const grades=gradingSummary(papers);
      const button=document.createElement("button");
      button.type="button";
      button.className="topic-chip";
      button.disabled=papers.length===0;
      button.innerHTML="<b></b><small></small>";
      button.querySelector("b").textContent=subject;
      button.querySelector("small").textContent=papers.length?`${papers.length}회분 · 자동 ${grades.auto}`:"준비 중";
      button.addEventListener("click",()=>selectTopic(subject,button));
      grid.appendChild(button);
    });
    if(!subjects.length){
      const empty=document.createElement("p");
      empty.className="topic-empty";
      empty.textContent="이 영역의 2022년도 이후 PDF 목록을 찾지 못했습니다.";
      grid.appendChild(empty);
    }
    setButtons();
  }
  function launch(url,name){
    if(activeExamWindow&&!activeExamWindow.closed){
      activeExamWindow.focus();
      window.AppUi.toast("이미 열린 기출 풀이 창이 있습니다.");
      return null;
    }
    activeExamWindow=window.open(url,name,"popup=yes,width=1440,height=920,resizable=yes,scrollbars=yes");
    if(!activeExamWindow){ window.AppUi.toast("기출 풀이 창이 차단되었습니다. 팝업을 허용한 뒤 다시 눌러주세요."); return null; }
    activeExamWindow.focus();
    return activeExamWindow;
  }
  function openRandomPaper(){
    const papers=pool();
    if(!papers.length){ window.AppUi.toast("이 조건의 2022년도 이후 PDF가 없습니다."); return; }
    const automatic=papers.filter(paper=>paper.answerMode==="auto"&&Object.keys(paper.answerKey||{}).length>0);
    const selectable=automatic.length?automatic:papers;
    const key=`last_practice_pdf_${selectedArea}_${selectedSubject}_${selectedSource()}`;
    const last=sessionStorage.getItem(key);
    const choices=last&&selectable.length>1?selectable.filter(item=>item.id!==last):selectable;
    const paper=choices[Math.floor(Math.random()*choices.length)]||null;
    if(!paper){ window.AppUi.toast("랜덤 기출을 선택하지 못했습니다."); return; }
    sessionStorage.setItem(key,paper.id);
    const url=new URL("exam.html",location.href);
    url.searchParams.set("mode","start");
    url.searchParams.set("context","practice");
    url.searchParams.set("paper",paper.id);
    url.searchParams.set("area",paper.area||selectedArea);
    url.searchParams.set("subject",paper.subject||selectedSubject);
    if(paper.examType) url.searchParams.set("examType",paper.examType);
    if(launch(url.href,"pdfPracticeWindow")) window.AppUi.toast(`${paper.subject} 전체 문제 PDF를 열었습니다.`);
  }
  function openReview(id){
    const url=new URL("exam.html",location.href);
    url.searchParams.set("mode","review");
    url.searchParams.set("context","practice");
    url.searchParams.set("id",String(id));
    activeExamWindow=null;
    launch(url.href,`practiceReview_${id}`);
  }
  function syncResult(message){
    if(message.origin!==location.origin||message.source!==activeExamWindow) return;
    if(message?.data?.type!=="pdf-exam-finished"||message.data.context!=="practice"||!Number.isFinite(Number(message.data.id))) return;
    window.AppStore.reload();
    window.Dashboard.render();
    window.AppUi.toast("PDF 기출 풀이 결과와 필기를 대시보드에 저장했습니다.");
  }
  function init(){
    if(!Catalog){
      document.getElementById("practiceStatusText").textContent="PDF 목록을 불러오지 못했습니다.";
      return;
    }
    document.querySelectorAll(".subject-card[data-area]").forEach(button=>button.addEventListener("click",()=>{
      document.querySelectorAll(".subject-card[data-area]").forEach(item=>item.classList.remove("selected"));
      button.classList.add("selected");
      renderTopics(button.dataset.area);
    }));
    document.querySelectorAll('input[name="practice-source"]').forEach(input=>input.addEventListener("change",setButtons));
    document.getElementById("startPracticeBtn").addEventListener("click",openRandomPaper);
    window.addEventListener("message",syncResult);
    window.addEventListener("storage",()=>{ window.AppStore.reload(); window.Dashboard.render(); });
    setButtons();
  }
  window.Practice={init,setButtons,openReview};
})();

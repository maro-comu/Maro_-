(function(){
  const Store=window.AppStore;
  const Admissions=window.UniversityAdmissions;
  let currentEstimate=null;
  const targetSelection={university:null,department:null,universityMatch:null,departmentMatch:null};
  const suggestionCache={university:[],department:[]};

  function el(id){ return document.getElementById(id); }
  function toast(message){
    const target=el("toast");
    target.textContent=message;
    target.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>target.classList.remove("show"),2400);
  }
  function openModal(id){ el(id)?.classList.remove("hidden"); }
  function closeModal(id){ el(id)?.classList.add("hidden"); }
  window.AppUi={toast,openModal,closeModal};

  function calculateDDay(){
    const now=new Date();
    const csat=new Date("2026-11-19T00:00:00+09:00");
    const diff=Math.max(0,Math.ceil((csat-now)/(1000*60*60*24)));
    el("ddayCount").textContent=String(diff).padStart(2,"0");
    el("csatDateString").textContent="2027학년도 수능 · 2026년 11월 19일";
  }
  function updateTargetUi(){
    const target=Store.state.target||{};
    el("displayTargetUni").textContent=target.university||"목표 대학 미설정";
    const campus=target.campusName?` · ${target.campusName}`:"";
    const requestedMajor=String(target.majorInput||"").trim();
    const majorLabel=requestedMajor && requestedMajor!==target.major?`${requestedMajor} → ${target.major}`:target.major;
    el("displayTargetMajor").textContent=majorLabel?`${majorLabel} (연결 대표 분야)${campus}`:"학과 미설정";
    el("displayTargetGrade").textContent=target.university && Number.isFinite(Number(target.targetGrade))?Number(target.targetGrade).toFixed(1):"-";
    el("displayTargetEstimateMeta").textContent=target.estimateRange
      ?`범위 ${target.estimateRange} · 신뢰도 ${target.estimateConfidenceLabel||"낮음"}`
      :"공식 입결 아님";
  }

  function optionMarkup(value,label,selected=false){
    const option=document.createElement("option");
    option.value=String(value??"");
    option.textContent=String(label??value??"");
    option.selected=selected;
    return option;
  }
  function matchLabel(match){
    if(!match) return "연결 필요";
    if(match.matchType==="exact") return "정확히 찾음";
    if(["prefix","expanded","contains"].includes(match.matchType)) return "관련 이름";
    return "유사 이름";
  }
  function koreanParticle(value,withBatchim,withoutBatchim){
    const lastHangul=[...String(value||"")].reverse().find(char=>{
      const code=char.charCodeAt(0);
      return code>=0xac00&&code<=0xd7a3;
    });
    if(!lastHangul) return withoutBatchim;
    return (lastHangul.charCodeAt(0)-0xac00)%28?withBatchim:withoutBatchim;
  }
  function searchConfig(kind){
    return kind==="university"
      ?{input:el("targetUniInput"),list:el("targetUniSuggestions"),search:query=>Admissions.searchUniversities(query,{limit:6,minimumScore:.34})}
      :{input:el("targetMajorInput"),list:el("targetMajorSuggestions"),search:query=>Admissions.searchDepartments(query,{limit:6,minimumScore:.3})};
  }
  function hideSuggestions(kind){
    const config=searchConfig(kind);
    config.list.classList.add("hidden");
    config.input.setAttribute("aria-expanded","false");
  }
  function resultDescription(kind,result){
    if(kind==="university") return `${result.shortName} · ${result.region}`;
    return `${result.groupName} 대표 분야 · 실제 개설 여부 미검증`;
  }
  function selectSearchResult(kind,result,options={}){
    if(!result) return;
    const config=searchConfig(kind);
    targetSelection[kind]=kind==="university"?result.university:result.department;
    targetSelection[`${kind}Match`]=result;
    if(!options.keepInput) config.input.value=result.name;
    hideSuggestions(kind);
    if(kind==="university") populateCampuses(options.campusId||"");
    renderMatchConfirmation();
    renderEstimate();
  }
  function makeSuggestionButton(kind,result,index){
    const button=document.createElement("button");
    button.type="button";
    button.className="smart-suggestion";
    button.setAttribute("role","option");
    button.id=`target-${kind}-suggestion-${index}`;
    const copy=document.createElement("span");
    const title=document.createElement("strong");
    title.textContent=result.name;
    const detail=document.createElement("small");
    detail.textContent=resultDescription(kind,result);
    const badge=document.createElement("em");
    badge.textContent=matchLabel(result);
    copy.append(title,detail);
    button.append(copy,badge);
    button.addEventListener("click",()=>selectSearchResult(kind,result));
    button.addEventListener("keydown",event=>{
      const buttons=[...searchConfig(kind).list.querySelectorAll("button")];
      const position=buttons.indexOf(button);
      if(event.key==="ArrowDown"){
        event.preventDefault();
        (buttons[position+1]||buttons[0])?.focus();
      }else if(event.key==="ArrowUp"){
        event.preventDefault();
        (buttons[position-1]||searchConfig(kind).input)?.focus();
      }else if(event.key==="Escape"){
        event.preventDefault();
        hideSuggestions(kind);
        searchConfig(kind).input.focus();
      }
    });
    return button;
  }
  function renderSuggestions(kind){
    const config=searchConfig(kind);
    const query=config.input.value.trim();
    config.list.innerHTML="";
    suggestionCache[kind]=query?config.search(query):[];
    if(!query || targetSelection[kind] || query.length<2){ hideSuggestions(kind); return; }
    if(!suggestionCache[kind].length){
      const empty=document.createElement("p");
      empty.className="smart-suggestion-empty";
      empty.textContent=kind==="university"
        ?"지원 목록 35개 대학에서 관련 이름을 찾지 못했습니다. 정식 명칭이나 약칭으로 다시 입력해 주세요."
        :"관련 대표 전공을 찾지 못했습니다. ‘컴공’, ‘경영’, ‘간호’처럼 핵심 학과명으로 입력해 보세요.";
      config.list.appendChild(empty);
    }else{
      suggestionCache[kind].forEach((result,index)=>config.list.appendChild(makeSuggestionButton(kind,result,index)));
    }
    config.list.classList.remove("hidden");
    config.input.setAttribute("aria-expanded","true");
  }
  function exactResult(kind,query){
    const item=kind==="university"?Admissions.getUniversity(query):Admissions.getDepartment(query);
    if(!item) return null;
    if(kind==="university"){
      return {id:item.id,name:item.name,shortName:item.shortName,region:item.region,university:item,score:1,matchType:"exact",matchedText:query,exact:true};
    }
    const group=Admissions.majorGroups.find(entry=>entry.id===item.groupId);
    return {id:item.id,name:item.name,groupId:item.groupId,groupName:group?.name||"",department:item,score:1,matchType:"exact",matchedText:query,exact:true};
  }
  function handleSearchInput(kind){
    const config=searchConfig(kind);
    targetSelection[kind]=null;
    targetSelection[`${kind}Match`]=null;
    if(kind==="university") populateCampuses("");
    const exact=exactResult(kind,config.input.value.trim());
    if(exact){
      selectSearchResult(kind,exact,{keepInput:true});
      return;
    }
    renderSuggestions(kind);
    renderMatchConfirmation();
    renderEstimate();
  }
  function populateCampuses(selected){
    const university=targetSelection.university;
    const campuses=university?Admissions.listCampuses(university.id):[];
    const field=el("targetCampusField");
    const select=el("targetCampusSelect");
    select.innerHTML="";
    if(campuses.length<=1){
      if(campuses[0]) select.appendChild(optionMarkup(campuses[0].id,`${campuses[0].name} · ${campuses[0].region}`,true));
      field.classList.add("hidden");
      return;
    }
    select.appendChild(optionMarkup("","캠퍼스 미지정 · 대학 공통 기준",!selected));
    campuses.forEach(campus=>select.appendChild(optionMarkup(campus.id,`${campus.name} · ${campus.region}`,campus.id===selected)));
    field.classList.remove("hidden");
  }
  function renderMatchConfirmation(){
    const university=targetSelection.university;
    const department=targetSelection.department;
    const uniQuery=el("targetUniInput").value.trim();
    const majorQuery=el("targetMajorInput").value.trim();
    const card=el("targetMatchConfirmation");
    card.classList.toggle("ready",!!university&&!!department);
    el("targetMatchStatus").textContent=university&&department?"연결 확인됨":`${Number(!!university)+Number(!!department)}/2 연결`;
    el("targetMatchedUni").textContent=university
      ?`“${uniQuery}” → ${university.name} · ${matchLabel(targetSelection.universityMatch)}`
      :uniQuery?`“${uniQuery}” · 관련 검색 결과를 선택해 주세요`:"직접 입력해 주세요";
    el("targetMatchedMajor").textContent=department
      ?`“${majorQuery}” → ${department.name} · ${matchLabel(targetSelection.departmentMatch)}`
      :majorQuery?`“${majorQuery}” · 관련 검색 결과를 선택해 주세요`:"직접 입력해 주세요";
    if(university&&department){
      el("targetMatchHelp").textContent=`${department.name}${koreanParticle(department.name,"은","는")} 입력한 학과와 연결한 대표 분야입니다. ${university.name}의 실제 학과 개설을 확인한 결과는 아닙니다.`;
    }else{
      el("targetMatchHelp").textContent="정확히 일치하는 이름은 자동 연결하고, 비슷한 이름은 검색 결과를 눌러 확인합니다.";
    }
  }
  function confidenceText(confidence){
    if(!confidence) return "신뢰도 낮음";
    return `신뢰도 ${confidence.label} · 비공식 모델`;
  }
  function renderEstimate(){
    const university=targetSelection.university;
    const department=targetSelection.department;
    const campusId=el("targetCampusSelect").value;
    currentEstimate=university&&department?Admissions.estimateAdmission({universityId:university.id,departmentId:department.id,campusId}):null;
    const card=el("targetEstimateCard");
    card.classList.toggle("ready",!!currentEstimate);
    el("saveTargetBtn").disabled=!currentEstimate;
    if(!currentEstimate){
      el("targetGradeInput").value="";
      el("targetGradePreview").textContent="-";
      el("targetGradeRange").textContent="예상 범위 -";
      el("targetEstimateConfidence").textContent="연결 대기";
      el("targetEstimateReason").textContent="대학교와 학과를 입력하고 관련 검색 결과를 확인하면 추정 근거가 표시됩니다.";
      el("targetOfferingNote").textContent="대표 전공 분야이며 선택한 대학의 실제 개설 학과명은 입학처에서 확인해야 합니다.";
      return;
    }
    el("targetGradeInput").value=currentEstimate.targetGrade;
    el("targetGradePreview").textContent=Number(currentEstimate.targetGrade).toFixed(1);
    el("targetGradeRange").textContent=`참고 범위 ${currentEstimate.range.label}`;
    el("targetEstimateConfidence").textContent=confidenceText(currentEstimate.confidence);
    const factor=currentEstimate.basis.factors.find(item=>item.id==="major-adjustment");
    const impact=Number(factor?.impact||0);
    const direction=impact<0?"더 높은":impact>0?"조금 넓은":"비슷한";
    const enteredMajor=el("targetMajorInput").value.trim();
    el("targetEstimateReason").textContent=`입력한 학과 ‘${enteredMajor}’${koreanParticle(enteredMajor,"을","를")} ${currentEstimate.department.name} 대표 분야와 연결했습니다. 전공 보정으로 대학 기준보다 ${direction} 학습목표를 제안했습니다.`;
    el("targetOfferingNote").textContent=currentEstimate.department.offeringNote;
  }
  function openTarget(){
    if(!Admissions){ toast("대학 자동 추정 데이터를 불러오지 못했습니다."); return; }
    const target=Store.state.target||{};
    const savedUniversity=Admissions.getUniversity(target.universityId||target.university);
    const savedDepartment=Admissions.getDepartment(target.majorId||target.major);
    el("targetUniInput").value=target.universityInput||savedUniversity?.name||"";
    el("targetMajorInput").value=target.majorInput||savedDepartment?.name||"";
    targetSelection.university=savedUniversity||null;
    targetSelection.department=savedDepartment||null;
    targetSelection.universityMatch=savedUniversity?exactResult("university",el("targetUniInput").value):null;
    targetSelection.departmentMatch=savedDepartment?exactResult("department",el("targetMajorInput").value):null;
    populateCampuses(target.campusId||"");
    renderMatchConfirmation();
    renderEstimate();
    el("targetAdmissionMemo").value=target.admissionMemo||"";
    hideSuggestions("university");
    hideSuggestions("department");
    openModal("targetModal");
  }
  function saveTarget(){
    if(!currentEstimate){ toast("대학교와 학과를 입력한 뒤 관련 항목을 확인해 주세요."); return; }
    const university=targetSelection.university;
    const department=targetSelection.department;
    const campus=Admissions.listCampuses(university.id).find(item=>item.id===el("targetCampusSelect").value)||null;
    const group=Admissions.majorGroups.find(item=>item.id===department.groupId)||null;
    const universityInput=el("targetUniInput").value.trim();
    const majorInput=el("targetMajorInput").value.trim();
    Store.state.target={
      universityId:university.id,university:university.name,universityInput,selectedRegion:university.region,
      campusId:campus?.id||"",campusName:campus?.name||"",majorGroupId:department.groupId,majorGroupName:group?.name||"",
      majorId:department.id,major:department.name,majorInput,majorIsVerifiedOffering:false,targetGrade:Number(currentEstimate.targetGrade),estimateRange:currentEstimate.range.label,
      universityMatchType:targetSelection.universityMatch?.matchType||"confirmed",majorMatchType:targetSelection.departmentMatch?.matchType||"confirmed",
      estimateConfidence:currentEstimate.confidence.score,estimateConfidenceLabel:currentEstimate.confidence.label,
      estimateModelVersion:currentEstimate.basis.modelVersion||Admissions.meta.modelVersion,estimateOfficial:false,
      estimateBasis:currentEstimate.basis.summary,admissionMemo:el("targetAdmissionMemo").value.trim()
    };
    Store.save();
    updateTargetUi();
    closeModal("targetModal");
    Dashboard.render();
    const savedLabel=`${universityInput} · ${majorInput}`;
    toast(`‘${savedLabel}’${koreanParticle(savedLabel,"을","를")} ${university.shortName} · ${department.name}에 연결해 ${Number(currentEstimate.targetGrade).toFixed(1)}등급 목표로 저장했습니다.`);
  }
  function searchAdmission(){
    const target=Store.state.target||{};
    if(!target.university){ toast("먼저 목표 대학을 설정해 주세요."); return; }
    window.open("https://www.adiga.kr/ucp/prc/uni/admssUnivView.do?menuId=PCPRC","_blank","noopener");
    toast(`어디가 대학·학과 검색에서 ‘${target.university} ${target.majorInput||target.major||""}’의 공식 자료를 확인하세요.`);
  }
  function setupTargetEvents(){
    ["university","department"].forEach(kind=>{
      const config=searchConfig(kind);
      config.input.addEventListener("input",()=>handleSearchInput(kind));
      config.input.addEventListener("focus",()=>renderSuggestions(kind));
      config.input.addEventListener("keydown",event=>{
        if(event.key==="ArrowDown"){
          const first=config.list.querySelector("button");
          if(first){ event.preventDefault(); first.focus(); }
        }else if(event.key==="Enter"&&!targetSelection[kind]&&suggestionCache[kind][0]){
          event.preventDefault();
          selectSearchResult(kind,suggestionCache[kind][0]);
        }else if(event.key==="Escape"){
          hideSuggestions(kind);
        }
      });
    });
    el("targetCampusSelect").addEventListener("change",renderEstimate);
    document.addEventListener("click",event=>{
      if(!event.target.closest(".smart-search-field")){
        hideSuggestions("university");
        hideSuggestions("department");
      }
    });
  }
  function setupNav(){
    document.querySelectorAll(".nav-btn").forEach(button=>button.addEventListener("click",()=>{
      const activeMode=StudyTimer.activeMode();
      const requiredTab=activeMode==="practice"?"practice":activeMode==="csat"?"csat-exam":null;
      if(requiredTab && button.dataset.tab!==requiredTab){ toast("공부시간 기록 중에는 먼저 학습을 종료해 주세요."); return; }
      document.querySelectorAll(".nav-btn").forEach(item=>item.classList.remove("active"));
      button.classList.add("active");
      document.querySelectorAll(".tab-view").forEach(view=>view.classList.remove("active"));
      el(`${button.dataset.tab}-view`).classList.add("active");
      window.Practice?.setButtons();
      window.CsatPractice?.setButtons();
    }));
  }
  function setupModals(){
    document.querySelectorAll("[data-close-modal]").forEach(button=>button.addEventListener("click",()=>closeModal(button.dataset.closeModal)));
    document.querySelectorAll(".modal").forEach(modal=>modal.addEventListener("click",event=>{ if(event.target===modal) closeModal(modal.id); }));
  }
  function init(){
    setupNav();setupModals();setupTargetEvents();calculateDDay();updateTargetUi();
    el("openTargetModalBtn").addEventListener("click",openTarget);
    el("saveTargetBtn").addEventListener("click",saveTarget);
    el("openAdmissionSearchBtn").addEventListener("click",searchAdmission);
    StudyTimer.init();Practice.init();CsatPractice.init();Dashboard.render();
  }
  document.addEventListener("DOMContentLoaded",init);
})();

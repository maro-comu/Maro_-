(function(){
  const Store=window.AppStore;
  const Catalog=window.PdfCatalog;
  const params=new URLSearchParams(location.search);
  const boot=window.CSAT_EXAM_BOOT||{};
  const mode=String(boot.mode||params.get("mode")||"start");
  const requestedContext=String(boot.context||params.get("context")||"practice");
  const isCsatSession=requestedContext==="csat-session"||mode==="csat-session";
  const context=isCsatSession?"csat-session":requestedContext==="csat"?"csat":"practice";
  const reviewId=Number(boot.id||params.get("id")||0);
  const qaSessionRequested=params.get("qa")==="1"&&["localhost","127.0.0.1","::1"].includes(location.hostname);

  let paper=null;
  let config={};
  let answerKey=[];
  let submitted=mode==="review";
  let sessionSeconds=0;
  let activeStartedAt=null;
  let tickHandle=null;
  let currentQuestionIndex=0;
  let draftAnswers={};
  let displayedResult=null;
  let pdfViewerGeneration=0;
  let pdfViewerReady=false;
  let pdfViewerObjectUrl="";
  let pdfViewerReadyTimeout=null;
  let pdfViewerProbeHandle=null;
  let pdfViewerStorageSignature=null;
  let pdfEditRevision=0;
  let pdfViewerDirty=false;
  let activePdfStorageKey="";
  let persistedPdfStorageKey="";
  let activePdfHasEdits=false;
  let pdfExportInProgress=0;
  let pdfExportQueue=Promise.resolve();
  let pdfStorePromise=null;
  const pdfExportRequests=new Map();
  const pdfReadyWaiters=new Set();
  let annotations={version:1,pages:{}};
  let practiceDraftKey="";
  let skippedQuestions=new Set();
  let sessionReviewRecords=null;
  let sessionReviewOptions=null;
  let sessionData=null;
  let sessionStorageKey="";
  let sessionStages=[];
  let sessionTransitioning=false;
  let sessionInactive=false;
  let pendingConfirmAction="";
  const activeSessionStatuses=new Set(["ready","running","completed"]);

  function el(id){ return document.getElementById(id); }
  function esc(value){
    return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
  }
  function openPdfInLargePopup(event,popupName){
    const link=event.currentTarget;
    const url=String(link?.href||"");
    if(!url) return;
    const availableWidth=Math.max(360,Number(screen.availWidth)||Number(window.outerWidth)||1280);
    const availableHeight=Math.max(480,Number(screen.availHeight)||Number(window.outerHeight)||800);
    const width=Math.max(340,Math.min(1500,availableWidth-40));
    const height=Math.max(460,Math.min(1100,availableHeight-50));
    const left=Math.max(0,Math.round((availableWidth-width)/2));
    const top=Math.max(0,Math.round((availableHeight-height)/2));
    const features=`popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,location=yes,menubar=no,toolbar=no,status=no`;
    const popup=window.open("",popupName,features);
    if(!popup) return;
    event.preventDefault();
    try{ popup.opener=null; }catch(error){ /* 일부 브라우저는 opener 변경을 막습니다. */ }
    popup.location.href=url;
    popup.focus();
  }
  function formatTime(seconds){
    const safe=Math.max(0,Math.floor(Number(seconds)||0));
    const h=Math.floor(safe/3600),m=Math.floor(safe%3600/60),s=safe%60;
    return [h,m,s].map(v=>String(v).padStart(2,"0")).join(":");
  }
  function normalizeAnswer(value){
    const circled={"①":"1","②":"2","③":"3","④":"4","⑤":"5","❶":"1","❷":"2","❸":"3","❹":"4","❺":"5"};
    let normalized=String(value??"").normalize("NFKC").trim().replace(/[①②③④⑤❶❷❸❹❺]/g,c=>circled[c]).replace(/[\s,]/g,"");
    if(/^-?\d+$/.test(normalized)) normalized=String(Number(normalized));
    return normalized;
  }
  function parseConfig(){
    if(boot.config && typeof boot.config==="object"){ config=boot.config; return; }
    try{
      const raw=params.get("config");
      if(raw) config=JSON.parse(raw);
    }catch(error){ console.warn("응시 구성을 읽지 못했습니다.",error); }
  }
  function keyEntries(raw,count,targetPaper=paper,includeUnverified=false){
    const map=new Map();
    if(Array.isArray(raw)){
      raw.forEach((value,index)=>{
        if(value!==null && value!==undefined && String(value).trim()!=="") map.set(index+1,normalizeAnswer(value));
      });
    }else if(raw && typeof raw==="object"){
      Object.entries(raw).forEach(([number,value])=>{
        const n=Number(number);
        if(Number.isInteger(n) && n>0 && value!==null && value!==undefined && String(value).trim()!=="") map.set(n,normalizeAnswer(value));
      });
    }
    const max=Math.max(Number(count)||0,...map.keys(),0);
    const entries=Array.from({length:max},(_,index)=>({number:index+1,correct:map.get(index+1)||""}));
    // 문제 번호는 정답키 검증 여부와 무관하게 항상 실제 시험지의 1번부터 유지합니다.
    // 정답이 없는 문항은 답안을 저장하되 gradeWithEntries에서 자동채점만 제외합니다.
    void targetPaper;void includeUnverified;
    return entries;
  }
  function isStudyActive(){
    const sessionExamActive=!isCsatSession||sessionStages[sessionData?.currentStageIndex]?.type==="exam";
    const sessionWindowActive=document.visibilityState==="visible" && document.hasFocus();
    return mode==="start" && !submitted && !sessionInactive && sessionExamActive && (!isCsatSession||sessionWindowActive);
  }
  function addElapsed(){
    if(activeStartedAt===null) return;
    const delta=Math.max(0,Math.floor((Date.now()-activeStartedAt)/1000));
    if(delta>0){
      sessionSeconds+=delta;
      Store.reload();
      const date=Store.todayKey();
      Store.state.dailyStudySeconds[date]=(Store.state.dailyStudySeconds[date]||0)+delta;
      Store.save();
      if(isCsatSession && sessionData){
        sessionData.focusedStudySeconds=sessionSeconds;
        persistSession();
      }
    }
    activeStartedAt=null;
  }
  function syncTimerState(){
    if(isStudyActive()){
      if(activeStartedAt===null) activeStartedAt=Date.now();
    }else addElapsed();
  }
  function updateTimer(){
    if(isCsatSession){ updateSessionClock(); return; }
    const preview=activeStartedAt===null?sessionSeconds:sessionSeconds+Math.max(0,Math.floor((Date.now()-activeStartedAt)/1000));
    const text=formatTime(preview);
    el("examTimer").textContent=text;
    if(el("panelExamTimer")) el("panelExamTimer").textContent=text;
  }
  function paperUrl(kind){
    if(!paper) return "";
    if(Catalog?.resolveUrl){
      try{ return Catalog.resolveUrl(paper,kind); }catch(error){ console.warn("PDF 경로 변환 실패",error); }
    }
    const path=kind==="answer"?paper.answerPath:paper.questionPath;
    return path?new URL(path,location.href).href:"";
  }
  function isModernPaper(value){
    return !!value&&Number(value.year)>=2022&&!!value.questionPath;
  }
  function defaultProblemStartPage(){
    const elective=new Set(["확률과 통계","미적분","기하"]);
    if(paper?.area==="수학" && elective.has(paper?.subject)) return 9;
    if(paper?.area==="영어") return 3;
    return null;
  }
  function withPdfView(url,page,view={}){
    if(!url) return "";
    const cleanUrl=url.split("#")[0];
    const parts=[];
    if(Number(page)>0) parts.push(`page=${Math.max(1,Math.round(Number(page)))}`);
    const zoom=Number(view.zoom);
    const left=Number(view.x);
    const top=Number(view.y);
    if(zoom>0){
      const coordinates=Number.isFinite(left)&&Number.isFinite(top)?`,${Math.max(0,Math.round(left))},${Math.max(0,Math.round(top))}`:"";
      parts.push(`zoom=${Math.min(300,Math.max(90,Math.round(zoom)))}${coordinates}`);
    }else parts.push("view=FitH");
    parts.push("toolbar=1","navpanes=0");
    return `${cleanUrl}#${parts.join("&")}`;
  }

  function cleanAnnotations(value){
    const pages=value&&typeof value==="object"&&value.pages&&typeof value.pages==="object"?value.pages:{};
    const cleaned={version:1,pages:{}};
    Object.entries(pages).forEach(([page,strokes])=>{
      if(!Array.isArray(strokes)) return;
      cleaned.pages[String(Math.max(1,Number(page)||1))]=strokes.slice(-1200).map(stroke=>({
        color:/^#[0-9a-f]{6}$/i.test(String(stroke?.color||""))?String(stroke.color):"#2563eb",
        width:Math.max(.0004,Math.min(.03,Number(stroke?.width)||.003)),
        points:Array.isArray(stroke?.points)?stroke.points.slice(0,5000).map(point=>[
          Math.max(0,Math.min(1,Number(point?.[0])||0)),Math.max(0,Math.min(1,Number(point?.[1])||0)),Math.max(.1,Math.min(1,Number(point?.[2])||.5))
        ]):[]
      })).filter(stroke=>stroke.points.length);
    });
    return cleaned;
  }
  function cloneAnnotations(){ return cleanAnnotations(JSON.parse(JSON.stringify(annotations||{version:1,pages:{}}))); }
  function hasAnnotations(value=annotations){ return Object.values(value?.pages||{}).some(strokes=>Array.isArray(strokes)&&strokes.length); }
  function currentHasAnnotations(){ return activePdfHasEdits||hasAnnotations(); }
  function savedPdfStorageKey(){ return persistedPdfStorageKey||null; }
  function updateAnnotationStatus(text="PDF 필기는 제출할 때 저장됩니다",saving=false){
    const status=el("annotationSaveStatus");
    if(!status) return;
    status.textContent=text;
    status.classList.toggle("saving",saving);
  }
  function practiceDraftId(){ return `studyAppPracticeDraft:${paper?.id||"paper"}:full-pdf-v2`; }
  function practicePdfStorageId(){ return `draft:${context}:${paper?.id||"paper"}`; }
  function sessionPdfStorageId(sectionId=sessionData?.activeSectionId){ return `session:${sessionData?.id||"unknown"}:${sectionId||"section"}`; }

  function openPdfStore(){
    if(!("indexedDB" in window)) return Promise.reject(new Error("이 브라우저는 편집 PDF 저장소를 지원하지 않습니다."));
    if(!pdfStorePromise){
      pdfStorePromise=new Promise((resolve,reject)=>{
        const request=indexedDB.open("studyAppAnnotatedPdfs",1);
        request.onupgradeneeded=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains("pdfs")) db.createObjectStore("pdfs",{keyPath:"key"});
        };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error||new Error("편집 PDF 저장소를 열지 못했습니다."));
        request.onblocked=()=>reject(new Error("편집 PDF 저장소가 다른 창에서 사용 중입니다."));
      });
    }
    return pdfStorePromise;
  }
  async function readStoredPdf(key){
    if(!key) return null;
    const db=await openPdfStore();
    return new Promise((resolve,reject)=>{
      const request=db.transaction("pdfs","readonly").objectStore("pdfs").get(String(key));
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error||new Error("저장된 편집 PDF를 읽지 못했습니다."));
    });
  }
  async function writeStoredPdf(key,data){
    if(!key) throw new Error("편집 PDF 저장 키가 없습니다.");
    const blob=data instanceof Blob?data:new Blob([data],{type:"application/pdf"});
    const db=await openPdfStore();
    await new Promise((resolve,reject)=>{
      const transaction=db.transaction("pdfs","readwrite");
      transaction.objectStore("pdfs").put({key:String(key),blob,updatedAt:Date.now(),size:blob.size});
      transaction.oncomplete=()=>resolve();
      transaction.onerror=()=>reject(transaction.error||new Error("편집 PDF를 저장하지 못했습니다."));
      transaction.onabort=()=>reject(transaction.error||new Error("편집 PDF 저장이 중단되었습니다."));
    });
    return true;
  }
  async function copyStoredPdf(fromKey,toKey){
    if(!fromKey||!toKey) return false;
    const record=await readStoredPdf(fromKey);
    if(!record?.blob) return false;
    await writeStoredPdf(toKey,record.blob);
    return true;
  }
  function pdfViewerUrl(fileUrl,page=1){
    if(!fileUrl) return "";
    const viewer=new URL("vendor/pdfjs-viewer/web/viewer.html",location.href);
    viewer.searchParams.set("file",fileUrl);
    viewer.searchParams.set("study","20260821-eraser-hover-2");
    viewer.hash=`page=${Math.max(1,Math.round(Number(page)||1))}&zoom=page-width`;
    return viewer.href;
  }
  function resolvePdfReady(){
    pdfViewerReady=true;
    clearTimeout(pdfViewerReadyTimeout);pdfViewerReadyTimeout=null;
    pdfReadyWaiters.forEach(waiter=>{clearTimeout(waiter.timer);waiter.resolve(true);});
    pdfReadyWaiters.clear();
  }
  function markPdfViewerReady(){
    resolvePdfReady();
    el("pdfDocumentLoading")?.classList.add("hidden");el("pdfDocumentError")?.classList.add("hidden");
    updateAnnotationStatus(activePdfHasEdits?"저장된 필기 PDF 표시 중 · 새 필기는 제출할 때 저장":"PDF의 그리기·텍스트 도구 사용 가능 · 필기는 제출할 때 저장");
  }
  function markPdfViewerDirty(){
    if(pdfExportInProgress>0||(mode==="start"&&submitted)) return;
    const wasDirty=pdfViewerDirty;
    activePdfHasEdits=true;pdfViewerDirty=true;pdfEditRevision+=1;
    if(!wasDirty) updateAnnotationStatus("필기 변경됨 · 제출할 때 함께 저장합니다.");
  }
  function startPdfViewerProbe(generation){
    clearInterval(pdfViewerProbeHandle);pdfViewerProbeHandle=null;pdfViewerStorageSignature=null;
    const probe=()=>{
      if(generation!==pdfViewerGeneration){clearInterval(pdfViewerProbeHandle);pdfViewerProbeHandle=null;return;}
      try{
        const documentProxy=el("problemPdfFrame")?.contentWindow?.PDFViewerApplication?.pdfDocument;
        if(!documentProxy) return;
        if(!pdfViewerReady) markPdfViewerReady();
        const storage=documentProxy.annotationStorage;
        const signature=`${storage?.size||0}:${storage?.serializable?.hash||""}`;
        if(pdfViewerStorageSignature===null) pdfViewerStorageSignature=signature;
        else if(signature!==pdfViewerStorageSignature){pdfViewerStorageSignature=signature;markPdfViewerDirty();}
      }catch(error){ /* 원본 PDF 대체 화면처럼 다른 출처인 경우에는 메시지 브리지를 사용합니다. */ }
    };
    pdfViewerProbeHandle=setInterval(probe,350);probe();
  }
  function waitForPdfViewer(timeout=12000){
    if(pdfViewerReady) return Promise.resolve(true);
    return new Promise((resolve,reject)=>{
      const waiter={resolve,reject,timer:null};
      waiter.timer=setTimeout(()=>{pdfReadyWaiters.delete(waiter);reject(new Error("PDF 편집기가 아직 준비되지 않았습니다."));},timeout);
      pdfReadyWaiters.add(waiter);
    });
  }
  function savePracticeDraft(){
    if(mode!=="start"||isCsatSession||!paper) return;
    practiceDraftKey=practiceDraftKey||practiceDraftId();
    try{
      localStorage.setItem(practiceDraftKey,JSON.stringify({version:3,paperId:paper.id,updatedAt:Date.now(),answers:draftAnswers,currentQuestionIndex,skippedQuestions:[...skippedQuestions],annotations:cloneAnnotations(),annotatedPdfKey:savedPdfStorageKey(),hasAnnotations:currentHasAnnotations()}));
    }catch(error){ updateAnnotationStatus("저장 공간 부족 · 제출 시 다시 시도",true); }
  }
  function loadPracticeDraft(){
    if(mode!=="start"||isCsatSession||!paper) return null;
    practiceDraftKey=practiceDraftId();
    try{
      const saved=JSON.parse(localStorage.getItem(practiceDraftKey)||"null");
      return saved?.paperId===paper.id?saved:null;
    }catch(error){ return null; }
  }
  function persistAnnotationDraft(){
    if(mode==="review") return;
    if(isCsatSession&&currentSessionStage()?.type==="exam"&&sessionData?.activeSectionId){
      const state=sessionSectionState(sessionData.activeSectionId);
      state.annotations=cloneAnnotations();state.annotatedPdfKey=savedPdfStorageKey();state.hasAnnotations=currentHasAnnotations();state.skippedQuestions=[...skippedQuestions];state.updatedAt=Date.now();persistSession();
    }else savePracticeDraft();
  }
  async function flushAnnotationSave(targetKey=activePdfStorageKey){
    let saved=!activePdfHasEdits;
    if(activePdfHasEdits){
      try{ saved=await persistPdfEdits(true,targetKey); }
      catch(error){ console.warn("PDF 필기 최종 저장 실패",error);updateAnnotationStatus("필기 저장 실패 · 기존 저장본 사용",true); }
    }
    persistAnnotationDraft();
    return saved;
  }

  async function requestPdfExport(storageKey){
    const frame=el("problemPdfFrame");
    if(!frame?.contentWindow) return Promise.reject(new Error("PDF 편집기 창을 찾지 못했습니다."));
    try{
      const app=frame.contentWindow.PDFViewerApplication;
      const documentProxy=app?.pdfDocument;
      if(documentProxy){
        app.pdfViewer?._layerProperties?.annotationEditorUIManager?.unselectAll?.();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const data=await documentProxy.saveDocument();
        const buffer=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
        await writeStoredPdf(storageKey,buffer);
        return {storageKey:String(storageKey),revision:pdfEditRevision,annotationCount:Number(documentProxy.annotationStorage?.size)||0};
      }
    }catch(error){ console.warn("PDF 직접 저장을 사용할 수 없어 메시지 저장으로 전환합니다.",error); }
    const requestId=`pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{
        pdfExportRequests.delete(requestId);
        reject(new Error("PDF 필기 저장 응답 시간이 초과되었습니다."));
      },18000);
      pdfExportRequests.set(requestId,{resolve,reject,timeout,storageKey:String(storageKey),revision:pdfEditRevision,generation:pdfViewerGeneration});
      frame.contentWindow.postMessage({type:"study-pdf-export",requestId},location.origin);
    });
  }
  async function persistPdfEdits(force=false,targetKey=activePdfStorageKey){
    if(!activePdfHasEdits||!targetKey) return false;
    if(!pdfViewerDirty&&!force){persistAnnotationDraft();return true;}
    const task=pdfExportQueue.catch(()=>false).then(async()=>{
      pdfExportInProgress+=1;
      try{
        await waitForPdfViewer();
        updateAnnotationStatus("편집한 PDF 저장 중…",true);
        const result=await requestPdfExport(targetKey);
        if(result.revision===pdfEditRevision) pdfViewerDirty=false;
        if(String(targetKey)===String(activePdfStorageKey)){persistedPdfStorageKey=String(targetKey);persistAnnotationDraft();}
        const savedCount=Number(result.annotationCount)||0;
        updateAnnotationStatus(`${mode==="review"?"저장된 필기 PDF · 변경 내용 저장됨":"편집한 PDF 저장됨"}${savedCount?` · 필기 ${savedCount}개`:""}`);
        return true;
      }finally{ pdfExportInProgress=Math.max(0,pdfExportInProgress-1); }
    });
    pdfExportQueue=task.catch(()=>false);
    return task;
  }
  async function finalizePdfForResult(finalKey){
    if(!activePdfHasEdits||!finalKey) return null;
    const previousKey=persistedPdfStorageKey||activePdfStorageKey;
    let stored=false;
    try{ stored=await persistPdfEdits(true,finalKey); }
    catch(error){
      console.warn("제출용 PDF 내보내기 실패",error);
      try{ stored=await copyStoredPdf(previousKey,finalKey); }catch(copyError){ console.warn("기존 저장 PDF 복사 실패",copyError); }
    }
    if(stored){activePdfStorageKey=String(finalKey);persistedPdfStorageKey=activePdfStorageKey;activePdfHasEdits=true;persistAnnotationDraft();return activePdfStorageKey;}
    try{
      const previous=await readStoredPdf(previousKey);
      return previous?.blob?previousKey:null;
    }catch(error){ return null; }
  }

  function destroyPdfView(){
    pdfViewerGeneration+=1;pdfViewerReady=false;pdfViewerDirty=false;
    clearTimeout(pdfViewerReadyTimeout);pdfViewerReadyTimeout=null;
    clearInterval(pdfViewerProbeHandle);pdfViewerProbeHandle=null;pdfViewerStorageSignature=null;
    pdfReadyWaiters.forEach(waiter=>{clearTimeout(waiter.timer);waiter.reject(new Error("PDF 문서가 변경되었습니다."));});pdfReadyWaiters.clear();
    pdfExportRequests.forEach(request=>{clearTimeout(request.timeout);request.reject(new Error("PDF 문서가 변경되었습니다."));});pdfExportRequests.clear();
    if(pdfViewerObjectUrl){URL.revokeObjectURL(pdfViewerObjectUrl);pdfViewerObjectUrl="";}
    const frame=el("problemPdfFrame");if(frame) frame.src="about:blank";
    el("pdfDocumentError")?.classList.add("hidden");
  }
  function showPdfFallback(error){
    const rawUrl=paperUrl("question");
    el("pdfDocumentLoading")?.classList.add("hidden");
    const frame=el("problemPdfFrame");if(frame&&rawUrl) frame.src=withPdfView(rawUrl,1);
    const detail=String(error?.message||"").trim();
    const message=rawUrl
      ?"PDF 편집기를 불러오지 못해 원본 PDF 보기로 전환했습니다. 아래 버튼으로 편집 화면을 다시 시도할 수 있습니다."
      :"문제 PDF 파일의 경로를 찾지 못했습니다. 메인 화면에서 다른 회차를 선택해 주세요.";
    if(el("pdfDocumentErrorText")) el("pdfDocumentErrorText").textContent=detail?`${message} (${detail})`:message;
    el("pdfDocumentError")?.classList.remove("hidden");
    updateAnnotationStatus(rawUrl?"원본 PDF 표시 중 · 편집기 재시도 가능":"문제 PDF 경로 없음",true);
  }
  async function renderPdfViewer(){
    destroyPdfView();
    const generation=pdfViewerGeneration;
    el("pdfDocumentLoading")?.classList.remove("hidden");el("pdfDocumentError")?.classList.add("hidden");
    updateAnnotationStatus("필기 가능한 전체 PDF를 불러오는 중…",true);
    try{
      const rawUrl=paperUrl("question");
      if(!rawUrl) throw new Error("문제 PDF 경로가 없습니다.");
      let sourceUrl=rawUrl;
      if(persistedPdfStorageKey){
        const stored=await readStoredPdf(persistedPdfStorageKey);
        if(generation!==pdfViewerGeneration) return;
        if(stored?.blob){
          pdfViewerObjectUrl=URL.createObjectURL(stored.blob);
          sourceUrl=pdfViewerObjectUrl;
          activePdfHasEdits=true;
        }
      }
      if(generation!==pdfViewerGeneration) return;
      const viewer=pdfViewerUrl(sourceUrl);
      el("problemPdfFrame").src=viewer;
      el("openProblemPdfBtn").href=viewer;
      startPdfViewerProbe(generation);
      pdfViewerReadyTimeout=setTimeout(()=>{
        if(generation===pdfViewerGeneration&&!pdfViewerReady) showPdfFallback(new Error("PDF 편집기 준비 시간이 초과되었습니다."));
      },25000);
    }catch(error){
      if(generation!==pdfViewerGeneration) return;
      console.warn("PDF 편집기를 불러오지 못했습니다.",error);showPdfFallback(error);
    }
  }

  async function handlePdfViewerMessage(event){
    const frame=el("problemPdfFrame");
    if(event.origin!==location.origin||event.source!==frame?.contentWindow) return;
    const message=event.data||{};
    if(message.type==="study-pdf-ready"){
      markPdfViewerReady();
      return;
    }
    if(message.type==="study-pdf-dirty"){
      markPdfViewerDirty();return;
    }
    if(message.type!=="study-pdf-exported"&&message.type!=="study-pdf-export-error") return;
    const request=pdfExportRequests.get(String(message.requestId||""));
    if(!request) return;
    pdfExportRequests.delete(String(message.requestId));clearTimeout(request.timeout);
    if(message.type==="study-pdf-export-error"){
      request.reject(new Error(String(message.message||"PDF 필기를 저장하지 못했습니다.")));return;
    }
    try{
      if(request.generation!==pdfViewerGeneration) throw new Error("다른 PDF로 전환되어 저장을 취소했습니다.");
      const buffer=message.buffer instanceof ArrayBuffer?message.buffer:message.buffer?.buffer;
      if(!(buffer instanceof ArrayBuffer)||!buffer.byteLength) throw new Error("PDF 편집 데이터가 비어 있습니다.");
      await writeStoredPdf(request.storageKey,buffer);
      activePdfHasEdits=true;
      request.resolve({storageKey:request.storageKey,revision:request.revision,annotationCount:Number(message.annotationCount)||0});
    }catch(error){ request.reject(error); }
  }

  function sessionDurationSeconds(stage){
    if(isCsatSession&&qaSessionRequested){
      const overrides=sessionData?.qaDurations&&typeof sessionData.qaDurations==="object"?sessionData.qaDurations:{exam:5,break:3};
      const override=Number(overrides[stage?.id]??overrides[stage?.type]);
      if(Number.isFinite(override)&&override>0) return Math.max(1,Math.min(30,Math.round(override)));
    }
    return Math.max(1,Math.round(Number(stage?.durationSeconds)||Number(stage?.durationMinutes)*60||1));
  }
  function sessionSection(sectionId){
    return sessionData?.sections?.find(section=>String(section.id)===String(sectionId))||null;
  }
  function buildSessionStages(data){
    const storedExams=(Array.isArray(data?.stages)?data.stages:[]).filter(stage=>stage?.type==="exam"&&sessionSection(stage.sectionId));
    const exams=storedExams.length?storedExams:(data?.sections||[]).map(section=>({id:`exam-${section.id}`,type:"exam",sectionId:section.id,label:section.label||section.subject,durationMinutes:section.durationMinutes,durationSeconds:section.durationSeconds}));
    const stages=[];
    exams.forEach((stage,index)=>{
      const section=sessionSection(stage.sectionId);
      stages.push({...stage,id:String(stage.id||`exam-${stage.sectionId}`),type:"exam",label:section?.label||stage.label,durationSeconds:sessionDurationSeconds(stage)});
      if(index<exams.length-1) stages.push({id:`break-${stage.sectionId}-${index+1}`,type:"break",label:"중간 휴식",durationMinutes:10,durationSeconds:sessionDurationSeconds({type:"break",durationMinutes:10})});
    });
    return stages;
  }
  function sessionEntries(targetPaper){
    const count=Math.max(1,Number(targetPaper?.questionCount)||({"국어":45,"수학":30,"영어":45,"한국사":20,"사회탐구":20,"과학탐구":20,"직업탐구":20,"제2외국어·한문":30}[targetPaper?.area]||20));
    const entries=keyEntries(targetPaper?.answerKey,count,targetPaper,true);
    if(targetPaper?.area==="영어") entries.forEach(item=>{ if(item.number<18) item.correct=""; });
    return entries;
  }
  function gradeWithEntries(entries,answers){
    const verified=entries.filter(item=>item.correct);
    const wrong=[];
    let correctCount=0;
    verified.forEach(item=>{
      const mine=normalizeAnswer(answers?.[item.number]??answers?.[String(item.number)]??"");
      if(mine===item.correct) correctCount+=1;
      else wrong.push({number:item.number,mine,correct:item.correct});
    });
    return {
      correctCount,gradedCount:verified.length,total:verified.length,presentedTotal:entries.length,
      ungradedCount:Math.max(0,entries.length-verified.length),wrong,
      score:verified.length?Math.round(correctCount/verified.length*100):null
    };
  }
  function estimateGrade(score,gradedCount=0,presentedCount=0){
    if(!Number.isFinite(Number(score))||Number(gradedCount)<=0) return null;
    const coverage=Number(gradedCount)/Math.max(1,Number(presentedCount)||Number(gradedCount));
    if(coverage<.8) return null;
    const value=Number(score);
    if(value>=90) return 1;if(value>=80) return 2;if(value>=70) return 3;if(value>=60) return 4;
    if(value>=50) return 5;if(value>=40) return 6;if(value>=30) return 7;if(value>=20) return 8;return 9;
  }
  function haltInactiveSession(status="cancelled"){
    if(sessionInactive) return;
    sessionInactive=true;clearInterval(tickHandle);tickHandle=null;activeStartedAt=null;submitted=true;sessionTransitioning=false;
    if(sessionData) sessionData.status=status;
    showError(status==="completed"?"이 수능 모의 세션은 다른 창에서 이미 완료되었습니다. 대시보드에서 결과를 확인해 주세요.":"이미 취소되었거나 만료된 수능 모의 세션입니다. 메인 화면에서 새 세션을 시작해 주세요.");
  }
  function sessionStorageStatus(){
    if(!sessionStorageKey) return "";
    try{
      const raw=localStorage.getItem(sessionStorageKey);
      if(raw===null) return "expired";
      return String(JSON.parse(raw)?.status||"").toLowerCase();
    }catch(error){ return "expired"; }
  }
  function sessionCanWrite(){
    if(sessionInactive) return false;
    const storedStatus=sessionStorageStatus();
    if(storedStatus&&!activeSessionStatuses.has(storedStatus)){ haltInactiveSession(storedStatus);return false; }
    if(storedStatus==="completed"&&sessionData?.status!=="completed"){ haltInactiveSession("completed");return false; }
    return true;
  }
  function persistSession(){
    if(!sessionData||!sessionStorageKey||!sessionCanWrite()) return false;
    try{ sessionData.updatedAt=new Date().toISOString();localStorage.setItem(sessionStorageKey,JSON.stringify(sessionData));return true; }
    catch(error){ console.warn("수능 모의 세션 진행 상태를 저장하지 못했습니다.",error);return false; }
  }
  function postSessionMessage(type,extra={}){
    if(sessionInactive||!window.opener||window.opener.closed||!sessionData) return;
    window.opener.postMessage({type,context:"csat-session",sessionId:sessionData.id,stageIndex:sessionData.currentStageIndex,phaseIndex:sessionData.currentStageIndex,status:sessionData.status,label:stageDisplayName(currentSessionStage()),...extra},location.origin==="null"?"*":location.origin);
  }
  function currentSessionStage(){ return sessionStages[Number(sessionData?.currentStageIndex)||0]||null; }
  function nextSessionStage(fromIndex=Number(sessionData?.currentStageIndex)||0){
    return sessionStages[fromIndex+1]||null;
  }
  function stageDisplayName(stage){
    if(!stage) return "전체 일정 종료";
    if(stage.type==="exam") return sessionSection(stage.sectionId)?.label||stage.label||"영역 시험";
    return stage.label||"10분 휴식";
  }
  function sessionPeriodLabel(section=sessionSection(currentSessionStage()?.sectionId||sessionData?.activeSectionId)){
    const id=String(section?.id||"").toLowerCase();
    if(id==="korean") return "1교시 국어";
    if(id==="math") return "2교시 수학";
    if(id==="english") return "3교시 영어";
    if(id==="history") return "4교시 한국사";
    if(id==="inquiry1") return "4교시 탐구 제1선택";
    if(id==="inquiry2") return section?.singleInquiry?"4교시 탐구":"4교시 탐구 제2선택";
    if(id==="secondforeign"||id==="second-foreign") return "5교시 제2외국어·한문";
    return String(section?.label||section?.area||section?.subject||"영역 시험").split(" · ")[0];
  }
  function isActiveSessionExamView(){
    return isCsatSession&&mode==="start"&&currentSessionStage()?.type==="exam"&&!submitted;
  }
  function nextExamStage(fromIndex=Number(sessionData?.currentStageIndex)||0){
    return sessionStages.slice(fromIndex+1).find(stage=>stage.type==="exam")||null;
  }
  function renderSessionSchedule(){
    if(!isCsatSession||!sessionData) return;
    const current=Number(sessionData.currentStageIndex)||0;
    const stage=currentSessionStage();
    el("sessionScheduleBar").classList.toggle("hidden",isActiveSessionExamView());
    el("sessionScheduleList").innerHTML=sessionStages.map((stage,index)=>`<li class="session-stage-pill ${sessionData.status==="completed"||index<current?"completed":index===current?"current":""}"><b>${esc(stageDisplayName(stage))}</b><span>${stage.type==="exam"?"시험":"일정"} · ${Math.ceil(sessionDurationSeconds(stage)/60)}분</span></li>`).join("");
    el("sessionStageBadge").textContent=stage?.type==="exam"?"선택 과목 진행 중":"약 10분 휴식";
    el("sessionStageTitle").textContent=stageDisplayName(stage);
    const next=nextSessionStage(current);
    el("sessionNextStage").textContent=next?`다음 일정 · ${stageDisplayName(next)} (${Math.ceil(sessionDurationSeconds(next)/60)}분)`:"다음 일정 · 전체 결과 확인";
    setTimeout(()=>el("sessionScheduleList").querySelector(".current")?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"}),0);
  }
  function sessionSectionState(sectionId){
    sessionData.sectionStates=sessionData.sectionStates&&typeof sessionData.sectionStates==="object"?sessionData.sectionStates:{};
    const id=String(sectionId);
    if(!sessionData.sectionStates[id]) sessionData.sectionStates[id]={answers:{},annotations:{version:1,pages:{}},annotatedPdfKey:null,hasAnnotations:false,skippedQuestions:[],currentQuestionIndex:0,submitted:false,skipped:false};
    return sessionData.sectionStates[id];
  }
  function saveSessionDraft(){
    if(!isCsatSession||sessionInactive||currentSessionStage()?.type!=="exam"||!sessionData?.activeSectionId) return;
    const state=sessionSectionState(sessionData.activeSectionId);
    state.answers=collectAnswers();
    state.annotations=cloneAnnotations();
    state.annotatedPdfKey=savedPdfStorageKey();
    state.hasAnnotations=currentHasAnnotations();
    state.skippedQuestions=[...skippedQuestions];
    state.currentQuestionIndex=currentQuestionIndex;
    state.updatedAt=Date.now();
    persistSession();
  }
  function resetSessionPaperUi(){
    displayedResult=null;submitted=false;destroyPdfView();
    el("gradeSummary").classList.add("hidden");el("wrongAnswerGuide").classList.add("hidden");el("answerPdfSection").classList.add("hidden");el("submittedNavigation").classList.add("hidden");
    el("sessionBreakState").classList.add("hidden");el("sessionCompleteState").classList.add("hidden");
    el("finishExamBtn").classList.remove("hidden");el("closeReviewBtn").classList.add("hidden");
    el("finishExamBtn").textContent="영역 답안 제출·잠금";
    el("answerNotice").textContent="오른쪽의 독립 답안 영역에 입력하세요. 정답키 미검증 문항도 답안은 안전하게 저장됩니다.";
    el("examNotice").textContent="영역 제한시간은 창의 포커스와 무관하게 계속 흐르며, 이 창이 선택된 시간만 순수 공부시간으로 누적됩니다.";
  }
  function startSessionExamStage(stage){
    const section=sessionSection(stage.sectionId);
    const targetPaper=section&&Catalog?.getPaper?.(section.paperId);
    if(!section||!targetPaper){ showError(`${section?.label||"선택 영역"}에 연결된 문제 PDF를 찾지 못했습니다.`); return; }
    addElapsed();
    paper=targetPaper;config=sessionData.config||{};answerKey=sessionEntries(paper);
    if(!answerKey.length){ showError(`${section.label||paper.subject}의 문항 수를 확인하지 못했습니다.`); return; }
    const state=sessionSectionState(section.id);
    sessionData.activeSectionId=String(section.id);
    if(state.submitted){ void advanceSessionStage(false);return; }
    resetSessionPaperUi();
    annotations=cleanAnnotations(state.annotations);skippedQuestions=new Set((state.skippedQuestions||[]).map(Number));
    activePdfStorageKey=String(state.annotatedPdfKey||sessionPdfStorageId(section.id));persistedPdfStorageKey=String(state.annotatedPdfKey||"");activePdfHasEdits=!!state.annotatedPdfKey;
    try{ renderPaper(null,state.answers||{},Number(state.currentQuestionIndex)||0); }
    catch(error){ showError(error.message||"영역 문제를 불러오지 못했습니다."); return; }
    el("timeLabel").textContent="남은 시간";
    renderSessionSchedule();
    syncTimerState();
    updateSessionClock();
  }
  function renderSessionPauseStage(stage){
    addElapsed();submitted=true;activeStartedAt=null;destroyPdfView();document.body.classList.remove("solving");
    el("loadingState").classList.add("hidden");el("examWorkspace").classList.add("hidden");el("examFooter").classList.add("hidden");el("answerPdfSection").classList.add("hidden");el("submittedNavigation").classList.add("hidden");el("sessionCompleteState").classList.add("hidden");el("configSummary").classList.add("hidden");
    el("sessionBreakState").classList.remove("hidden");
    const names={break:"중간 휴식"};
    el("examModeBadge").textContent="수능 모의 전체 세션";
    el("examTitle").textContent=stageDisplayName(stage);
    el("examSubtitle").classList.remove("hidden");
    el("examSubtitle").textContent="약 10분 동안 쉬면서 다음 선택 과목을 준비하세요.";
    el("timeLabel").textContent=`${names[stage.type]||"중간 휴식"} 남은 시간`;
    el("sessionBreakTitle").textContent=stageDisplayName(stage);
    const nextExam=nextExamStage();
    el("sessionBreakNext").textContent=nextExam?`다음 시험 · ${stageDisplayName(nextExam)} · ${Math.ceil(sessionDurationSeconds(nextExam)/60)}분`:"이 일정이 끝나면 전체 결과가 표시됩니다.";
    el("skipBreakBtn").textContent="휴식 건너뛰기";
    el("skipBreakBtn").classList.toggle("hidden",stage.type!=="break");
    renderSessionSchedule();updateSessionClock();
  }
  function activateSessionStage(){
    if(sessionInactive) return;
    const stage=currentSessionStage();
    if(!stage){ completeSession(); return; }
    pendingConfirmAction="";el("confirmLayer").classList.add("hidden");
    sessionData.status="running";sessionData.currentStageType=stage.type;if(!persistSession()) return;postSessionMessage("csat-session-progress");
    if(stage.type==="exam") startSessionExamStage(stage); else renderSessionPauseStage(stage);
  }
  function finalizeSessionExamStage(stage,autoSubmitted=false){
    if(sessionInactive) return;
    const section=sessionSection(stage.sectionId);
    const targetPaper=section&&Catalog?.getPaper?.(section.paperId);
    if(!section||!targetPaper) return;
    const state=sessionSectionState(section.id);
    if(state.submitted) return;
    const entries=sessionEntries(targetPaper);
    const active=String(sessionData.activeSectionId||"")===String(section.id)&&paper?.id===targetPaper.id;
    const answers=active?collectAnswers():Object.fromEntries(entries.map(item=>[item.number,normalizeAnswer(state.answers?.[item.number]??"")]));
    state.answers=answers;state.currentQuestionIndex=active?currentQuestionIndex:Number(state.currentQuestionIndex)||0;
    if(active){state.annotations=cloneAnnotations();state.annotatedPdfKey=savedPdfStorageKey();state.hasAnnotations=currentHasAnnotations();state.skippedQuestions=[...skippedQuestions];}
    state.result=state.skipped
      ?{correctCount:0,gradedCount:0,total:0,presentedTotal:entries.length,ungradedCount:entries.length,wrong:[],score:null,skipped:true}
      :gradeWithEntries(entries,answers);
    state.answerKey=Object.fromEntries(entries.filter(item=>item.correct).map(item=>[item.number,item.correct]));
    state.paperSnapshot=paperSnapshot(targetPaper);state.submitted=true;state.autoSubmitted=!!autoSubmitted;state.completedAt=Date.now();
    persistSession();
  }
  function setSessionStageRuntime(index,startAt){
    const stage=sessionStages[index];
    sessionData.currentStageIndex=index;sessionData.currentStageType=stage?.type||null;sessionData.stageStartedAt=startAt;
    sessionData.stageEndsAt=stage?startAt+sessionDurationSeconds(stage)*1000:null;sessionData.status=stage?"running":"completed";
  }
  async function submitCurrentSessionSection(){
    if(sessionInactive) return;
    const stage=currentSessionStage();
    if(stage?.type!=="exam"||submitted) return;
    addElapsed();if(sessionInactive) return;await flushAnnotationSave();finalizeSessionExamStage(stage,false);submitted=true;if(!persistSession()) return;postSessionMessage("csat-session-progress",{sectionSubmitted:true});
    await advanceSessionStage(false);
  }
  async function skipCurrentSessionSubject(){
    if(sessionInactive||currentSessionStage()?.type!=="exam"||submitted) return;
    const state=sessionSectionState(sessionData.activeSectionId);state.skipped=true;state.skipReason="user";state.skippedAt=Date.now();
    await advanceSessionStage(false);
  }
  async function advanceSessionStage(autoExpired=false){
    if(sessionTransitioning||sessionInactive||!sessionData||sessionData.status==="completed") return;
    sessionTransitioning=true;addElapsed();
    const currentStage=currentSessionStage();
    if(currentStage?.type==="exam"&&!sessionSectionState(currentStage.sectionId).submitted) await flushAnnotationSave();
    if(sessionInactive){sessionTransitioning=false;return;}
    const ending=currentSessionStage();
    if(ending?.type==="exam") finalizeSessionExamStage(ending,autoExpired);
    if(sessionInactive){sessionTransitioning=false;return;}
    let cursor=autoExpired?Number(sessionData.stageEndsAt)||Date.now():Date.now();
    let index=(Number(sessionData.currentStageIndex)||0)+1;
    const now=Date.now();
    while(index<sessionStages.length){
      setSessionStageRuntime(index,cursor);
      const stage=sessionStages[index];
      if(Number(sessionData.stageEndsAt)>now){
        persistSession();sessionTransitioning=false;activateSessionStage();return;
      }
      if(stage.type==="exam") finalizeSessionExamStage(stage,true);
      if(sessionInactive){sessionTransitioning=false;return;}
      cursor=Number(sessionData.stageEndsAt)||cursor;index+=1;
    }
    sessionData.currentStageIndex=sessionStages.length;sessionData.stageStartedAt=null;sessionData.stageEndsAt=null;
    sessionTransitioning=false;completeSession();
  }
  function updateSessionClock(){
    if(sessionInactive||!sessionData||sessionData.status==="completed") return;
    const stage=currentSessionStage();
    if(!stage) return;
    const remaining=Math.max(0,Math.ceil((Number(sessionData.stageEndsAt)-Date.now())/1000));
    const text=formatTime(remaining);
    el("examTimer").textContent=text;el("sessionBreakTimer").textContent=text;if(el("panelExamTimer"))el("panelExamTimer").textContent=text;
    el("examTimer").parentElement.classList.toggle("countdown-urgent",stage.type==="exam"&&remaining<=300);
    el("panelExamTimer")?.parentElement?.classList.toggle("countdown-urgent",stage.type==="exam"&&remaining<=300);
    if(remaining<=0&&!sessionTransitioning) setTimeout(()=>{void advanceSessionStage(true);},0);
  }
  function sessionRecordsFromRuntime(){
    return (sessionData?.sections||[]).map(section=>{
      const state=sessionSectionState(section.id);
      const targetPaper=Catalog?.getPaper?.(section.paperId);
      return {sectionId:String(section.id),area:section.area,subject:section.subject,label:section.label||section.subject,paperId:section.paperId,paperTitle:targetPaper?.title||section.label,
        paperSnapshot:state.paperSnapshot||(targetPaper?paperSnapshot(targetPaper):null),answers:state.answers||{},answerKey:state.answerKey||{},annotations:cleanAnnotations(state.annotations),annotatedPdfKey:state.annotatedPdfKey||null,hasAnnotations:!!state.hasAnnotations||!!state.annotatedPdfKey||hasAnnotations(state.annotations),
        skippedQuestions:Array.isArray(state.skippedQuestions)?state.skippedQuestions:[],skipped:!!state.skipped,result:state.result||gradeWithEntries(targetPaper?sessionEntries(targetPaper):[],state.answers||{}),autoSubmitted:!!state.autoSubmitted};
    });
  }
  function recordsFromSavedSession(saved){
    const rich=Array.isArray(saved?.sessionSections)?saved.sessionSections:[];
    const sections=Array.isArray(saved?.sections)?saved.sections:[];
    const subjects=Array.isArray(saved?.subjects)?saved.subjects:[];
    const sectionResults=Array.isArray(saved?.sectionResults)?saved.sectionResults:[];
    const sources=rich.length?rich:sections.length?sections:subjects.length?subjects:sectionResults;
    const papers=Array.isArray(saved?.papers)?saved.papers:[];
    const savedAnswers=saved?.answers&&typeof saved.answers==="object"?saved.answers:{};
    return sources.map((source,index)=>{
      const sectionId=String(source?.sectionId??source?.id??`section-${index+1}`);
      const resultRecord=sectionResults.find(item=>String(item?.sectionId??item?.id??"")===sectionId)||sectionResults[index]||{};
      const resultSource=source?.result&&typeof source.result==="object"?source.result:resultRecord?.result&&typeof resultRecord.result==="object"?resultRecord.result:{...resultRecord,...source};
      const requestedPaperId=String(source?.paperId??resultRecord?.paperId??"");
      const listedPaper=papers.find(item=>String(item?.id??item?.paperId??item??"")===requestedPaperId)||papers[index]||null;
      const listedSnapshot=listedPaper&&typeof listedPaper==="object"?listedPaper:null;
      const sourceSnapshot=source?.paperSnapshot&&typeof source.paperSnapshot==="object"?source.paperSnapshot:null;
      const resolvedPaperId=requestedPaperId||String(sourceSnapshot?.id??listedSnapshot?.id??listedSnapshot?.paperId??"");
      const targetPaper=(resolvedPaperId&&Catalog?.getPaper?.(resolvedPaperId))||sourceSnapshot||listedSnapshot||null;
      const answers=source?.answers&&typeof source.answers==="object"?source.answers:resultRecord?.answers&&typeof resultRecord.answers==="object"?resultRecord.answers:savedAnswers[sectionId]&&typeof savedAnswers[sectionId]==="object"?savedAnswers[sectionId]:{};
      const presentedHint=Number(resultSource?.presentedTotal??resultSource?.presentedQuestionCount??resultSource?.totalQuestions??source?.questionCount??targetPaper?.questionCount)||0;
      const computed=targetPaper?gradeWithEntries(sessionEntries(targetPaper),answers):{correctCount:0,gradedCount:0,presentedTotal:presentedHint,ungradedCount:presentedHint,wrong:[],score:null};
      const gradedCount=Math.max(0,Number(resultSource?.gradedCount??resultSource?.gradedQuestionCount??computed.gradedCount)||0);
      const presentedTotal=Math.max(gradedCount,Number(resultSource?.presentedTotal??resultSource?.presentedQuestionCount??resultSource?.totalQuestions??computed.presentedTotal)||0);
      const correctCount=Math.max(0,Number(resultSource?.correctCount??computed.correctCount)||0);
      const wrong=Array.isArray(resultSource?.wrong)?resultSource.wrong:computed.wrong;
      const storedScore=resultSource?.score;
      const score=storedScore===null||storedScore===undefined||storedScore===""?(gradedCount?Math.round(correctCount/gradedCount*100):null):Number(storedScore);
      return {
        sectionId,area:source?.area||resultRecord?.area||targetPaper?.area||"",subject:source?.subject||resultRecord?.subject||targetPaper?.subject||"",
        label:source?.label||resultRecord?.label||source?.subject||targetPaper?.subject||`영역 ${index+1}`,
        paperId:resolvedPaperId,paperTitle:source?.paperTitle||resultRecord?.paperTitle||targetPaper?.title||"",paperSnapshot:sourceSnapshot||listedSnapshot||(targetPaper?paperSnapshot(targetPaper):null),
        answers,answerKey:source?.answerKey||resultRecord?.answerKey||{},annotations:cleanAnnotations(source?.annotations||resultRecord?.annotations),annotatedPdfKey:source?.annotatedPdfKey||resultRecord?.annotatedPdfKey||null,hasAnnotations:!!(source?.hasAnnotations||resultRecord?.hasAnnotations||source?.annotatedPdfKey||resultRecord?.annotatedPdfKey||hasAnnotations(source?.annotations||resultRecord?.annotations)),
        skippedQuestions:Array.isArray(source?.skippedQuestions)?source.skippedQuestions:Array.isArray(resultRecord?.skippedQuestions)?resultRecord.skippedQuestions:[],skipped:!!(source?.skipped||resultRecord?.skipped||resultSource?.skipped),autoSubmitted:!!(source?.autoSubmitted||resultRecord?.autoSubmitted),
        result:{...resultSource,correctCount,gradedCount,total:gradedCount,presentedTotal,ungradedCount:Math.max(0,Number(resultSource?.ungradedCount??(presentedTotal-gradedCount))||0),wrong,score}
      };
    });
  }
  function saveSessionOverallResult(records){
    if(!sessionCanWrite()) return null;
    if(sessionData.resultId) return Number(sessionData.resultId);
    const graded=records.reduce((sum,item)=>sum+Number(item.result?.gradedCount||0),0);
    const correct=records.reduce((sum,item)=>sum+Number(item.result?.correctCount||0),0);
    const presented=records.reduce((sum,item)=>sum+Number(item.result?.presentedTotal||0),0);
    const wrongCount=records.reduce((sum,item)=>sum+Number(item.result?.wrong?.length||0),0);
    const score=graded?Math.round(correct/graded*100):null;
    const resultGrade=estimateGrade(score,graded,presented);
    const sectionGrades=records.map(item=>estimateGrade(item.result?.score,item.result?.gradedCount,item.result?.presentedTotal)).filter(Number.isFinite);
    const averageGrade=sectionGrades.length?Number((sectionGrades.reduce((sum,value)=>sum+value,0)/sectionGrades.length).toFixed(1)):null;
    const id=Date.now();Store.reload();
    const record={id,date:Store.todayKey(),context:"csat-session",sessionType:"full-csat-mock",reviewType:"csat-session",sessionId:sessionData.id,subject:"수능 모의 전체 세션",score,averageScore:score,averageGrade,resultGrade,estimatedGrade:resultGrade,grade:resultGrade,gradeBasis:resultGrade?"검증 문항 정답률 기준 앱 예상":"부분 채점 또는 정답키 미검증",seconds:sessionSeconds,totalQuestions:presented,gradedQuestionCount:graded,correctCount:correct,wrongCount,
      wrong:records.flatMap(item=>(item.result?.wrong||[]).map(wrong=>`${item.label} ${wrong.number}`)),config:sessionData.config||{},sessionConfig:sessionData.config||{},schedule:sessionStages.map(stage=>({id:stage.id,type:stage.type,label:stageDisplayName(stage),durationSeconds:sessionDurationSeconds(stage),sectionId:stage.sectionId||null})),
      subjects:records.map(item=>({sectionId:item.sectionId,area:item.area,subject:item.subject,label:item.label,paperId:item.paperId,paperTitle:item.paperTitle,score:item.result?.score??null,resultGrade:estimateGrade(item.result?.score,item.result?.gradedCount,item.result?.presentedTotal),estimatedGrade:estimateGrade(item.result?.score,item.result?.gradedCount,item.result?.presentedTotal),skipped:!!item.skipped,hasAnnotations:!!item.hasAnnotations,correctCount:item.result?.correctCount||0,gradedQuestionCount:item.result?.gradedCount||0,presentedQuestionCount:item.result?.presentedTotal||0,wrong:(item.result?.wrong||[]).map(wrong=>String(wrong.number)),ungradedCount:item.result?.ungradedCount||0,explanation:item.skipped?"사용자가 과목을 건너뜀":item.result?.wrong?.length?"전체 종료 후 정답·해설 확인":"자동채점 오답 없음"})),
      sessionSections:records,
      sections:records.map(item=>({id:item.sectionId,area:item.area,subject:item.subject,label:item.label,paperId:item.paperId,paperTitle:item.paperTitle})),
      sectionResults:records.map(item=>({sectionId:item.sectionId,...item.result,autoSubmitted:item.autoSubmitted})),
      papers:records.map(item=>item.paperSnapshot).filter(Boolean),answers:Object.fromEntries(records.map(item=>[item.sectionId,item.answers])),
      targetUniversity:Store.state.target.university||"목표 대학 미설정",targetMajor:Store.state.target.majorInput||Store.state.target.major||"",targetGrade:Store.state.target.targetGrade,targetGap:null};
    if(!sessionCanWrite()) return null;
    Store.state.csatResults.unshift(record);Store.save();sessionData.resultId=id;
    if(persistSession()) return id;
    Store.reload();Store.state.csatResults=Store.state.csatResults.filter(item=>Number(item.id)!==id);Store.save();delete sessionData.resultId;return null;
  }
  function sessionAnswerUrl(record){
    const targetPaper=Catalog?.getPaper?.(record.paperId)||record.paperSnapshot;
    if(!targetPaper) return "";
    let url="";
    if(Catalog?.resolveUrl){ try{ url=Catalog.resolveUrl(targetPaper,"answer"); }catch(error){ url=""; } }
    if(!url&&targetPaper.answerPath) url=new URL(targetPaper.answerPath,location.href).href;
    return pdfViewerUrl(url,targetPaper.answerStartPage);
  }
  function openSessionAnswerRecord(record,scroll=true){
    const url=sessionAnswerUrl(record);if(!url) return;
    el("sessionAnswerTitle").textContent=`${record.label||record.subject} · 정답 및 해설`;
    const result=record.result||{};
    el("sessionAnswerNotice").textContent=result.ungradedCount?`자동채점 제외 ${result.ungradedCount}문항을 포함해 직접 확인하세요.`:`오답 ${result.wrong?.length||0}문항의 해설을 확인하세요.`;
    el("openSessionAnswerBtn").href=url;el("sessionAnswerPdfFrame").src=url;el("sessionAnswerReview").classList.remove("hidden");
    if(scroll) setTimeout(()=>el("sessionAnswerReview").scrollIntoView({behavior:"smooth",block:"start"}),100);
  }
  function openSessionProblemRecord(record){
    const targetPaper=restorePaper(record?.paperSnapshot||{id:record?.paperId});
    if(!targetPaper){showError("이 영역의 문제 PDF 정보를 찾지 못했습니다.");return;}
    paper=targetPaper;config={};annotations=cleanAnnotations(record.annotations);skippedQuestions=new Set((record.skippedQuestions||[]).map(Number));
    activePdfStorageKey=String(record.annotatedPdfKey||"");persistedPdfStorageKey=activePdfStorageKey;activePdfHasEdits=!!record.annotatedPdfKey;
    answerKey=sessionEntries(paper);displayedResult=record.result||gradeWithEntries(answerKey,record.answers||{});submitted=true;
    el("sessionCompleteState").classList.add("hidden");el("sessionScheduleBar").classList.add("hidden");el("sessionAnswerReview").classList.add("hidden");
    const storedGrade=record.resultGrade??record.estimatedGrade??record.grade??estimateGrade(displayedResult.score,displayedResult.gradedCount,displayedResult.presentedTotal);
    renderPaper({date:"",score:displayedResult.score,wrong:displayedResult.wrong||[],annotatedPdfKey:record.annotatedPdfKey||null,resultGrade:storedGrade},record.answers||{},0);
    showGrade(record.answers||{},displayedResult,{scroll:false,storedGrade});
    el("returnSessionResultsBtn").classList.remove("hidden");el("closeReviewBtn").classList.add("hidden");
  }
  function returnToSessionResults(){
    if(!sessionReviewRecords) return;
    destroyPdfView();document.body.classList.remove("solving");el("returnSessionResultsBtn").classList.add("hidden");renderSessionComplete(sessionReviewRecords,{...(sessionReviewOptions||{}),review:true});
  }
  function renderSessionComplete(records,options={}){
    sessionReviewRecords=records;sessionReviewOptions=options;
    addElapsed();clearInterval(tickHandle);submitted=true;destroyPdfView();document.body.classList.remove("solving");
    pendingConfirmAction="";el("confirmLayer").classList.add("hidden");
    el("loadingState").classList.add("hidden");el("examWorkspace").classList.add("hidden");el("examFooter").classList.add("hidden");el("answerPdfSection").classList.add("hidden");el("submittedNavigation").classList.add("hidden");el("sessionBreakState").classList.add("hidden");el("configSummary").classList.add("hidden");el("sessionAnswerReview").classList.add("hidden");el("sessionCompleteState").classList.remove("hidden");
    const graded=records.reduce((sum,item)=>sum+Number(item.result?.gradedCount||0),0),correct=records.reduce((sum,item)=>sum+Number(item.result?.correctCount||0),0),presented=records.reduce((sum,item)=>sum+Number(item.result?.presentedTotal||0),0),wrong=records.reduce((sum,item)=>sum+Number(item.result?.wrong?.length||0),0);
    const score=graded?Math.round(correct/graded*100):null;
    const overallGrade=estimateGrade(score,graded,presented);
    el("examModeBadge").textContent=options.review?"저장된 수능 모의 세션":"수능 모의 전체 세션";el("examTitle").textContent=options.review?"전체 세션 다시보기":"모든 시험 일정이 끝났습니다";el("examSubtitle").classList.remove("hidden");el("examSubtitle").textContent="영역별 자동채점 결과와 정답·해설 PDF를 확인하세요.";el("timeLabel").textContent=options.review?"순수 풀이시간":"전체 일정 종료";el("examTimer").textContent=options.review?formatTime(Number(options.seconds)||0):"완료";el("examTimer").parentElement.classList.remove("countdown-urgent");
    el("sessionOverallScore").textContent=graded?`자동채점 ${score}%${overallGrade?` · 정답률 기준 예상 ${overallGrade}등급`:""}`:`자동채점 대상 없음`;
    el("sessionCompleteDetail").textContent=`전체 ${presented}문항 · 자동채점 ${graded}문항 중 ${correct}문항 정답 · ${wrong}문항 오답 · 예상 등급은 검증 문항이 80% 이상일 때만 표시`;
    el("sessionResultCards").innerHTML=records.map((record,index)=>{
      const result=record.result||{},canOpen=!!sessionAnswerUrl(record),grade=estimateGrade(result.score,result.gradedCount,result.presentedTotal);
      const recordedAnswers=Object.entries(record.answers||{}).filter(([,value])=>normalizeAnswer(value)).map(([number,value])=>`<span><b>${esc(number)}번</b> ${esc(normalizeAnswer(value))}</span>`).join("");
      return `<article class="session-result-card"><h3>${esc(record.label||record.subject)}</h3><p class="session-paper-title">${esc(record.paperTitle||"")}</p><div class="session-result-stat"><b>${record.skipped?"과목 스킵":result.gradedCount?`${result.score}%`:"자동채점 없음"}</b><span>${record.skipped?"결과 평균에서 제외":result.gradedCount?`${result.correctCount}/${result.gradedCount} 정답 · 오답 ${result.wrong?.length||0}`:"검증 정답키 없음"}</span></div>${grade?`<p class="session-grade-estimate">정답률 기준 예상 ${grade}등급</p>`:""}${record.hasAnnotations?`<p class="session-grade-estimate">PDF 필기 저장됨</p>`:""}${result.ungradedCount&&!record.skipped?`<p class="session-ungraded">채점 제외 ${result.ungradedCount}문항 · 제출 답안과 정답지를 비교하세요</p>`:""}<details class="session-recorded-answers"><summary>제출 답안 보기 · ${Object.values(record.answers||{}).filter(value=>normalizeAnswer(value)).length}개 입력</summary><div>${recordedAnswers||"<em>입력한 답안이 없습니다.</em>"}</div></details><div class="session-result-actions"><button type="button" class="outline-link" data-session-problem="${index}">문제·필기 보기</button><button type="button" class="outline-link" data-session-answer="${index}" ${canOpen?"":"disabled"}>정답·해설 보기</button></div></article>`;
    }).join("");
    el("sessionResultCards").querySelectorAll("[data-session-problem]").forEach(button=>button.addEventListener("click",()=>openSessionProblemRecord(records[Number(button.dataset.sessionProblem)])));
    el("sessionResultCards").querySelectorAll("[data-session-answer]").forEach(button=>button.addEventListener("click",()=>openSessionAnswerRecord(records[Number(button.dataset.sessionAnswer)])));
    el("returnSessionResultsBtn")?.classList.add("hidden");
    if(isCsatSession&&sessionData){sessionData.currentStageIndex=sessionStages.length;renderSessionSchedule();}
  }
  function completeSession(){
    if(!sessionData||sessionInactive||!sessionCanWrite()) return;
    sessionData.status="completed";sessionData.completedAt=sessionData.completedAt||Date.now();sessionData.stageEndsAt=null;sessionData.currentStageType=null;
    const records=sessionRecordsFromRuntime();const resultId=saveSessionOverallResult(records);if(!resultId||!persistSession()) return;renderSessionComplete(records);postSessionMessage("csat-session-finished",{resultId,id:resultId});
  }
  function initSession(){
    const sessionId=String(boot.sessionId||params.get("session")||params.get("sessionId")||"").trim();
    if(!sessionId||sessionId.length>160){ showError("수능 모의 세션 식별자가 올바르지 않습니다."); return; }
    sessionStorageKey=`studyAppCsatSession:${sessionId}`;
    try{ sessionData=JSON.parse(localStorage.getItem(sessionStorageKey)||"null"); }catch(error){ sessionData=null; }
    if(!sessionData||!Array.isArray(sessionData.sections)||!sessionData.sections.length){ showError("저장된 수능 모의 세션 구성을 찾지 못했습니다. 메인 화면에서 다시 시작해 주세요."); return; }
    const storedStatus=String(sessionData.status||"ready").toLowerCase();
    if(!activeSessionStatuses.has(storedStatus)){
      showError("이미 취소되었거나 만료된 수능 모의 세션입니다. 메인 화면에서 새 세션을 시작해 주세요.");return;
    }
    sessionData.status=storedStatus;
    sessionData.id=String(sessionData.id||sessionId);sessionData.sectionStates=sessionData.sectionStates||{};sessionSeconds=Number(sessionData.focusedStudySeconds||0);config=sessionData.config||{};
    sessionStages=buildSessionStages(sessionData);
    if(!sessionStages.length){ showError("실행할 수능 모의 일정이 없습니다."); return; }
    if(sessionData.status==="completed"){
      renderSessionComplete(sessionRecordsFromRuntime(),{seconds:sessionSeconds});return;
    }
    const index=Math.max(0,Math.min(sessionStages.length-1,Number(sessionData.currentStageIndex)||0));
    sessionData.currentStageIndex=index;
    if(sessionData.status==="ready"||!Number(sessionData.stageEndsAt)){
      setSessionStageRuntime(index,Date.now());persistSession();activateSessionStage();
    }else if(Number(sessionData.stageEndsAt)<=Date.now()) void advanceSessionStage(true);
    else activateSessionStage();
    if(sessionData.status!=="completed"){ tickHandle=setInterval(updateTimer,250);updateSessionClock(); }
  }
  function readSavedResult(){
    Store.reload();
    const list=context==="csat"||context==="csat-session"?Store.state.csatResults:Store.state.problemResults;
    return list.find(item=>Number(item.id)===reviewId)||null;
  }
  function findPaper(){
    if(!Catalog) return null;
    const requestedId=String(boot.paperId||params.get("paper")||"");
    const subject=String(boot.subject||params.get("subject")||"확률과 통계");
    const area=String(boot.area||params.get("area")||"");
    const examType=String(boot.examType||params.get("examType")||"");
    const filters={subject};
    if(area) filters.area=area;
    if(examType) filters.examType=examType;
    if(requestedId){
      const requested=Catalog.getPaper(requestedId);
      if(isModernPaper(requested)) return requested;
    }
    const storageKey=`last_pdf_${context}_${area}_${subject}_${examType}`;
    const lastId=sessionStorage.getItem(storageKey);
    const modern=(Catalog.listPapers?.(filters)||[]).filter(item=>isModernPaper(item)&&item.answerPath&&Number(item.questionCount)>0);
    const automatic=modern.filter(item=>item.answerMode==="auto"&&Object.keys(item.answerKey||{}).length>0);
    const preferred=automatic.length?automatic:modern;
    const choices=lastId&&preferred.length>1?preferred.filter(item=>item.id!==lastId):preferred;
    const picked=choices[Math.floor(Math.random()*choices.length)]||null;
    if(picked) sessionStorage.setItem(storageKey,picked.id);
    return picked;
  }
  function restorePaper(snapshot){
    if(!snapshot) return null;
    const current=Catalog?.getPaper?.(snapshot.id||snapshot.paperId);
    const restored=current||snapshot;
    return isModernPaper(restored)?restored:null;
  }
  function showError(message){
    document.body.classList.remove("solving");destroyPdfView();
    el("loadingState").classList.add("hidden");
    el("examWorkspace").classList.add("hidden");
    el("examFooter").classList.add("hidden");
    el("sessionBreakState").classList.add("hidden");
    el("sessionCompleteState").classList.add("hidden");
    el("sessionScheduleBar").classList.add("hidden");
    el("answerPdfSection").classList.add("hidden");
    el("submittedNavigation").classList.add("hidden");
    el("examErrorMessage").textContent=message;
    el("examError").classList.remove("hidden");
  }
  function renderSummary(savedResult=null){
    const source=paper.examType||"기출";
    const form=paper.form?` · ${paper.form}`:"";
    const configText=context==="csat" && config && Object.keys(config).length
      ?`<span class="summary-dot"></span><b>선택 구성</b> ${esc([config.korean,config.math,...(config.inquiry||[])].filter(Boolean).join(" · "))}`:"";
    const englishText=paper.area==="영어"?`<span class="summary-dot"></span><b>음원 미포함</b> 독해 18~45번`:"";
    const verifiedCount=answerKey.filter(item=>item.correct).length;
    const gradingText=verifiedCount===answerKey.length?`자동채점 ${verifiedCount}문항`:`자동채점 ${verifiedCount}/${answerKey.length}문항 · 나머지 답안 저장`;
    el("configSummary").innerHTML=`<b>${esc(paper.area||"")} · ${esc(paper.subject||"")}</b><span class="summary-dot"></span>${esc(source)} · ${esc(paper.year||"")} ${paper.month?`${esc(paper.month)}월`:""}${esc(form)}${englishText}<span class="summary-dot"></span>${gradingText}<span class="summary-dot"></span>전체 PDF 보기 · PDF 자체 그리기 도구${configText}`;
    if(savedResult) el("configSummary").innerHTML+=`<span class="summary-dot"></span>저장일 ${esc(savedResult.date||"")}`;
  }
  function renderPaper(savedResult=null,initialAnswers=null,preferredQuestionIndex=0){
    const review=!!savedResult;
    const compactSession=isActiveSessionExamView();
    el("submittedNavigation").classList.add("hidden");
    document.body.classList.toggle("solving",!review&&!submitted);
    el("examModeBadge").textContent=review?"저장된 PDF·필기 다시보기":compactSession?"수능 모의 · 시험 진행 중":context==="csat"?"수능 구성 랜덤 기출":"과목별 랜덤 기출";
    el("examTitle").textContent=compactSession?sessionPeriodLabel():paper.title||`${paper.subject||""} 기출문제`;
    el("examSubtitle").classList.remove("hidden");
    const savedScore=savedResult?.score??savedResult?.averageScore;
    el("examSubtitle").textContent=review
      ?`${savedResult.date||"저장된 기록"} · ${Number.isFinite(Number(savedScore))?`정답률 ${Number(savedScore).toFixed(0)}%`:"직접 채점 기록"} · 저장 당시 필기 복원`
      :compactSession?"":paper.area==="영어"?`${paper.examType||"기출"} 전체 PDF · 듣기 음원 없이 독해 답안을 기록합니다.`:`${paper.examType||"기출"} 전체 PDF에 직접 필기하며 풉니다.`;
    el("examSubtitle").classList.toggle("hidden",compactSession);
    if(el("panelExamTitle")) el("panelExamTitle").textContent=compactSession?`${sessionPeriodLabel()} · ${paper.subject||paper.area}`:paper.title||"기출 문제 PDF";
    if(el("panelExamMeta")) el("panelExamMeta").textContent=`${paperOriginLabel()} · 전체 ${answerKey.length}문항 · PDF 자체 그리기 도구`;
    if(compactSession) el("configSummary").replaceChildren(); else renderSummary(savedResult);

    const problemUrl=paperUrl("question");
    if(!problemUrl) throw new Error("문제 PDF 경로가 없습니다.");
    el("openProblemPdfBtn").href=pdfViewerUrl(problemUrl);
    el("openAnswerPdfBtn").href=pdfViewerUrl(paperUrl("answer"),paper.answerStartPage);
    renderAnswerSheet(initialAnswers||savedResult?.answers||{},preferredQuestionIndex);

    el("loadingState").classList.add("hidden");
    el("configSummary").classList.toggle("hidden",compactSession);
    el("examWorkspace").classList.remove("hidden");
    el("examFooter").classList.remove("hidden");
    el("skipSubjectBtn").classList.toggle("hidden",!isActiveSessionExamView());
    updateAnnotationStatus(activePdfHasEdits?"저장된 필기 PDF를 불러오는 중…":"PDF 편집기를 불러오는 중…",true);
    void renderPdfViewer();
  }
  function renderAnswerSheet(savedAnswers={},preferredQuestionIndex=0){
    draftAnswers=Object.fromEntries(answerKey.map(({number})=>[number,normalizeAnswer(savedAnswers[number]??savedAnswers[String(number)]??"")]));
    currentQuestionIndex=Math.max(0,Math.min(answerKey.length-1,Number(preferredQuestionIndex)||0));
    if(savedAnswers && displayedResult?.wrong?.length){
      const firstWrong=Number(displayedResult.wrong[0]?.number);
      const found=answerKey.findIndex(item=>item.number===firstWrong);
      if(found>=0) currentQuestionIndex=found;
    }
    el("questionJumpSelect").innerHTML=answerKey.map(({number},index)=>`<option value="${index}">${number}번${draftAnswers[number]?" · 입력됨":skippedQuestions.has(Number(number))?" · 스킵":""}</option>`).join("");
    renderCurrentQuestion();
    updateProgress();
  }

  function currentKey(){ return answerKey[currentQuestionIndex]||answerKey[0]||null; }
  function renderSubmittedQuestionNav(){
    const nav=el("submittedQuestionNav");
    if(!nav) return;
    nav.innerHTML=answerKey.map(({number},index)=>`<button type="button" data-submitted-question="${index}" aria-label="${number}번 문제로 이동" ${index===currentQuestionIndex?'aria-current="page"':''}>${number}번</button>`).join("");
    nav.querySelectorAll("[data-submitted-question]").forEach(button=>button.addEventListener("click",()=>{
      goToQuestion(Number(button.dataset.submittedQuestion),{force:true});
      el("pdfDocumentViewport")?.scrollIntoView({behavior:"smooth",block:"start"});
    }));
  }
  function renderCurrentAnswer(){
    const item=currentKey();
    if(!item){ el("answerSheet").innerHTML=""; return; }
    const number=item.number;
    const value=normalizeAnswer(draftAnswers[number]||"");
    const objective=!isShortAnswerQuestion(number);
    const disabled=submitted||mode==="review";
    const mine=normalizeAnswer(draftAnswers[number]);
    const unverified=!item.correct;
    const isCorrect=displayedResult&&item.correct?mine===item.correct:null;
    const resultClass=unverified?" ungraded":isCorrect===null?"":isCorrect?" correct":" wrong";
    const control=objective
      ?`<select id="answer-${number}" data-answer-number="${number}" aria-label="${number}번 답" ${disabled?"disabled":""}><option value="">선택</option>${[1,2,3,4,5].map(choice=>`<option value="${choice}" ${value===String(choice)?"selected":""}>${choice}번</option>`).join("")}</select>`
      :`<input id="answer-${number}" data-answer-number="${number}" type="text" inputmode="numeric" maxlength="12" value="${esc(value)}" placeholder="숫자로 입력" aria-label="${number}번 답" ${disabled?"disabled":""}>`;
    el("currentAnswerTitle").textContent=`${number}번 답안`;
    const statusText=unverified?`<p class="answer-result-text ungraded">정답키 미검증 · 자동채점 제외 · 답안은 저장됩니다</p>`:displayedResult?`<p class="answer-result-text">${isCorrect?"정답입니다":`${mine?`내 답 ${esc(mine)}`:"미응답"} · 정답 ${esc(item.correct)}`}</p>`:"";
    el("answerSheet").innerHTML=`<div class="answer-cell current-answer-cell${resultClass}" data-answer-cell="${number}"><label for="answer-${number}">${number}</label>${control}${statusText}</div>`;
    const answerControl=el("answerSheet").querySelector("[data-answer-number]");
    if(answerControl){
      const save=()=>{
        draftAnswers[number]=normalizeAnswer(answerControl.value);
        if(draftAnswers[number]) skippedQuestions.delete(Number(number));
        updateProgress();
        updateJumpOptions();
        if(isCsatSession) saveSessionDraft(); else savePracticeDraft();
      };
      answerControl.addEventListener("input",save);
      answerControl.addEventListener("change",save);
      answerControl.addEventListener("keydown",event=>{
        if(event.key==="Enter" && currentQuestionIndex<answerKey.length-1){ event.preventDefault(); goToQuestion(currentQuestionIndex+1,{focusAnswer:true}); }
      });
    }
  }
  function updateJumpOptions(){
    Array.from(el("questionJumpSelect").options).forEach((option,index)=>{
      const item=answerKey[index];
      option.textContent=`${item.number}번${draftAnswers[item.number]?" · 입력됨":skippedQuestions.has(Number(item.number))?" · 스킵":""}`;
    });
  }
  function paperOriginLabel(){
    if(paper?.examType==="수능") return `${paper.year||"-"}학년도 수능`;
    return `${paper?.year||"-"}년${paper?.month?` ${paper.month}월`:""} ${paper?.examKind||paper?.examType||"기출"}`;
  }
  function renderCurrentQuestion(){
    const item=currentKey();
    if(!item) return;
    const position=currentQuestionIndex+1;
    const total=answerKey.length;
    el("currentQuestionLabel").textContent=`${item.number}번 문제`;
    el("currentQuestionMeta").textContent=`${position} / ${total}${skippedQuestions.has(Number(item.number))?" · 스킵됨":draftAnswers[item.number]?" · 답 입력됨":""}`;
    el("currentQuestionOrigin").textContent=`${paperOriginLabel()} · ${item.number}번 문제`;
    el("questionJumpSelect").value=String(currentQuestionIndex);
    el("questionProgressBar").style.width=`${Math.max(2,position/total*100)}%`;
    el("answerPreviousBtn").disabled=currentQuestionIndex===0;
    el("answerNextBtn").textContent=currentQuestionIndex===total-1?(submitted?"마지막 문제":"답안 제출"):(submitted?"다음 답안 →":"다음 →");
    el("answerNextBtn").disabled=submitted&&currentQuestionIndex===total-1;
    el("skipQuestionBtn").disabled=submitted||mode==="review";
    el("skipQuestionBtn").textContent=skippedQuestions.has(Number(item.number))?"스킵 해제":"문제 스킵";
    renderCurrentAnswer();
    renderSubmittedQuestionNav();
  }
  function goToQuestion(index,options={}){
    const next=Math.max(0,Math.min(answerKey.length-1,Number(index)||0));
    if(next===currentQuestionIndex && !options.force) return;
    currentQuestionIndex=next;
    renderCurrentQuestion();
    if(isCsatSession) saveSessionDraft(); else savePracticeDraft();
    if(options.focusAnswer) setTimeout(()=>el("answerSheet").querySelector("[data-answer-number]")?.focus(),0);
    if(options.scrollProblem) el("answerCard")?.scrollIntoView({behavior:"smooth",block:"nearest"});
  }
  function isShortAnswerQuestion(number){
    if(paper?.area!=="수학") return false;
    if(["확률과 통계","미적분","기하"].includes(paper.subject)) return (number>=16 && number<=22)||(number>=29 && number<=30);
    return !["1","2","3","4","5"].includes(answerKey.find(item=>item.number===number)?.correct||"");
  }
  function collectAnswers(){
    const control=el("answerSheet").querySelector("[data-answer-number]");
    if(control) draftAnswers[control.dataset.answerNumber]=normalizeAnswer(control.value);
    return Object.fromEntries(answerKey.map(({number})=>[number,normalizeAnswer(draftAnswers[number]||"")]));
  }
  function updateProgress(){
    const answers=collectAnswers();
    const completed=Object.values(answers).filter(Boolean).length;
    el("answerProgress").textContent=`입력 ${completed} · 스킵 ${skippedQuestions.size} / ${answerKey.length}`;
  }
  function grade(answers){
    return gradeWithEntries(answerKey,answers);
  }
  function paperSnapshot(targetPaper=paper){
    const snapshotPaper=targetPaper||paper;
    return {
      id:snapshotPaper.id,area:snapshotPaper.area,subject:snapshotPaper.subject,examType:snapshotPaper.examType,year:snapshotPaper.year,month:snapshotPaper.month,
      form:snapshotPaper.form,title:snapshotPaper.title,questionPath:snapshotPaper.questionPath,answerPath:snapshotPaper.answerPath,questionCount:snapshotPaper.questionCount,
      answerMode:snapshotPaper.answerMode,answerKey:snapshotPaper.answerKey,answerKeyScope:snapshotPaper.answerKeyScope||null,
      questionNumberStart:snapshotPaper.questionNumberStart||null,gradedQuestionCount:snapshotPaper.gradedQuestionCount||Object.keys(snapshotPaper.answerKey||{}).length,
      questionStartPage:snapshotPaper.questionStartPage||(snapshotPaper===paper?defaultProblemStartPage():null),answerStartPage:snapshotPaper.answerStartPage||null
    };
  }
  function saveResult(answers,result,id=Date.now(),annotatedPdfKey=null){
    Store.reload();
    const presented=Number(result.presentedTotal)||answerKey.length;
    const resultGrade=estimateGrade(result.score,result.gradedCount,presented);
    const annotationSnapshot=cloneAnnotations();
    const questionRecords=answerKey.map(item=>({number:item.number,year:paper.year,month:paper.month,examType:paper.examType,answer:answers[item.number]||"",correct:item.correct||"",skipped:skippedQuestions.has(Number(item.number)),outcome:!item.correct?"ungraded":normalizeAnswer(answers[item.number])===item.correct?"correct":"wrong"}));
    const common={
      id,date:Store.todayKey(),seconds:sessionSeconds,subject:paper.subject||paper.area||"기출문제",score:result.score,resultGrade,estimatedGrade:resultGrade,grade:resultGrade,
      gradeBasis:resultGrade?"검증 문항 정답률 기준 앱 예상":"부분 채점 또는 정답키 미검증",wrong:result.wrong.map(item=>String(item.number)),
      explanation:result.ungradedCount?"정답키 미검증 문항은 정답 PDF에서 직접 확인":result.wrong.length?"오답 정답·해설 PDF 연결됨":"전 문항 정답",
      paperId:paper.id,paperTitle:paper.title,paperSnapshot:paperSnapshot(),
      answers,answerKey:Object.fromEntries(answerKey.map(item=>[item.number,item.correct])),questionNumbers:answerKey.map(item=>item.number),annotations:annotationSnapshot,annotatedPdfKey:annotatedPdfKey||null,hasAnnotations:!!annotatedPdfKey||hasAnnotations(annotationSnapshot),skippedQuestions:[...skippedQuestions],questions:questionRecords,
      result:{correctCount:result.correctCount,gradedCount:result.gradedCount,total:result.total,presentedTotal:presented,ungradedCount:result.ungradedCount,wrong:result.wrong.map(item=>({...item})),score:result.score},
      totalQuestions:presented,gradedQuestionCount:result.gradedCount,ungradedCount:result.ungradedCount,correctCount:result.correctCount,examType:paper.examType,year:paper.year,month:paper.month,config
    };
    if(context==="csat"){
      Store.state.csatResults.unshift({
        ...common,subjects:[{subject:paper.subject||paper.area,score:result.score,grade:resultGrade,resultGrade,wrong:common.wrong,explanation:common.explanation}],
        averageGrade:resultGrade,averageScore:result.score,wrongCount:common.wrong.length,targetGap:null,
        targetUniversity:Store.state.target.university||"목표 대학 미설정",targetMajor:Store.state.target.majorInput||Store.state.target.major||"",targetGrade:Store.state.target.targetGrade
      });
    }else Store.state.problemResults.unshift(common);
    Store.save();
    if(practiceDraftKey) localStorage.removeItem(practiceDraftKey);
    return id;
  }
  function showGrade(answers,result,options={}){
    answerKey.forEach(({number})=>{ draftAnswers[number]=normalizeAnswer(answers[number]??answers[String(number)]??""); });
    displayedResult=result;
    submitted=true;
    result.wrong=Array.isArray(result.wrong)?result.wrong:[];
    const firstWrong=Number(result.wrong[0]?.number);
    const firstWrongIndex=answerKey.findIndex(item=>item.number===firstWrong);
    if(firstWrongIndex>=0) currentQuestionIndex=firstWrongIndex;
    renderCurrentQuestion();
    updateJumpOptions();
    const presented=Number(result.presentedTotal)||answerKey.length;
    const storedGrade=Number(options.storedGrade);
    const gradeValue=Number.isFinite(storedGrade)&&storedGrade>=1&&storedGrade<=9?storedGrade:estimateGrade(result.score,result.gradedCount,presented);
    el("gradePercent").textContent=Number.isFinite(Number(result.score))?`${result.score}%`:"직접 확인";
    el("gradeEstimate").textContent=gradeValue?`정답률 기준 예상 ${gradeValue}등급`:"등급 산출 불가";
    el("gradeHeadline").textContent=result.skipped?"이 과목을 건너뛰었습니다":!result.gradedCount?"정답 PDF에서 직접 채점하세요":result.wrong.length?`${result.wrong.length}문항을 다시 확인하세요`:"자동채점 문항을 모두 맞혔습니다";
    el("gradeDetail").textContent=result.skipped?"스킵한 과목은 전체 평균에서 제외됩니다.":`전체 ${presented}문항 · 자동채점 ${result.gradedCount||0}문항 중 ${result.correctCount||0}문항 정답${result.ungradedCount?` · 직접 확인 ${result.ungradedCount}문항`:""}`;
    if(el("gradeCutGuide")) el("gradeCutGuide").textContent="앱 예상 등급 기준(공식 등급컷 아님) · 1등급 90%↑ · 2등급 80%↑ · 이후 10%p 단위";
    el("gradeSummary").classList.toggle("has-wrong",result.wrong.length>0);
    el("gradeSummary").classList.remove("hidden");
    el("answerNotice").textContent="제출 당시 답안과 저장된 필기입니다. PDF는 전체 형태로 그대로 볼 수 있습니다.";

    if(result.wrong.length){
      el("wrongAnswerList").innerHTML=result.wrong.map(item=>`<button class="wrong-chip" type="button" data-go-question="${item.number}"><b>${item.number}번</b> ${item.mine?`내 답 ${esc(item.mine)}`:"미응답"} → 정답 ${esc(item.correct)}</button>`).join("");
      el("wrongAnswerList").querySelectorAll("[data-go-question]").forEach(button=>button.addEventListener("click",()=>{
        const index=answerKey.findIndex(item=>item.number===Number(button.dataset.goQuestion));
        if(index>=0) goToQuestion(index,{scrollProblem:true,force:true});
      }));
      el("wrongAnswerGuide").classList.remove("hidden");
    }
    const answerUrl=paperUrl("answer");
    el("goToAnswerPdfBtn").disabled=!answerUrl;
    el("submittedNavigation").classList.remove("hidden");
    if(answerUrl){
      el("answerPdfFrame").src=pdfViewerUrl(answerUrl,paper.answerStartPage);
      el("answerPdfSection").classList.remove("hidden");
      if(options.scroll!==false) setTimeout(()=>el("submittedNavigation").scrollIntoView({behavior:"smooth",block:"start"}),180);
    }
    document.body.classList.remove("solving");
    el("finishExamBtn").classList.add("hidden");
    el("closeReviewBtn").classList.remove("hidden");
    el("examNotice").textContent=result.wrong.length||result.ungradedCount?"정답·해설 PDF에서 오답과 미검증 문항을 확인하세요.":"자동채점 문항을 모두 맞혔습니다.";
  }
  async function finishExam(){
    if(submitted) return;
    submitted=true;
    el("finishExamBtn").disabled=true;
    updateAnnotationStatus(activePdfHasEdits?"PDF 필기를 저장한 뒤 채점합니다…":"답안을 채점하고 있습니다…",true);
    addElapsed();
    clearInterval(tickHandle);
    const answers=collectAnswers();
    const result=grade(answers);
    const id=Date.now();
    const annotatedPdfKey=await finalizePdfForResult(`result:${id}`);
    saveResult(answers,result,id,annotatedPdfKey);
    showGrade(answers,result,{storedGrade:estimateGrade(result.score,result.gradedCount,result.presentedTotal)});
    if(window.opener && !window.opener.closed) window.opener.postMessage({type:"pdf-exam-finished",context,id},location.origin==="null"?"*":location.origin);
  }
  function loadReview(){
    const saved=readSavedResult();
    if(!saved){ showError("저장된 풀이 기록을 찾지 못했습니다. 대시보드에서 다시 열어 주세요."); return; }
    const fullSession=!!saved.sessionId||saved.sessionType==="full-csat-mock"||saved.reviewType==="csat-session"||saved.context==="csat-session"||Array.isArray(saved.sessionSections)||Array.isArray(saved.sections)||Array.isArray(saved.sectionResults);
    if(fullSession){
      const records=recordsFromSavedSession(saved);
      if(!records.length){ showError("저장된 전체 세션의 영역별 결과를 읽지 못했습니다."); return; }
      sessionSeconds=Number(saved.seconds||0);renderSessionComplete(records,{review:true,seconds:sessionSeconds});return;
    }
    config=saved.config||{};
    paper=restorePaper(saved.paperSnapshot||{id:saved.paperId});
    if(!paper){ showError("이 기록에 연결된 PDF 정보를 찾지 못했습니다."); return; }
    answerKey=keyEntries(saved.answerKey||paper.answerKey,saved.totalQuestions||paper.questionCount,paper,true);
    if(!answerKey.length){ showError("저장된 기록의 정답 키를 읽지 못했습니다."); return; }
    annotations=cleanAnnotations(saved.annotations);skippedQuestions=new Set((saved.skippedQuestions||[]).map(Number));
    activePdfStorageKey=String(saved.annotatedPdfKey||"");persistedPdfStorageKey=activePdfStorageKey;activePdfHasEdits=!!saved.annotatedPdfKey;
    sessionSeconds=Number(saved.seconds||0);
    el("timeLabel").textContent="풀이시간";
    el("examTimer").textContent=formatTime(sessionSeconds);if(el("panelExamTimer"))el("panelExamTimer").textContent=formatTime(sessionSeconds);
    renderPaper(saved);
    const answers=saved.answers||{};
    const computed=grade(answers);
    const stored=saved.result&&typeof saved.result==="object"?saved.result:null;
    const result=stored?{
      ...computed,...stored,
      wrong:Array.isArray(stored.wrong)?stored.wrong:computed.wrong,
      presentedTotal:Number(stored.presentedTotal)||Number(saved.totalQuestions)||computed.presentedTotal,
      gradedCount:Number(stored.gradedCount??saved.gradedQuestionCount??computed.gradedCount),
      correctCount:Number(stored.correctCount??saved.correctCount??computed.correctCount),
      ungradedCount:Number(stored.ungradedCount??saved.ungradedCount??computed.ungradedCount),
      score:stored.score??saved.score??computed.score
    }:computed;
    if(result.score===null&&Number.isFinite(Number(saved.score))) result.score=Number(saved.score);
    showGrade(answers,result,{scroll:false,storedGrade:saved.resultGrade??saved.estimatedGrade??saved.grade});
  }
  function initStart(){
    parseConfig();
    paper=findPaper();
    if(!paper){ showError("선택한 과목에서 2022년도 이후 문제·정답 PDF를 찾지 못했습니다."); return; }
    answerKey=keyEntries(paper.answerKey,paper.questionCount,paper,paper.answerMode!=="auto");
    if(!answerKey.length){ showError("이 PDF의 문항 수를 확인하지 못했습니다."); return; }
    const draft=loadPracticeDraft();
    if(draft){annotations=cleanAnnotations(draft.annotations);skippedQuestions=new Set((draft.skippedQuestions||[]).map(Number));}
    else{annotations={version:1,pages:{}};skippedQuestions=new Set();}
    activePdfStorageKey=String(draft?.annotatedPdfKey||practicePdfStorageId());persistedPdfStorageKey=String(draft?.annotatedPdfKey||"");activePdfHasEdits=!!draft?.annotatedPdfKey;
    try{ renderPaper(null,draft?.answers||{},Number(draft?.currentQuestionIndex)||0); }catch(error){ showError(error.message||"PDF 정보를 불러오지 못했습니다."); return; }
    syncTimerState();
    tickHandle=setInterval(updateTimer,250);
    updateTimer();
  }
  function setupEvents(){
    window.addEventListener("message",event=>{void handlePdfViewerMessage(event);});
    el("openProblemPdfBtn").addEventListener("click",event=>openPdfInLargePopup(event,"studyAppProblemPdf"));
    el("openAnswerPdfBtn").addEventListener("click",event=>openPdfInLargePopup(event,"studyAppAnswerPdf"));
    el("openSessionAnswerBtn").addEventListener("click",event=>openPdfInLargePopup(event,"studyAppSessionAnswerPdf"));
    el("goToAnswerPdfBtn").addEventListener("click",()=>{
      const section=el("answerPdfSection");
      if(!section.classList.contains("hidden")) section.scrollIntoView({behavior:"smooth",block:"start"});
    });
    el("answerPreviousBtn").addEventListener("click",()=>goToQuestion(currentQuestionIndex-1,{focusAnswer:true}));
    el("answerNextBtn").addEventListener("click",()=>{
      if(currentQuestionIndex<answerKey.length-1) goToQuestion(currentQuestionIndex+1,{focusAnswer:true});
      else if(!submitted) el("finishExamBtn").click();
    });
    el("questionJumpSelect").addEventListener("change",event=>goToQuestion(Number(event.target.value),{focusAnswer:true}));
    el("skipQuestionBtn").addEventListener("click",()=>{
      if(submitted) return;
      const number=Number(currentKey()?.number);if(!number) return;
      if(skippedQuestions.has(number)) skippedQuestions.delete(number);else skippedQuestions.add(number);
      updateJumpOptions();renderCurrentQuestion();updateProgress();
      if(isCsatSession) saveSessionDraft();else savePracticeDraft();
      if(skippedQuestions.has(number)&&currentQuestionIndex<answerKey.length-1) setTimeout(()=>goToQuestion(currentQuestionIndex+1),90);
    });
    el("retryPdfRenderBtn").addEventListener("click",()=>{
      void renderPdfViewer();
    });
    el("skipSubjectBtn").addEventListener("click",()=>{
      if(!isActiveSessionExamView())return;
      pendingConfirmAction="skip-subject";el("confirmTitle").textContent="이 과목을 건너뛸까요?";el("confirmMessage").textContent="현재 답안과 필기는 저장되지만 이 과목은 결과 평균에서 제외되고 다음 10분 휴식 또는 과목으로 이동합니다.";el("confirmFinishBtn").textContent="과목 스킵";el("confirmLayer").classList.remove("hidden");
    });
    el("toggleAnswerPanelBtn").addEventListener("click",()=>{
      const collapsed=el("answerCard").classList.toggle("collapsed");
      el("toggleAnswerPanelBtn").textContent=collapsed?"+":"−";el("toggleAnswerPanelBtn").setAttribute("aria-expanded",String(!collapsed));el("toggleAnswerPanelBtn").setAttribute("aria-label",collapsed?"답안 패널 열기":"답안 패널 접기");
    });
    el("finishExamBtn").addEventListener("click",()=>{
      const blank=answerKey.length-Object.values(collectAnswers()).filter(Boolean).length;
      if(isCsatSession){
        pendingConfirmAction="submit-session";el("confirmTitle").textContent="이 영역 답안을 제출할까요?";el("confirmMessage").textContent=`미응답 ${blank}문항이 있습니다. 답안과 필기를 저장하고 다음 10분 휴식 또는 과목으로 이동합니다.`;el("confirmFinishBtn").textContent="제출하고 다음으로";
      }else{
        pendingConfirmAction="finish-exam";el("confirmTitle").textContent="답안을 제출할까요?";el("confirmMessage").textContent=blank?`미응답 ${blank}문항도 오답으로 채점됩니다. 정답키 미검증 문항은 정답 PDF에서 직접 확인합니다.`:"답안과 PDF 필기를 함께 저장하고 채점합니다.";el("confirmFinishBtn").textContent="제출하고 채점";
      }
      el("confirmLayer").classList.remove("hidden");
    });
    el("skipBreakBtn").addEventListener("click",()=>{
      pendingConfirmAction="skip-break";el("confirmTitle").textContent="10분 휴식을 건너뛸까요?";el("confirmMessage").textContent="바로 다음 선택 과목을 시작합니다.";el("confirmFinishBtn").textContent="휴식 건너뛰기";el("confirmLayer").classList.remove("hidden");
    });
    el("cancelFinishBtn").addEventListener("click",()=>{pendingConfirmAction="";el("confirmLayer").classList.add("hidden");});
    el("confirmFinishBtn").addEventListener("click",()=>{
      const action=pendingConfirmAction;pendingConfirmAction="";el("confirmLayer").classList.add("hidden");
      if(action==="submit-session")void submitCurrentSessionSection();else if(action==="skip-break"&&currentSessionStage()?.type==="break")void advanceSessionStage(false);else if(action==="skip-subject")void skipCurrentSessionSubject();else if(action==="finish-exam")void finishExam();
    });
    el("returnSessionResultsBtn").addEventListener("click",returnToSessionResults);
    el("closeReviewBtn").addEventListener("click",()=>window.close());el("closeSessionBtn").addEventListener("click",()=>window.close());el("closeErrorBtn").addEventListener("click",()=>window.close());
    document.addEventListener("visibilitychange",syncTimerState);window.addEventListener("focus",syncTimerState);window.addEventListener("blur",syncTimerState);
    window.addEventListener("storage",event=>{
      if(!isCsatSession||!sessionStorageKey||event.key!==sessionStorageKey)return;
      if(event.newValue===null){haltInactiveSession("expired");return;}
      try{const storedStatus=String(JSON.parse(event.newValue)?.status||"").toLowerCase();if(storedStatus&&!activeSessionStatuses.has(storedStatus))haltInactiveSession(storedStatus);else if(storedStatus==="completed"&&sessionData?.status!=="completed")haltInactiveSession("completed");}catch(error){haltInactiveSession("expired");}
    });
    window.addEventListener("beforeunload",event=>{
      if(mode==="start"&&!submitted){if(isCsatSession&&currentSessionStage()?.type==="exam")saveSessionDraft();else savePracticeDraft();addElapsed();}
      if(!submitted&&pdfViewerDirty){event.preventDefault();event.returnValue="";}
    });
  }
  function init(){
    setupEvents();
    if(!Catalog){ showError("PDF 목록 파일을 불러오지 못했습니다. 앱 폴더 구조를 확인해 주세요."); return; }
    if(mode==="review") loadReview(); else if(isCsatSession) initSession(); else initStart();
  }
  document.addEventListener("DOMContentLoaded",init);
})();

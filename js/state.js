(function(){
  const STORAGE_KEY = "csat_study_hub_split_v1";
  const defaults = {
    target: {
      universityId:"", university:"", selectedRegion:"", campusId:"", campusName:"",
      majorGroupId:"", majorGroupName:"", majorId:"", major:"", targetGrade:2.0,
      estimateRange:"", estimateConfidence:null, estimateConfidenceLabel:"", estimateModelVersion:"",
      estimateOfficial:false, estimateBasis:"", admissionMemo:""
    },
    dailyStudySeconds:{},
    problemResults:[],
    csatResults:[],
    timer:{ active:false, mode:null, label:"", startedAt:null, visibleStartedAt:null, sessionSeconds:0 }
  };

  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function explicitYear(record){
    const values=[record?.year,record?.paperSnapshot?.year,record?.paper?.year];
    for(const value of values){
      const year=Number(value);
      if(Number.isFinite(year)&&year>1900) return year;
    }
    return null;
  }
  function isModernRecord(record){
    const ownYear=explicitYear(record);
    if(ownYear!==null) return ownYear>=2022;
    const sections=Array.isArray(record?.sessionSections)?record.sessionSections:Array.isArray(record?.sections)?record.sections:[];
    const sectionYears=sections.map(explicitYear).filter(year=>year!==null);
    return !sectionYears.length||sectionYears.every(year=>year>=2022);
  }
  function migrate(saved){
    const migrated={...(saved||{})};
    migrated.problemResults=(Array.isArray(saved?.problemResults)?saved.problemResults:[]).filter(isModernRecord);
    migrated.csatResults=(Array.isArray(saved?.csatResults)?saved.csatResults:[]).filter(isModernRecord);
    return migrated;
  }
  function purgeObsoleteDrafts(){
    const keys=[];
    for(let index=0;index<localStorage.length;index+=1){
      const key=localStorage.key(index);
      if(key?.startsWith("studyAppPracticeDraft:")) keys.push(key);
    }
    keys.forEach(key=>{
      try{
        const draft=JSON.parse(localStorage.getItem(key)||"null");
        const linked=window.PdfCatalog?.getPaper?.(draft?.paperId);
        if(!key.endsWith(":full-pdf-v2")||!linked||Number(linked.year)<2022) localStorage.removeItem(key);
      }catch(error){ localStorage.removeItem(key); }
    });
  }
  function load(){
    try{
      purgeObsoleteDrafts();
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return clone(defaults);
      const saved = migrate(JSON.parse(raw));
      return {
        ...clone(defaults), ...saved,
        target:{...clone(defaults.target), ...(saved.target||{})},
        timer:{...clone(defaults.timer), ...(saved.timer||{})}
      };
    }catch(e){ return clone(defaults); }
  }
  window.AppStore = {
    state: load(),
    save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); },
    reload(){ this.state = load(); return this.state; },
    todayKey(date=new Date()){
      const y=date.getFullYear(), m=String(date.getMonth()+1).padStart(2,"0"), d=String(date.getDate()).padStart(2,"0");
      return `${y}-${m}-${d}`;
    },
    formatDate(key){
      const [y,m,d]=key.split("-"); return `${y}.${m}.${d}`;
    }
  };
})();

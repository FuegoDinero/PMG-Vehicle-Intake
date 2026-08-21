// PMG Intake App V3 — staged intake workflow
const STORE_KEY = 'pmg_intake_app_v3';
const LEGACY_STORE_KEY = 'pmg_intake_app_v2';
let vehicles = JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY) || '[]');
let pendingVehicle = null;
let stream = null;
let videoTrack = null;
let zoomLevel = 1;
let ocrBusy = false;
const splash = document.getElementById('splash');
const scannerModal = document.getElementById('scannerModal');
const vehicleModal = document.getElementById('vehicleModal');
const camera = document.getElementById('camera');
const registration = document.getElementById('registration');
const WORK_DESTINATIONS = ["Fuad’s/Bodyshop","S9 MOT","Pitstop","KJ Autos","Steel City","One Stop MOT","City Tyres","A & J"];

vehicles = vehicles.map(v => ({
  ...v,
  work: {
    required: !!v.work?.required || v.status === 'Work Required',
    action: v.work?.action || '',
    garage: v.work?.garage || ''
  },
  inspection: {
    engine: v.inspection?.engine || null,
    clutch: v.inspection?.clutch || null,
    brakes: v.inspection?.brakes || null,
    gearbox: v.inspection?.gearbox || null,
    warningLights: v.inspection?.warningLights || null
  },
  bodywork: {
    notes: v.bodywork?.notes || '',
    photos: Array.isArray(v.bodywork?.photos) ? v.bodywork.photos : []
  }
}));

window.addEventListener('load', () => {
  setTimeout(() => splash.classList.add('hide'), 3000);
  bindUI();
  renderAll();
});

function bindUI(){
  ['headerScan','heroScan','addVehicle'].forEach(id=>document.getElementById(id)?.addEventListener('click', openScanner));
  document.getElementById('manualAdd')?.addEventListener('click', openScanner);
  document.getElementById('closeScanner')?.addEventListener('click', closeScanner);
  document.getElementById('closeVehicle')?.addEventListener('click', closeVehicle);
  document.getElementById('lookupBtn')?.addEventListener('click', lookupVehicle);
  document.getElementById('ocrBtn')?.addEventListener('click', readPlate);
  document.getElementById('focusBtn')?.addEventListener('click', focusCamera);
  document.getElementById('viewAll')?.addEventListener('click',()=>{document.getElementById('stockAge').value='all';renderStock();});
  document.getElementById('stockSearch')?.addEventListener('input', renderStock);
  document.getElementById('stockLocation')?.addEventListener('change', renderStock);
  document.getElementById('stockAge')?.addEventListener('change', renderStock);
  document.getElementById('attentionSearch')?.addEventListener('input', renderAttention);
  document.getElementById('attentionGarage')?.addEventListener('change', renderAttention);
  document.querySelectorAll('.zoom').forEach(btn=>btn.addEventListener('click',()=>setZoom(Number(btn.dataset.zoom))));
  document.getElementById('bodyPhotoInput')?.addEventListener('change', function(){
    const reg=this.dataset.reg;
    if(reg) addBodyPhotos(reg,this);
  });
  document.querySelectorAll('.location-grid button').forEach(btn=>btn.addEventListener('click',()=>{document.getElementById('stockLocation').value=btn.dataset.location;document.getElementById('stockAge').value='all';renderStock();document.querySelector('.stock-card').scrollIntoView({behavior:'smooth'});}));
  registration?.addEventListener('keydown',e=>{if(e.key==='Enter')lookupVehicle();});
  camera?.addEventListener('click',focusCamera);
}

function save(){localStorage.setItem(STORE_KEY,JSON.stringify(vehicles));renderAll();}
function openScanner(){scannerModal.classList.remove('hidden');startCamera();}
function closeScanner(){scannerModal.classList.add('hidden');stopCamera();}
function closeVehicle(){vehicleModal.classList.add('hidden');}
async function startCamera(){
  const status=document.getElementById('cameraStatus');
  if(!navigator.mediaDevices?.getUserMedia){status.textContent='Camera unavailable — enter the registration manually.';return;}
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    camera.srcObject=stream;
    videoTrack=stream.getVideoTracks()[0];
    status.textContent='Live camera • tap plate to focus';
    await setZoom(1);
  }catch(err){status.textContent='Camera unavailable — enter the registration manually.';}
}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;videoTrack=null;}camera.srcObject=null;}
async function setZoom(level){
  zoomLevel=level;
  document.querySelectorAll('.zoom').forEach(b=>b.classList.toggle('active',Number(b.dataset.zoom)===level));
  if(!videoTrack) return;
  const caps=videoTrack.getCapabilities?.();
  try{
    if(caps?.zoom){
      const min=caps.zoom.min||1,max=caps.zoom.max||1;
      const value=Math.min(max,Math.max(min,level));
      await videoTrack.applyConstraints({advanced:[{zoom:value}]});
      camera.style.transform='scale(1)';
    }else{
      camera.style.transform=`scale(${level})`;
    }
  }catch(e){camera.style.transform=`scale(${level})`;}
}
async function focusCamera(){
  if(!videoTrack) return;
  try{
    const caps=videoTrack.getCapabilities?.();
    if(caps?.focusMode?.includes('continuous')) await videoTrack.applyConstraints({advanced:[{focusMode:'continuous'}]});
    else if(caps?.focusMode?.includes('single-shot')) await videoTrack.applyConstraints({advanced:[{focusMode:'single-shot'}]});
    document.getElementById('cameraStatus').textContent='Focus applied';
  }catch(e){document.getElementById('cameraStatus').textContent='Camera focus controlled automatically';}
}

async function readPlate(){
  if(ocrBusy) return;
  if(!camera.videoWidth){document.getElementById('cameraStatus').textContent='Start the camera first';return;}
  if(!window.Tesseract){alert('OCR library is still loading. Try again in a moment.');return;}

  ocrBusy=true;
  document.getElementById('ocrProgress').classList.remove('hidden');
  document.getElementById('ocrBtn').disabled=true;
  document.getElementById('cameraStatus').textContent='Reading registration…';

  try{
    const candidates=await runPlateOCR();
    const plate=pickBestPlate(candidates);
    if(plate){
      registration.value=plate;
      document.getElementById('cameraStatus').textContent=`Plate detected: ${plate}`;
      await lookupVehicle();
    }else{
      document.getElementById('cameraStatus').textContent='No clear registration found — centre the plate, use 2×/3×, focus and try again.';
    }
  }catch(e){
    console.error('PMG OCR error',e);
    document.getElementById('cameraStatus').textContent='OCR could not read the plate — try again or enter it manually.';
  }finally{
    ocrBusy=false;
    document.getElementById('ocrProgress').classList.add('hidden');
    document.getElementById('ocrBtn').disabled=false;
  }
}

async function runPlateOCR(){
  const vw=camera.videoWidth,vh=camera.videoHeight;
  const cropW=Math.floor(vw*.82),cropH=Math.floor(vh*.38);
  const x=Math.floor((vw-cropW)/2),y=Math.floor((vh-cropH)/2);
  const source=document.createElement('canvas');
  source.width=cropW; source.height=cropH;
  const sctx=source.getContext('2d',{willReadFrequently:true});
  sctx.imageSmoothingEnabled=false;
  sctx.drawImage(camera,x,y,cropW,cropH,0,0,cropW,cropH);

  const variants=[];
  for(const mode of ['normal','contrast','threshold']){
    const canvas=document.createElement('canvas');
    canvas.width=cropW*2; canvas.height=cropH*2;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(source,0,0,canvas.width,canvas.height);
    const img=ctx.getImageData(0,0,canvas.width,canvas.height);
    for(let i=0;i<img.data.length;i+=4){
      const r=img.data[i],g=img.data[i+1],b=img.data[i+2];
      let gray=(0.299*r+0.587*g+0.114*b);
      if(mode==='contrast') gray=Math.max(0,Math.min(255,(gray-128)*1.8+128));
      if(mode==='threshold') gray=gray>145?255:0;
      img.data[i]=img.data[i+1]=img.data[i+2]=gray;
    }
    ctx.putImageData(img,0,0);
    variants.push(canvas);
  }

  const outputs=[];
  for(let i=0;i<variants.length;i++){
    const result=await Tesseract.recognize(variants[i],'eng',{
      logger:m=>{
        if(m.status==='recognizing text'){
          const pct=Math.round((m.progress||0)*100);
          document.querySelector('#ocrProgress small').textContent=`Reading registration… ${pct}%`;
        }
      },
      tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      tessedit_pageseg_mode:'7'
    });
    outputs.push(result.data.text||'');
  }
  return outputs;
}

function pickBestPlate(texts){
  const found=[];
  for(const text of texts){
    const cleaned=(text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const matches=cleaned.match(/[A-Z]{1,3}[0-9]{1,4}[A-Z]{1,3}/g)||[];
    for(const m of matches){
      const plate=normalisePlate(m);
      if(plate && isLikelyUKRegistration(plate)) found.push(plate);
    }
  }
  const counts=found.reduce((a,p)=>(a[p]=(a[p]||0)+1,a),{});
  return Object.keys(counts).sort((a,b)=>counts[b]-counts[a] || b.length-a.length)[0]||'';
}

function isLikelyUKRegistration(reg){
  const r=reg.replace(/\s/g,'').toUpperCase();
  return /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(r) ||
         /^[A-Z][0-9]{1,3}[A-Z]{3}$/.test(r) ||
         /^[A-Z]{3}[0-9]{1,3}[A-Z]$/.test(r);
}

function normalisePlate(text){
  const cleaned=(text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const candidates=cleaned.match(/[A-Z]{1,3}[0-9]{1,4}[A-Z]{1,3}/g)||[];
  const candidate=candidates.sort((a,b)=>b.length-a.length)[0]||'';
  return candidate.length>=5&&candidate.length<=8?candidate:'';
}

async function lookupVehicle(){
  const reg=normalisePlate(registration.value);
  if(!reg){alert('Enter a valid registration first.');return;}
  registration.value=reg;
  const status=document.getElementById('apiStatus');
  status.textContent='Looking up vehicle through PMG Intake App…';
  document.getElementById('lookupBtn').disabled=true;

  try{
    const res=await fetch('/api/vehicle',{
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({registration:reg})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok){
      const detail=data.detail?`\\n\\n${data.detail}`:'';
      const upstream=data.upstreamStatus?`\\nUpstream status: ${data.upstreamStatus}`:'';
      throw new Error(`${data.message||`Vehicle API returned ${res.status}`}${upstream}${detail}`);
    }

    const vehicle=mergeVehicle(data,reg);
    const existing=vehicles.find(v=>v.registration===reg);
    if(existing){
      pendingVehicle=null;
      showVehicle(existing);
      status.textContent='Vehicle already exists in New Stock — showing the saved record.';
    }else{
      pendingVehicle=vehicle;
      showVehicle(vehicle,{pending:true});
      status.textContent='Vehicle details loaded. Review the record, then add it to New Stock.';
    }
  }catch(err){
    console.error('PMG vehicle lookup error',err);
    status.textContent=err.message||'Vehicle lookup failed.';
    alert(`${err.message||'Vehicle lookup failed.'}\n\nThe request is being made to this PMG Vehicle Intake site at /api/vehicle.`);
  }finally{
    document.getElementById('lookupBtn').disabled=false;
  }
}

function mergeVehicle(data,reg){
  const dvla=data.dvla||{};
  const mot=data.mot||data.motHistory||{};
  const normalized=data.vehicle||{};
  const vehicleSource=(mot && typeof mot==='object')?mot:{};
  const tests=Array.isArray(vehicleSource.motTests)?vehicleSource.motTests:(Array.isArray(vehicleSource.tests)?vehicleSource.tests:[]);
  const sortedTests=[...tests].sort((a,b)=>new Date(b.completedDate||0)-new Date(a.completedDate||0));
  const latest=sortedTests[0]||{};
  const make=normalized.make||dvla.make||vehicleSource.make||data.make||'';
  const model=normalized.model||dvla.model||vehicleSource.model||data.model||'';
  const fuel=normalized.fuelType||dvla.fuelType||vehicleSource.fuelType||data.fuelType||'';
  const colour=normalized.primaryColour||dvla.colour||vehicleSource.primaryColour||vehicleSource.colour||data.colour||'';
  const engine=normalized.engineCapacity||dvla.engineCapacity||vehicleSource.engineSize||data.engineCapacity||'';
  const motExpiry=normalized.motExpiryDate||dvla.motExpiryDate||latest.expiryDate||vehicleSource.motTestDueDate||data.motExpiryDate||'';
  const motStatus=normalized.motStatus||dvla.motStatus||motState(motExpiry);
  const latestMileage=latest.odometerValue||'';
  const latestMileageUnit=latest.odometerUnit||'';
  const defects=sortedTests.flatMap(t=>Array.isArray(t.defects)?t.defects:[]);
  return {
    registration:reg,
    make, model, fuel, transmission:dvla.transmission||vehicleSource.transmission||vehicleSource.gearbox||data.transmission||'',
    colour, year:dvla.yearOfManufacture||vehicleSource.manufactureYear||vehicleSource.manufactureDate?.slice(0,4)||vehicleSource.registrationDate?.slice(0,4)||data.year||'',
    engine:String(engine), engineSize:String(engine), co2:dvla.co2Emissions??data.co2Emissions??'',
    firstUsedDate:vehicleSource.firstUsedDate||'', registrationDate:dvla.monthOfFirstRegistration||vehicleSource.registrationDate||'',
    manufactureDate:vehicleSource.manufactureDate||'', taxStatus:dvla.taxStatus||'', taxDueDate:dvla.taxDueDate||'',
    artEndDate:dvla.artEndDate||'', euroStatus:dvla.euroStatus||'', markedForExport:dvla.markedForExport, typeApproval:dvla.typeApproval||'',
    wheelplan:dvla.wheelplan||'', revenueWeight:dvla.revenueWeight??'', realDrivingEmissions:dvla.realDrivingEmissions||'',
    dateOfLastV5CIssued:dvla.dateOfLastV5CIssued||'', automatedVehicle:dvla.automatedVehicle, recallStatus:vehicleSource.hasOutstandingRecall||'',
    motExpiry, motLocked:!!(motExpiry && new Date(motExpiry)>=new Date()), motStatus,
    latestMileage, latestMileageUnit, motHistory:sortedTests.slice(0,10), defects:defects.slice(0,30),
    status:'Inspection', location:'Unassigned', stockType:'New stock', createdAt:Date.now(), stockAddedAt:null, lastUpdated:Date.now(),
    inspection:{engine:null,clutch:null,brakes:null,gearbox:null,warningLights:null},
    bodywork:{notes:'',photos:[]},
    work:{required:false,action:'',garage:''}, photos:false
  };
}
function motState(date){if(!date)return'Unknown';const d=new Date(date),now=new Date();const days=(d-now)/86400000;if(d<now)return'Expired';if(days<=30)return'Due within 30 days';return'Valid';}
function showVehicle(v,opts={}){
  const pending=!!opts.pending;
  closeScanner();vehicleModal.classList.remove('hidden');
  document.getElementById('vehicleTitle').textContent=`${v.make||'Unknown'} ${v.model||'Vehicle'}`;
  const sourceNote=pending?'<div class="record-note"><b>Step 1 — Vehicle check</b><br>Vehicle data was loaded through the PMG Vehicle Intake API. This car is <b>not in New Stock yet</b>. Review the MOT and vehicle details first, add your own intake notes if needed, then choose Add to New Stock.</div>':'';
  const addButton=pending?`<button class="primary wide" onclick="addToNewStock()">Add to New Stock & Continue</button><button class="secondary wide" onclick="discardPendingVehicle()">Cancel lookup</button>`:'';
  const tests=(v.motHistory||[]).map(t=>`<div class="history-row"><div><b>${escapeHtml(t.testResult||'Unknown')}</b><span>${escapeHtml(formatDateTime(t.completedDate))}</span></div><div><b>${escapeHtml(t.expiryDate||'—')}</b><span>${escapeHtml(t.odometerValue?`${t.odometerValue} ${t.odometerUnit||''}`.trim():'Mileage —')}</span></div></div>`).join('');
  const defects=(v.defects||[]).slice(0,12).map(d=>`<div class="defect-row"><b>${escapeHtml(d.type||'NOTE')}</b><span>${escapeHtml(d.text||'')}</span></div>`).join('');
  const motClass=v.motStatus==='Expired'?'traffic-red':v.motStatus==='Due within 30 days'?'traffic-amber':'traffic-green';
  const inspection=v.inspection||{};
  const body=v.bodywork||{notes:'',photos:[]};
  const mechanicalItems=[['engine','Engine'],['clutch','Clutch'],['brakes','Brakes'],['gearbox','Gearbox']];
  const mechanicalRows=mechanicalItems.map(([key,label])=>inspectionRow(v,key,label,inspection[key])).join('');
  const bodyPhotos=(body.photos||[]).map((src,i)=>`<div class="body-photo"><img src="${src}" alt="Bodywork damage photo ${i+1}"><button class="photo-remove" onclick="removeBodyPhoto('${escapeHtml(v.registration)}',${i})">×</button></div>`).join('');
  const workflow=pending?'':`<div class="intake-progress"><span class="done">01 Vehicle data</span><span class="active">02 Mechanical</span><span>03 Bodywork</span><span>04 Work & location</span></div>`;
  document.getElementById('vehicleDetails').innerHTML=`
    ${sourceNote}
    ${workflow}
    <div class="record-topline"><span class="plate-mini">${escapeHtml(v.registration)}</span><span class="mot-badge ${motClass}">MOT: ${escapeHtml(v.motStatus||'Unknown')}${v.motExpiry?` · ${escapeHtml(formatDate(v.motExpiry))}`:''}</span></div>
    <div class="detail-grid">
      ${detail('Make',v.make)}${detail('Model',v.model)}${detail('Fuel',v.fuel)}${detail('Transmission',v.transmission||'Not supplied — confirm manually')}
      ${detail('Year',v.year)}${detail('First registered',formatDate(v.registrationDate))}${detail('Manufactured',formatDate(v.manufactureDate||v.firstUsedDate))}${detail('Colour',v.colour)}
      ${detail('Engine',v.engine?`${v.engine} cc`:'')}${detail('CO₂',v.co2?v.co2+' g/km':'')}${detail('Euro status',v.euroStatus)}${detail('Tax',v.taxStatus)}
      ${detail('Tax due',formatDate(v.taxDueDate))}${detail('MOT',v.motExpiry?`${v.motExpiry} · ${v.motStatus}`:'Not returned')}${detail('Latest mileage',v.latestMileage?`${v.latestMileage} ${v.latestMileageUnit||''}`.trim():'')}${detail('Recall',v.recallStatus)}
    </div>
    <div class="editable-data">
      <label><span>Transmission</span><input value="${escapeHtml(v.transmission||'')}" placeholder="Auto / Manual / Other" onchange="setTransmission('${escapeHtml(v.registration)}',this.value)"></label>
      <small>If the connected vehicle source supplies transmission, it is populated automatically. Otherwise confirm it here.</small>
    </div>
    <div class="section-title">MOT history</div>
    <div class="history-list">${tests||'<div class="empty-state compact">No MOT tests returned.</div>'}</div>
    ${defects?`<div class="section-title">Latest advisories / defects</div><div class="defect-list">${defects}</div>`:''}
    ${pending ? `<div class="pending-actions">${addButton}</div>` : `
      <section class="inspection-section" id="mechanicalSection">
        <div class="section-title">02 — CLUTCH / BRAKES / GEARBOX / ENGINE</div>
        <p class="section-help">Use the traffic lights to record the intake check. Green = OK, amber = monitor / minor work, red = work required.</p>
        <div class="inspection-list">${mechanicalRows}</div>
        <div class="inspection-row"><div><b>Warning lights</b><small>Dashboard warning lights observed</small></div>${trafficButtons(v,'warningLights',inspection.warningLights)}</div>
      </section>
      <section class="bodywork-section" id="bodyworkSection">
        <div class="section-title">03 — BODYWORK</div>
        <p class="section-help">Record the actual work needed. Photos are evidence alongside the written note; they are not required for every car.</p>
        <label class="textarea-label"><span>Bodywork required</span><textarea placeholder="e.g. Front bumper scuff, passenger rear door dent, alloy kerb damage…" onchange="setBodyworkNotes('${escapeHtml(v.registration)}',this.value)">${escapeHtml(body.notes||'')}</textarea></label>
        <div class="body-photo-actions"><button class="secondary" onclick="triggerBodyPhoto('${escapeHtml(v.registration)}')">+ Add damage photo</button><button class="ghost" onclick="ocrBodyPhotos('${escapeHtml(v.registration)}')">Read text from photo</button><input id="bodyPhotoInput" data-reg="${escapeHtml(v.registration)}" class="hidden-file" type="file" accept="image/*" capture="environment" multiple onchange="addBodyPhotos('${escapeHtml(v.registration)}',this)"></div>
        <div class="body-photos">${bodyPhotos||'<div class="photo-empty">No damage photos added.</div>'}</div>
      </section>
      <div class="action-grid">
        <button class="${v.status==='Inspection'?'selected':''}" onclick="setStatus('${escapeHtml(v.registration)}','Inspection')">Inspection</button>
        <button class="${v.status==='Work Required'?'selected':''}" onclick="setStatus('${escapeHtml(v.registration)}','Work Required')">Work required</button>
        <button class="${v.status==='Ready for Photos'?'selected':''}" onclick="setStatus('${escapeHtml(v.registration)}','Ready for Photos')">Ready for photos</button>
        <button class="${v.status==='Photos Complete'?'selected':''}" onclick="setStatus('${escapeHtml(v.registration)}','Photos Complete')">Photos complete</button>
      </div>
      <div class="action-grid">
        ${['Pitch 1','Pitch 2','Road','S6 CAF'].map(loc=>`<button class="${v.location===loc?'selected':''}" onclick="setLocation('${escapeHtml(v.registration)}','${loc}')">${loc}</button>`).join('')}
      </div>
      <div class="work-routing">
        <div class="routing-head"><span class="eyebrow">04 — WORK & LOCATION</span><small>Separate from the car's physical site location.</small></div>
        <div class="routing-grid">
          <label><span>Work required</span><select onchange="setWorkAction('${escapeHtml(v.registration)}',this.value)"><option value="">Select work type</option>${['MOT','Service','Mechanical repair','Bodywork','Tyres','Other'].map(a=>`<option value="${a}" ${v.work?.action===a?'selected':''}>${a}</option>`).join('')}</select></label>
          <label><span>Send to</span><select onchange="setWorkDestination('${escapeHtml(v.registration)}',this.value)"><option value="">Select destination</option>${WORK_DESTINATIONS.map(g=>`<option value="${escapeHtml(g)}" ${v.work?.garage===g?'selected':''}>${escapeHtml(g)}</option>`).join('')}</select></label>
        </div>
      </div>
      <button class="danger wide" onclick="removeFromStock('${escapeHtml(v.registration)}')">Remove car from New Stock</button>`}`;
}
function trafficButtons(v,key,current){return `<div class="traffic-buttons"><button class="traffic green ${current==='green'?'selected':''}" onclick="setInspectionItem('${escapeHtml(v.registration)}','${key}','green')">Green</button><button class="traffic amber ${current==='amber'?'selected':''}" onclick="setInspectionItem('${escapeHtml(v.registration)}','${key}','amber')">Amber</button><button class="traffic red ${current==='red'?'selected':''}" onclick="setInspectionItem('${escapeHtml(v.registration)}','${key}','red')">Red</button><button class="traffic clear ${!current?'selected':''}" onclick="setInspectionItem('${escapeHtml(v.registration)}','${key}',null)">Clear</button></div>`}
function inspectionRow(v,key,label,current){return `<div class="inspection-row"><div><b>${label}</b><small>${current==='green'?'OK':current==='amber'?'Monitor / minor work':current==='red'?'Work required':'Not checked'}</small></div>${trafficButtons(v,key,current)}</div>`}
function formatDate(value){if(!value)return'—';const s=String(value);return s.length===7?s:s.includes('T')?s.slice(0,10):s;}
function formatDateTime(value){if(!value)return'—';return String(value).replace('T',' ').slice(0,16);}
function addToNewStock(){
  if(!pendingVehicle)return;
  const vehicle={...pendingVehicle,stockAddedAt:Date.now(),createdAt:Date.now(),status:'Inspection',location:'Unassigned',stockType:'New stock'};
  const existing=vehicles.find(v=>v.registration===vehicle.registration);
  if(existing){Object.assign(existing,vehicle,{createdAt:existing.createdAt,stockAddedAt:existing.stockAddedAt||Date.now()});pendingVehicle=null;save();showVehicle(existing);requestAnimationFrame(()=>document.getElementById('mechanicalSection')?.scrollIntoView({behavior:'smooth',block:'start'}));return;}
  vehicles.unshift(vehicle);pendingVehicle=null;save();showVehicle(vehicle);document.getElementById('apiStatus').textContent='Added to New Stock. Starting mechanical inspection.';requestAnimationFrame(()=>document.getElementById('mechanicalSection')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function discardPendingVehicle(){pendingVehicle=null;closeVehicle();}
function detail(label,value){return `<div class="detail"><span>${label}</span><b>${escapeHtml(value||'—')}</b></div>`}
function setTransmission(reg,value){
  const v=pendingVehicle&&pendingVehicle.registration===reg?pendingVehicle:vehicles.find(x=>x.registration===reg);
  if(v){v.transmission=String(value||'').trim();if(v===pendingVehicle)showVehicle(v,{pending:true});else{save();showVehicle(v);}}
}
function setInspectionItem(reg,key,value){
  const v=vehicles.find(x=>x.registration===reg); if(!v)return;
  v.inspection=v.inspection||{}; v.inspection[key]=value||null;
  const hasRed=Object.values(v.inspection).includes('red');
  const hasAmber=Object.values(v.inspection).includes('amber');
  if(hasRed){v.work=v.work||{required:false,action:'',garage:''};v.work.required=true;v.status='Work Required';}
  else if(v.status==='Work Required' && !v.work?.action && !v.work?.garage && !hasAmber) v.status='Inspection';
  save(); showVehicle(v);
}
function setBodyworkNotes(reg,value){
  const v=vehicles.find(x=>x.registration===reg); if(!v)return;
  v.bodywork=v.bodywork||{notes:'',photos:[]}; v.bodywork.notes=String(value||'');
  if(v.bodywork.notes.trim()){v.work=v.work||{required:false,action:'',garage:''};v.work.required=true;v.work.action=v.work.action||'Bodywork';v.status='Work Required';}
  save();
}
function triggerBodyPhoto(reg){const input=document.getElementById('bodyPhotoInput');if(input){input.dataset.reg=reg;input.click();}}
async function addBodyPhotos(reg,input){
  const v=vehicles.find(x=>x.registration===reg); if(!v||!input.files?.length)return;
  v.bodywork=v.bodywork||{notes:'',photos:[]};
  const files=Array.from(input.files).slice(0,6-v.bodywork.photos.length);
  for(const file of files){
    try{const data=await compressImage(file);v.bodywork.photos.push(data);}catch(e){console.warn('PMG photo error',e);}
  }
  input.value=''; save(); showVehicle(v);
}
function compressImage(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>{const img=new Image();img.onload=()=>{const max=1200,scale=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.72));};img.onerror=reject;img.src=reader.result;};reader.readAsDataURL(file);});}
function removeBodyPhoto(reg,index){const v=vehicles.find(x=>x.registration===reg);if(!v)return;v.bodywork=v.bodywork||{notes:'',photos:[]};v.bodywork.photos.splice(index,1);save();showVehicle(v);}
async function ocrBodyPhotos(reg){
  const v=vehicles.find(x=>x.registration===reg);if(!v||!v.bodywork?.photos?.length){alert('Add a bodywork photo first.');return;}
  if(!window.Tesseract){alert('OCR library is still loading. Try again in a moment.');return;}
  const notes=[];
  for(const src of v.bodywork.photos.slice(0,3)){try{const r=await Tesseract.recognize(src,'eng');const text=(r.data.text||'').trim();if(text)notes.push(text);}catch(e){console.warn(e);}}
  if(notes.length){v.bodywork.notes=[v.bodywork.notes,notes.join('\n')].filter(Boolean).join('\n\n');save();showVehicle(v);}else alert('No readable text was found in the selected damage photos.');
}
function removeFromStock(reg){
  const v=vehicles.find(x=>x.registration===reg);if(!v)return;
  if(!confirm(`Remove ${reg} from New Stock? This removes the saved intake record from this device.`))return;
  vehicles=vehicles.filter(x=>x.registration!==reg);save();closeVehicle();
}

function setStatus(reg,status){
  const v=vehicles.find(x=>x.registration===reg);
  if(v){
    v.status=status;
    v.work=v.work||{required:false,action:'',garage:''};
    if(status==='Work Required') v.work.required=true;
    if(status==='Inspection') v.work.required=false;
    save();
    showVehicle(v);
  }
}
function setLocation(reg,loc){const v=vehicles.find(x=>x.registration===reg);if(v){v.location=loc;save();showVehicle(v);}}
function setWorkDestination(reg,garage){
  const v=vehicles.find(x=>x.registration===reg);
  if(v){
    v.work=v.work||{required:true,action:'',garage:''};
    v.work.garage=garage;
    v.work.required=true;
    v.status='Work Required';
    save();
    showVehicle(v);
  }
}
function setWorkAction(reg,action){
  const v=vehicles.find(x=>x.registration===reg);
  if(v){
    v.work=v.work||{required:true,action:'',garage:''};
    v.work.action=action;
    v.work.required=true;
    v.status='Work Required';
    save();
    showVehicle(v);
  }
}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function renderAll(){renderStock();renderAttention();renderVehicles();updateMetrics();}
function renderStock(){
  const q=document.getElementById('stockSearch').value.toLowerCase().trim();const loc=document.getElementById('stockLocation').value;const age=document.getElementById('stockAge').value;const weekStart=Date.now()-7*86400000;
  const list=vehicles.filter(v=>(age==='all'||(v.stockAddedAt||v.createdAt)>=weekStart)&&(!loc||v.location===loc)&&(!q||[v.registration,v.make,v.model,v.fuel,v.transmission,v.colour,v.year,v.engine,v.euroStatus,v.taxStatus,v.location,v.work?.garage,v.bodywork?.notes].join(' ').toLowerCase().includes(q)));
  const el=document.getElementById('stockResults');el.innerHTML=list.length?list.map(v=>`<button class="stock-item" onclick="openVehicleByReg('${escapeHtml(v.registration)}')"><div class="stock-main"><span class="plate-mini">${escapeHtml(v.registration)}</span><div class="stock-name"><b>${escapeHtml(v.make)} ${escapeHtml(v.model)}</b><span>${escapeHtml(v.fuel||'Fuel —')} · ${escapeHtml(v.transmission||'Transmission —')} · ${escapeHtml(v.year||'Year —')}</span></div></div><div class="stock-side"><b>${escapeHtml(v.location||'Unassigned')}</b><span>${escapeHtml(v.status||'Inspection')}</span></div></button>`).join(''):'<div class="empty-state">No stock matches those filters.</div>';
  const week=vehicles.filter(v=>(v.stockAddedAt||v.createdAt)>=weekStart);const count=l=>vehicles.filter(v=>v.location===l).length;
  document.getElementById('weekCount').textContent=week.length;document.getElementById('pitch1Count').textContent=count('Pitch 1');document.getElementById('pitch2Count').textContent=count('Pitch 2');document.getElementById('roadCount').textContent=count('Road');document.getElementById('s6Count').textContent=count('S6 CAF');document.getElementById('locPitch1').textContent=count('Pitch 1');document.getElementById('locPitch2').textContent=count('Pitch 2');document.getElementById('locRoad').textContent=count('Road');document.getElementById('locS6').textContent=count('S6 CAF');
}
function renderAttention(){
  const q=(document.getElementById('attentionSearch')?.value||'').toLowerCase().trim();
  const garage=document.getElementById('attentionGarage')?.value||'';
  const list=vehicles.filter(v=>{
    const needs=v.status==='Work Required'||v.work?.required;
    const hay=[v.registration,v.make,v.model,v.fuel,v.transmission,v.colour,v.work?.action,v.work?.garage].join(' ').toLowerCase();
    return needs && (!garage||v.work?.garage===garage) && (!q||hay.includes(q));
  });
  const el=document.getElementById('attentionResults');
  if(!el)return;
  el.innerHTML=list.length?list.map(v=>`<button class="stock-item" onclick="openVehicleByReg('${escapeHtml(v.registration)}')"><div class="stock-main"><span class="plate-mini">${escapeHtml(v.registration)}</span><div class="stock-name"><b>${escapeHtml(v.make)} ${escapeHtml(v.model)}</b><span>${escapeHtml(v.work?.action||'Work required')} · ${escapeHtml(v.work?.garage||'Destination not assigned')}</span></div></div><div class="stock-side"><b>${escapeHtml(v.location||'Unassigned')}</b><span>Needs attention</span></div></button>`).join(''):'<div class="empty-state">No cars match those attention filters.</div>';
  const countEl=document.getElementById('attentionCount');
  if(countEl)countEl.textContent=list.length;
}

function renderVehicles(){const el=document.getElementById('vehicleList');el.innerHTML=vehicles.length?vehicles.slice(0,8).map(v=>`<button class="stock-item" onclick="openVehicleByReg('${v.registration}')"><div class="stock-main"><span class="plate-mini">${escapeHtml(v.registration)}</span><div class="stock-name"><b>${escapeHtml(v.make)} ${escapeHtml(v.model)}</b><span>${escapeHtml(v.status)} · ${escapeHtml(v.location||'Unassigned')}</span></div></div><div class="stock-side"><span>${v.motExpiry?escapeHtml(v.motStatus):'MOT —'}</span></div></button>`).join(''):'<div class="empty-state">No vehicles added yet.</div>';}
function openVehicleByReg(reg){const v=vehicles.find(x=>x.registration===reg);if(v)showVehicle(v);}
function updateMetrics(){const weekStart=Date.now()-7*86400000;document.getElementById('metricWeek').textContent=vehicles.filter(v=>(v.stockAddedAt||v.createdAt)>=weekStart).length;document.getElementById('metricInspection').textContent=vehicles.filter(v=>v.status==='Inspection').length;document.getElementById('metricWork').textContent=vehicles.filter(v=>v.status==='Work Required'||v.work?.required).length;document.getElementById('metricPhotos').textContent=vehicles.filter(v=>v.status==='Ready for Photos'||v.status==='Photos Complete').length;const expired=vehicles.filter(v=>v.motStatus==='Expired').length,soon=vehicles.filter(v=>v.motStatus==='Due within 30 days').length;document.getElementById('motExpired').textContent=expired;document.getElementById('motSoon').textContent=soon;document.getElementById('motLock').textContent=vehicles.filter(v=>v.motLocked).length;}

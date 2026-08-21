const STORE_KEY = 'pmg_intake_app_v2';
let vehicles = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
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
  try{
    const canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const vw=camera.videoWidth,vh=camera.videoHeight;
    const cropW=Math.floor(vw*.76),cropH=Math.floor(vh*.28),x=Math.floor((vw-cropW)/2),y=Math.floor((vh-cropH)/2);
    canvas.width=cropW*2;canvas.height=cropH*2;
    ctx.drawImage(camera,x,y,cropW,cropH,0,0,canvas.width,canvas.height);
    const result=await Tesseract.recognize(canvas,'eng',{logger:m=>{if(m.status==='recognizing text')document.querySelector('#ocrProgress small').textContent=`Reading registration… ${Math.round((m.progress||0)*100)}%`;}});
    const plate=normalisePlate(result.data.text);
    if(plate){registration.value=plate;document.getElementById('cameraStatus').textContent=`Plate detected: ${plate}`;await lookupVehicle();}
    else document.getElementById('cameraStatus').textContent='Could not confidently read the plate — try 2× or 3× and tap Focus.';
  }catch(e){document.getElementById('cameraStatus').textContent='OCR failed — enter the registration manually.';}
  finally{ocrBusy=false;document.getElementById('ocrProgress').classList.add('hidden');document.getElementById('ocrBtn').disabled=false;}
}
function normalisePlate(text){
  const cleaned=(text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const uk=cleaned.match(/[A-Z]{1,3}[0-9]{1,4}[A-Z]{1,3}/g)||[];
  const candidate=uk.sort((a,b)=>b.length-a.length)[0]||cleaned;
  return candidate.length>=5&&candidate.length<=8?candidate:'';
}

async function lookupVehicle(){
  const reg=normalisePlate(registration.value);
  if(!reg){alert('Enter a valid registration first.');return;}
  registration.value=reg;
  const status=document.getElementById('apiStatus');status.textContent='Looking up vehicle through PMG Intake App…';
  document.getElementById('lookupBtn').disabled=true;
  try{
    const res=await fetch('/api/vehicle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({registration:reg})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.message||`Vehicle API returned ${res.status}`);
    const vehicle=mergeVehicle(data,reg);
    const existing=vehicles.find(v=>v.registration===reg);
    if(existing){Object.assign(existing, vehicle, {lastUpdated: Date.now()});}
    else vehicles.unshift(vehicle);
    save();
    showVehicle(vehicle);
    status.textContent='Vehicle details loaded from PMG Intake App.';
  }catch(err){
    status.textContent=err.message||'Vehicle lookup failed.';
    alert(`${err.message||'Vehicle lookup failed.'}\n\nIf the API secrets are configured in Cloudflare, check the PMG Intake App deployment logs.`);
  }finally{document.getElementById('lookupBtn').disabled=false;}
}
function mergeVehicle(data,reg){
  const dvla=data.dvla||data.vehicle||{};const mot=data.mot||data.motHistory||{};
  const tests=mot.motTests||mot.tests||[];
  const latest=tests[0]||{};
  const motExpiry=dvla.motExpiryDate||dvla.motExpiry||latest.expiryDate||latest.motExpiryDate||'';
  return {
    registration:reg,make:dvla.make||dvla.manufacturer||data.make||'Unknown',model:dvla.model||data.model||'Vehicle',fuel:dvla.fuelType||dvla.fuel||data.fuelType||'',transmission:dvla.transmission||data.transmission||'',colour:dvla.colour||data.colour||'',year:dvla.yearOfManufacture||data.year||'',engine:dvla.engineCapacity||data.engineCapacity||'',co2:dvla.co2Emissions||data.co2Emissions||'',motExpiry, motLocked:!!(motExpiry && new Date(motExpiry)>=new Date()), motStatus:motExpiry?motState(motExpiry):'Unknown',motHistory:tests.slice(0,10),status:'Inspection',location:'Unassigned',createdAt:Date.now(),lastUpdated:Date.now(),inspection:{engine:null,clutch:null,brakes:null,warningLights:null,bodywork:null,corrosion:null,brokenParts:null},work:{required:false,action:'',garage:''},photos:false
  };
}
function motState(date){const d=new Date(date),now=new Date();const days=(d-now)/86400000;if(d<now)return'Expired';if(days<=30)return'Due within 30 days';return'Valid';}
function showVehicle(v){
  closeScanner();vehicleModal.classList.remove('hidden');document.getElementById('vehicleTitle').textContent=`${v.make} ${v.model}`;
  document.getElementById('vehicleDetails').innerHTML=`
    <div class="plate-mini" style="display:inline-block;margin-top:8px">${v.registration}</div>
    <div class="detail-grid">
      ${detail('Fuel',v.fuel)}${detail('Transmission',v.transmission)}${detail('Year',v.year)}${detail('Colour',v.colour)}${detail('Engine',v.engine)}${detail('MOT',v.motExpiry?`${v.motExpiry} · ${v.motStatus}`:'Not returned')}
    </div>
    <div class="action-grid">
      <button class="${v.status==='Inspection'?'selected':''}" onclick="setStatus('${v.registration}','Inspection')">Inspection</button>
      <button class="${v.status==='Work Required'?'selected':''}" onclick="setStatus('${v.registration}','Work Required')">Work required</button>
      <button class="${v.status==='Ready for Photos'?'selected':''}" onclick="setStatus('${v.registration}','Ready for Photos')">Ready for photos</button>
      <button class="${v.status==='Photos Complete'?'selected':''}" onclick="setStatus('${v.registration}','Photos Complete')">Photos complete</button>
    </div>
    <div class="action-grid">
      ${['Pitch 1','Pitch 2','Road','S6 CAF'].map(loc=>`<button class="${v.location===loc?'selected':''}" onclick="setLocation('${v.registration}','${loc}')">${loc}</button>`).join('')}
    </div>
    <div class="work-routing">
      <div class="routing-head"><span class="eyebrow">WORK ROUTING</span><small>Separate from the car's physical site location.</small></div>
      <div class="routing-grid">
        <label><span>Work required</span><select onchange="setWorkAction('${v.registration}',this.value)">
          <option value="">Select work type</option>
          ${['MOT','Service','Mechanical repair','Bodywork','Tyres','Other'].map(a=>`<option value="${a}" ${v.work?.action===a?'selected':''}>${a}</option>`).join('')}
        </select></label>
        <label><span>Send to</span><select onchange="setWorkDestination('${v.registration}',this.value)">
          <option value="">Select destination</option>
          ${WORK_DESTINATIONS.map(g=>`<option value="${escapeHtml(g)}" ${v.work?.garage===g?'selected':''}>${escapeHtml(g)}</option>`).join('')}
        </select></label>
      </div>
    </div>`;
}
function detail(label,value){return `<div class="detail"><span>${label}</span><b>${escapeHtml(value||'—')}</b></div>`}
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
  const list=vehicles.filter(v=>(age==='all'||v.createdAt>=weekStart)&&(!loc||v.location===loc)&&(!q||[v.registration,v.make,v.model,v.fuel,v.transmission,v.colour].join(' ').toLowerCase().includes(q)));
  const el=document.getElementById('stockResults');el.innerHTML=list.length?list.map(v=>`<button class="stock-item" onclick="showVehicle(${JSON.stringify(v).replace(/"/g,'&quot;')})"><div class="stock-main"><span class="plate-mini">${escapeHtml(v.registration)}</span><div class="stock-name"><b>${escapeHtml(v.make)} ${escapeHtml(v.model)}</b><span>${escapeHtml(v.fuel||'Fuel —')} · ${escapeHtml(v.transmission||'Transmission —')} · ${escapeHtml(v.year||'Year —')}</span></div></div><div class="stock-side"><b>${escapeHtml(v.location||'Unassigned')}</b><span>${escapeHtml(v.status||'Inspection')}</span></div></button>`).join(''):'<div class="empty-state">No stock matches those filters.</div>';
  const week=vehicles.filter(v=>v.createdAt>=weekStart);const count=l=>vehicles.filter(v=>v.location===l).length;
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
function updateMetrics(){const weekStart=Date.now()-7*86400000;document.getElementById('metricWeek').textContent=vehicles.filter(v=>v.createdAt>=weekStart).length;document.getElementById('metricInspection').textContent=vehicles.filter(v=>v.status==='Inspection').length;document.getElementById('metricWork').textContent=vehicles.filter(v=>v.status==='Work Required'||v.work?.required).length;document.getElementById('metricPhotos').textContent=vehicles.filter(v=>v.status==='Ready for Photos'||v.status==='Photos Complete').length;const expired=vehicles.filter(v=>v.motStatus==='Expired').length,soon=vehicles.filter(v=>v.motStatus==='Due within 30 days').length;document.getElementById('motExpired').textContent=expired;document.getElementById('motSoon').textContent=soon;document.getElementById('motLock').textContent=vehicles.filter(v=>v.motLocked).length;}

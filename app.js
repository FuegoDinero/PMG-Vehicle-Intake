let savedVehicles = [];
try {
  const rawVehicles = localStorage.getItem("pmgVehicles");
  const parsedVehicles = rawVehicles ? JSON.parse(rawVehicles) : [];
  savedVehicles = Array.isArray(parsedVehicles) ? parsedVehicles : [];
} catch (error) {
  savedVehicles = [];
}

const state = {
  vehicles: savedVehicles,
  stream: null
};

// Public URL of your Cloudflare Worker.
// Example: "https://penistone-vehicle-api.your-subdomain.workers.dev"
const VEHICLE_API_URL = "";


function saveState(){
  localStorage.setItem("pmgVehicles", JSON.stringify(state.vehicles));
}

function openScanner(){
  document.getElementById("scannerModal").classList.remove("hidden");
  startCamera();
}

function closeScanner(){
  document.getElementById("scannerModal").classList.add("hidden");
  stopCamera();
}

function closeVehicle(){
  document.getElementById("vehicleModal").classList.add("hidden");
}

async function startCamera(){
  const video = document.getElementById("camera");
  const message = document.getElementById("cameraMessage");
  try{
    state.stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:"environment"}},
      audio:false
    });
    video.srcObject = state.stream;
    message.textContent = "Point the camera at the registration plate. No image is saved.";
  }catch{
    message.textContent = "Camera unavailable. You can enter the registration manually.";
  }
}

function stopCamera(){
  if(state.stream){
    state.stream.getTracks().forEach(track=>track.stop());
    state.stream = null;
  }
}

function normalisePlate(value){
  return value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10);
}

document.getElementById("registration").addEventListener("input", e=>{
  e.target.value = normalisePlate(e.target.value);
});

async function lookupVehicle(){
  const input = document.getElementById("registration");
  const registration = normalisePlate(input.value);
  if(!registration){
    alert("Enter a registration first.");
    return;
  }

  if(state.vehicles.some(v=>v.registration===registration)){
    const existing = state.vehicles.find(v=>v.registration===registration);
    showVehicle(existing);
    return;
  }

  let vehicle;
  if(!VEHICLE_API_URL){
    alert("Cloudflare vehicle API is not configured yet. Add its public Worker URL at the top of app.js.");
    return;
  }

  try{
    const response = await fetch(`${VEHICLE_API_URL.replace(/\/$/,"")}/api/vehicle`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({registration})
    });
    const result = await response.json();
    if(!response.ok) throw new Error(result.error || "Vehicle API lookup failed.");
    vehicle = {...result.vehicle, registration};
  }catch(error){
    alert(error.message || "Could not reach the vehicle API.");
    return;
  }

  vehicle.current_stage = "INSPECTION";
  vehicle.created_at = new Date().toISOString();
  state.vehicles.unshift(vehicle);
  saveState();
  closeScanner();
  render();
  showVehicle(vehicle);
}

function motInfo(expiry){
  if(!expiry) return {text:"MOT unknown", cls:"amber", days:null};
  const days = Math.ceil((new Date(expiry)-new Date())/86400000);
  if(days < 0) return {text:"MOT expired", cls:"red", days};
  if(days <= 30) return {text:`MOT ${days} days`, cls:"amber", days};
  return {text:`MOT ${days} days`, cls:"green", days};
}

function showVehicle(v){
  const mot = motInfo(v.mot_expiry);
  document.getElementById("vehicleDetails").innerHTML = `
    <div class="eyebrow">VEHICLE</div>
    <h2 style="font-size:28px;margin-top:5px">${escapeHtml(v.registration)}</h2>
    <p class="muted">${escapeHtml(v.make||"")} ${escapeHtml(v.model||"")}</p>
    <span class="badge ${mot.cls}">${mot.text}</span>
    <div class="detail-grid">
      ${detail("Make",v.make)}
      ${detail("Model",v.model)}
      ${detail("Year",v.year)}
      ${detail("Colour",v.colour)}
      ${detail("Fuel",v.fuel_type)}
      ${detail("Transmission",v.transmission)}
      ${detail("MOT expiry",v.mot_expiry)}
      ${detail("Stage",v.current_stage)}
      ${detail("Location",v.current_location || "Not assigned")}
    </div>
    <button class="blue-btn full" onclick="startInspection('${v.registration}')">Start / Continue Inspection</button>
  `;
  document.getElementById("vehicleModal").classList.remove("hidden");
}

function detail(label,value){
  return `<div><small>${label}</small><strong>${escapeHtml(value || "—")}</strong></div>`;
}

function startInspection(registration){
  const v = state.vehicles.find(x=>x.registration===registration);
  if(!v) return;
  v.current_stage="INSPECTION";
  saveState();
  render();
  closeVehicle();
  alert("Inspection stage ready. The full mechanical, exterior and interior checklist will be connected here.");
}

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}


function startOfWeek(date = new Date()){
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setHours(0,0,0,0);
  d.setDate(d.getDate()+diff);
  return d;
}

function isNewThisWeek(vehicle){
  if(!vehicle.created_at) return false;
  return new Date(vehicle.created_at) >= startOfWeek();
}

function setStockAge(value){
  const select = document.getElementById("stockAge");
  if(select) select.value = value;
  document.querySelector(".stock-dashboard")?.scrollIntoView({behavior:"smooth"});
  renderStock();
}

function showAllStock(){
  setStockAge("all");
}

function stockMatches(vehicle, query, location){
  const haystack = [
    vehicle.registration, vehicle.make, vehicle.model, vehicle.fuel_type,
    vehicle.transmission, vehicle.colour, vehicle.year, vehicle.current_stage,
    vehicle.current_location
  ].join(" ").toLowerCase();
  const textMatch = !query || haystack.includes(query.toLowerCase());
  const locationMatch = !location || (vehicle.current_location || "Unassigned") === location;
  return textMatch && locationMatch;
}

function renderStock(){
  const query = document.getElementById("stockSearch")?.value.trim() || "";
  const location = document.getElementById("stockLocation")?.value || "";
  const age = document.getElementById("stockAge")?.value || "week";

  const newStock = state.vehicles.filter(isNewThisWeek);
  const visible = state.vehicles
    .filter(v => age === "all" || isNewThisWeek(v))
    .filter(v => stockMatches(v, query, location));

  document.getElementById("newThisWeek").textContent = newStock.length;
  document.getElementById("totalStock").textContent = state.vehicles.length;
  document.getElementById("pitch1Count").textContent = state.vehicles.filter(v=>v.current_location==="Pitch 1").length;
  document.getElementById("pitch2Count").textContent = state.vehicles.filter(v=>v.current_location==="Pitch 2").length;
  document.getElementById("roadCount").textContent = state.vehicles.filter(v=>v.current_location==="Road").length;
  document.getElementById("s6Count").textContent = state.vehicles.filter(v=>v.current_location==="S6 CAF").length;

  const results = document.getElementById("stockResults");
  if(!visible.length){
    results.innerHTML = '<div class="stock-empty">No stock matches those filters.</div>';
    return;
  }

  results.innerHTML = visible.map(v => `
    <div class="stock-result">
      <div class="stock-result-main">
        <h3>${escapeHtml(v.registration)} — ${escapeHtml(v.make||"")} ${escapeHtml(v.model||"")}</h3>
        <p>${escapeHtml(v.year||"")} · ${escapeHtml(v.fuel_type||"Fuel unknown")} · ${escapeHtml(v.transmission||"Transmission unknown")} · Added ${v.created_at ? new Date(v.created_at).toLocaleDateString() : "—"}</p>
      </div>
      <div class="stock-meta">
        <span class="stock-pill">${escapeHtml(v.current_location || "Unassigned")}</span>
        <span class="stock-pill">${escapeHtml(v.current_stage || "NEW")}</span>
        <button class="secondary-btn" onclick="showVehicle(state.vehicles.find(x=>x.registration==='${v.registration}'))">Open</button>
      </div>
    </div>
  `).join("");
}

function render(){
  const list = document.getElementById("vehicleList");
  document.getElementById("countToday").textContent = state.vehicles.length;
  document.getElementById("countInspection").textContent = state.vehicles.filter(v=>v.current_stage==="INSPECTION").length;
  document.getElementById("countWork").textContent = state.vehicles.filter(v=>v.current_stage==="WORK_REQUIRED").length;
  document.getElementById("countPhotos").textContent = state.vehicles.filter(v=>v.current_stage==="READY_FOR_PHOTOS").length;
  document.getElementById("motExpired").textContent = state.vehicles.filter(v=>motInfo(v.mot_expiry).days !== null && motInfo(v.mot_expiry).days < 0).length;
  document.getElementById("motSoon").textContent = state.vehicles.filter(v=>{const d=motInfo(v.mot_expiry).days;return d!==null&&d>=0&&d<=30}).length;

  if(!state.vehicles.length){
    list.innerHTML = '<div class="empty">No vehicles added yet.</div>';
    return;
  }

  list.innerHTML = state.vehicles.map(v=>{
    const mot=motInfo(v.mot_expiry);
    return `<div class="vehicle-card">
      <div>
        <h3>${escapeHtml(v.registration)}</h3>
        <p>${escapeHtml(v.make||"")} ${escapeHtml(v.model||"")} · ${escapeHtml(v.current_stage||"NEW")}</p>
        <span class="badge ${mot.cls}">${mot.text}</span>
      </div>
      <button class="secondary-btn" onclick="showVehicle(state.vehicles.find(x=>x.registration==='${v.registration}'))">Open</button>
    </div>`;
  }).join("");
}

window.addEventListener("load", ()=>{
  render();
  renderStock();
});
const STORAGE_KEY = "beenthere_places_v3";
const TOTAL_WORLD_COUNTRIES = 195;
const LAST_EXTERNAL_BACKUP_KEY = "orbmark_last_external_backup";
const LAST_BACKUP_REMINDER_WEEK_KEY = "orbmark_last_backup_reminder_week";
const OLD_KEYS = ["beenthere_places_v2","beenthere_places_v1"];
const WORLD_GEOJSON = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";
const GEOBOUNDARIES_API = "https://www.geoboundaries.org/api/current/gbOpen";
const ITALY_REGIONS_GEOJSON = "https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_IT_regions.geojson";
const ITALY_PROVINCES_GEOJSON = "https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_IT_provinces.geojson";
const FRANCE_REGIONS_GEOJSON = "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/regions-version-simplifiee.geojson";
const FRANCE_DEPARTMENTS_GEOJSON = "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-version-simplifiee.geojson";
const FRANCE_API = "https://geo.api.gouv.fr";
const FRANCE_REGION_BASE = "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/regions";

/* Europa + USA: qui abilitiamo le suddivisioni visuali.
   Per l'Europa usiamo ADM2 quando corrisponde bene all'idea di provincia/dipartimento,
   altrimenti ADM1. Negli USA usiamo gli Stati (ADM1). */
const EUROPE_ISO3 = new Set([
  "ALB","AND","AUT","BEL","BGR","BIH","BLR","CHE","CYP","CZE","DEU","DNK","ESP","EST","FIN",
  "FRA","GBR","GRC","HRV","HUN","IRL","ISL","ITA","LIE","LTU","LUX","LVA","MCO","MDA","MKD",
  "MLT","MNE","NLD","NOR","POL","PRT","ROU","RUS","SMR","SRB","SVK","SVN","SWE","TUR","UKR","VAT"
]);
const SUPPORTED_VISUAL = iso3 => EUROPE_ISO3.has(iso3) || iso3 === "USA";

const COUNTRY_ALIASES = {
  "france":"FRA","norway":"NOR","united states of america":"USA","united states":"USA","russian federation":"RUS",
  "south korea":"KOR","republic of korea":"KOR","north korea":"PRK",
  "iran":"IRN","syria":"SYR","laos":"LAO","vietnam":"VNM","venezuela":"VEN",
  "bolivia":"BOL","tanzania":"TZA","moldova":"MDA","brunei":"BRN",
  "ivory coast":"CIV","cote d'ivoire":"CIV",
  "democratic republic of the congo":"COD","republic of the congo":"COG"
};

let places = loadPlaces();
let worldMap, countryMap, worldLayer, countryLayer;
let globeCanvas = null;
let globeCtx = null;
let globeRotation = {lon: 10, lat: 18};
let globeDragging = false;
let globeLastPointer = null;
let globeAnimFrame = null;
let globeAutoRotate = true;
let globeZoom = 1;
let globeMinZoom = 1;
let globeMaxZoom = 4.2;
let globeResumeTimer = null;
let globeDragMoved = false;
let globePinching = false;
let globePinchStartDist = 0;
let globePinchStartZoom = 1;
let activeGlobePointers = new Map();
let worldGeoJSON = null;
let countries = [];
let currentCountry = null;
let currentAdmin1 = null;
let currentAdmin2 = null;
let franceDeptRegionMap = new Map();
let selectedRegion = null;
let selectedArea = null;
let currentLevel = "ADM1";
let countryOnlyPending = null;
let areaConfirmPending = null;
let mobileSelectedLayer = null;
let mobileSelectedKey = "";

const ITALIAN_REGION_NAMES = new Set([
  "abruzzo","basilicata","calabria","campania","emilia-romagna","friuli-venezia giulia",
  "lazio","liguria","lombardia","marche","molise","piemonte","puglia","sardegna","sicilia",
  "toscana","trentino-alto adige","umbria","valle d'aosta","veneto"
]);

places = places.filter(p => !(
  p.countryIso3==="ITA" &&
  p.areaOnly &&
  ITALIAN_REGION_NAMES.has(normalize(p.areaName))
));
localStorage.setItem(STORAGE_KEY, JSON.stringify(places));

const visitedColor = "#2f9cff";
const visitedColorStrong = "#1b84e8";
const defaultColor = "#52606d";
const mapAccent = "#79d7ff";
const mapRegionColor = "#7f8b98";

function normalize(s="") {
  return s.toString().trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}


function franceRegionSlug(name=""){
  return normalize(name)
    .replace(/['’]/g,"-")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}

function escapeHtml(value="") {
  return value.toString().replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function loadPlaces() {
  for (const key of [STORAGE_KEY, ...OLD_KEYS]) {
    try {
      const raw = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(raw)) {
        return raw.map(p => ({
          id: p.id || makeId(),
          countryName: p.countryName || p.country || "",
          countryIso3: p.countryIso3 || "",
          adminLevel: p.adminLevel || "",
          areaName: p.areaName || p.province || "",
          areaId: p.areaId || "",
          parentAreaName: p.parentAreaName || "",
          parentAreaId: p.parentAreaId || "",
          countryOnly: !!p.countryOnly,
          areaOnly: !!p.areaOnly,
          city: p.city || "",
          name: p.name || "",
          date: p.date || "",
          notes: p.notes || "",
          createdAt: p.createdAt || new Date().toISOString()
        }));
      }
    } catch {}
  }
  return [];
}

function savePlaces() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
  refreshUI();
}

function getCountryName(feature) {
  const p = feature.properties || {};
  return p.ADMIN || p.name || p.NAME || p.NAME_EN || p.SOVEREIGNT || "";
}

function getCountryIso3(feature) {
  const p = feature.properties || {};
  const countryName = normalize(getCountryName(feature));

  // Natural Earth is known to expose ISO_A3 = -99 for some countries such as France/Norway.
  // Resolve these explicitly from the country name before checking dataset ISO fields.
  const hardFallbacks = {
    "france": "FRA",
    "norway": "NOR",
    "kosovo": "XKX",
    "somaliland": "SOM"
  };

  if(hardFallbacks[countryName]) return hardFallbacks[countryName];

  const candidates = [
    p["ISO3166-1-Alpha-3"],
    p.ISO_A3_EH,
    p.ADM0_A3_IS,
    p.ADM0_A3,
    p.GU_A3,
    p.SU_A3,
    p.WB_A3,
    p.BRK_A3,
    p.ISO_A3,
    p.iso_a3,
    p.SOV_A3,
    p.gu_a3
  ];

  const found = candidates.find(v =>
    typeof v === "string" &&
    /^[A-Z]{3}$/.test(v) &&
    v !== "-99"
  );

  return found || COUNTRY_ALIASES[countryName] || "";
}

function getAreaName(feature, level=currentLevel) {
  const p = feature.properties || {};

  if(currentCountry?.iso3==="ITA"){
    if(level==="ADM1") return p.reg_name || p.name || "Regione";
    if(level==="ADM2") return p.prov_name || p.name || "Provincia";
  }

  if(currentCountry?.iso3==="FRA"){
    return p.nom || p.name || p.shapeName || "Area";
  }

  return p.shapeName || p.NAME_2 || p.NAME_1 || p.name || p.NAME || p.DEN_UTS || "Area";
}

function getAreaId(feature, level=currentLevel) {
  const p = feature.properties || {};

  if(currentCountry?.iso3==="ITA"){
    if(level==="ADM1") return String(p.reg_istat_code_num ?? p.reg_istat_code ?? getAreaName(feature,level));
    if(level==="ADM2") return String(p.prov_istat_code_num ?? p.prov_istat_code ?? getAreaName(feature,level));
  }

  if(currentCountry?.iso3==="FRA"){
    return String(p.code ?? p.insee ?? getAreaName(feature,level));
  }

  return String(p.shapeID || p.shapeISO || p.GID_2 || p.GID_1 || getAreaName(feature,level));
}

function preferredAdmin(iso3) {
  return "ADM1";
}

function prettyAdminLabel(iso3, level) {
  if(level==="ADM1") {
    if(iso3==="USA") return "Stati";
    if(iso3==="DEU") return "Länder";
    if(iso3==="ITA") return "Regioni";
    if(iso3==="FRA") return "Regioni";
    if(iso3==="ESP") return "Comunità autonome";
    if(iso3==="CHE") return "Cantoni";
    return "Regioni / Stati";
  }

  if(level==="ADM2") {
    if(iso3==="USA") return "Contee";
    if(iso3==="DEU") return "Distretti / circondari";
    if(iso3==="ITA") return "Province / città metropolitane";
    if(iso3==="FRA") return "Dipartimenti";
    if(iso3==="ESP") return "Province";
    return "Province / distretti";
  }

  return "Aree";
}

function isCountryVisited(iso3,name) {
  return places.some(p => (iso3 && p.countryIso3===iso3) || (!p.countryIso3 && normalize(p.countryName)===normalize(name)));
}

function isAreaVisited(countryIso3,areaName,areaId) {
  return places.some(p => p.countryIso3===countryIso3 &&
    (
      (p.areaId && String(p.areaId)===String(areaId)) ||
      normalize(p.areaName)===normalize(areaName)
    )
  );
}

function savedAreaRecordsForCurrentCountry(){
  if(!currentCountry) return [];
  return places.filter(p =>
    p.countryIso3===currentCountry.iso3 &&
    !p.countryOnly &&
    (p.areaId || p.areaName)
  );
}

function findAdmin2FeatureForPlace(place){
  if(!currentAdmin2?.geojson?.features) return null;

  return currentAdmin2.geojson.features.find(feature => {
    const id=getAreaId(feature,"ADM2");
    const name=getAreaName(feature,"ADM2");

    return (
      (place.areaId && String(place.areaId)===String(id)) ||
      normalize(place.areaName)===normalize(name)
    );
  }) || null;
}

function isRegionVisited(regionFeature, regionId){
  const saved=savedAreaRecordsForCurrentCountry();
  if(!saved.length) return false;
  if(currentCountry?.iso3!=="FRA" && !currentAdmin2?.geojson?.features) return false;

  if(currentCountry.iso3==="ITA"){
    return saved.some(place => {
      const province=findAdmin2FeatureForPlace(place);
      if(!province) return false;
      const p=province.properties || {};
      const parentId=String(p.reg_istat_code_num ?? p.reg_istat_code ?? "");
      return parentId===String(regionId);
    });
  }

  if(currentCountry.iso3==="FRA"){
    return saved.some(place => {
      const deptCode=String(place.areaId || "");
      return franceDeptRegionMap.get(deptCode)===String(regionId);
    });
  }

  return saved.some(place => {
    const child=findAdmin2FeatureForPlace(place);
    if(!child) return false;

    try{
      const pt=turf.pointOnFeature(child);
      return turf.booleanPointInPolygon(pt,regionFeature);
    }catch{
      return false;
    }
  });
}


function addBaseTiles(map){
  // Nessun tile server esterno: evitiamo watermark/API key e dipendenze.
  // Lo sfondo oceanico è gestito via CSS, mentre i confini restano vettoriali.
}

function styleWorldCountry(feature){
  const iso3=getCountryIso3(feature);
  const name=getCountryName(feature);
  const visited=isCountryVisited(iso3,name);

  return {
    color: visited ? "#d8f5ff" : "#9bacbc",
    weight: visited ? 1.5 : .8,
    fillColor: visited ? visitedColor : defaultColor,
    fillOpacity: visited ? .92 : .40
  };
}

function styleAdmin1Feature(feature){
  const regionId=getAreaId(feature,"ADM1");
  const visited=isRegionVisited(feature,regionId);

  return {
    color: visited ? "#f2fbff" : "#c7d1db",
    weight: visited ? 1.5 : .95,
    fillColor: visited ? visitedColor : mapRegionColor,
    fillOpacity: visited ? .88 : .38
  };
}

function styleAdmin2Feature(feature){
  const name=getAreaName(feature,"ADM2");
  const id=getAreaId(feature,"ADM2");
  const visited=isAreaVisited(currentCountry.iso3,name,id);

  return {
    color: visited ? "#f4fcff" : "#d0d8e1",
    weight: visited ? 1.45 : 1,
    fillColor: visited ? visitedColorStrong : "#5d6977",
    fillOpacity: visited ? .95 : .35
  };
}


function isTouchLike(){
  return (
    navigator.maxTouchPoints > 0 ||
    "ontouchstart" in window ||
    window.matchMedia?.("(pointer: coarse)")?.matches ||
    window.matchMedia?.("(hover: none)")?.matches ||
    window.innerWidth <= 900
  );
}


function clearMobileMapSelection(styleFn){
  if(mobileSelectedLayer){
    mobileSelectedLayer._orbmarkSelected=false;
    if(styleFn && mobileSelectedLayer.feature){
      mobileSelectedLayer.setStyle?.(styleFn(mobileSelectedLayer.feature));
    }
  }
  mobileSelectedLayer=null;
  mobileSelectedKey="";
}

function mobileFirstTap(layer,key,feature,styleFn){
  if(!isTouchLike()) return false;

  const sameSelection =
    mobileSelectedLayer===layer &&
    mobileSelectedKey===key &&
    layer._orbmarkSelected===true;

  if(sameSelection){
    // Secondo tap: consenti l'azione.
    clearMobileMapSelection(styleFn);
    return false;
  }

  if(mobileSelectedLayer && mobileSelectedLayer!==layer){
    mobileSelectedLayer._orbmarkSelected=false;
    if(mobileSelectedLayer.feature){
      mobileSelectedLayer.setStyle?.(styleFn(mobileSelectedLayer.feature));
    }
  }

  mobileSelectedLayer=layer;
  mobileSelectedKey=key;
  layer._orbmarkSelected=true;

  layer.setStyle?.({
    ...styleFn(feature),
    color:"#ffffff",
    weight:2.8,
    fillOpacity:.84
  });
  layer.openTooltip?.();

  return true;
}

function bindAreaLabel(layer,name){
  if(isTouchLike()){
    layer.bindTooltip(name,{
      permanent:false,
      direction:"center",
      className:"mobile-area-label",
      opacity:.96,
      interactive:false
    });
  }else{
    layer.bindTooltip(name,{
      sticky:true,
      direction:"auto",
      opacity:.92
    });
  }
}

function attachHoverEffects(layer, baseStyle, hoverStyle){
  layer.on("mouseover",()=>{
    layer.setStyle({...baseStyle(layer.feature), ...hoverStyle});
    if(layer.bringToFront) layer.bringToFront();
  });
  layer.on("mouseout",()=>{
    layer.setStyle(baseStyle(layer.feature));
  });
}

function countryStyle(feature) {
  return styleWorldCountry(feature);
}

function areaStyle(feature) {
  return styleAdmin2Feature(feature);
}



function clamp(value,min,max){
  return Math.max(min, Math.min(max, value));
}

function getGlobeMetrics(){
  if(!globeCanvas) return null;

  const rect=globeCanvas.getBoundingClientRect();
  const w=rect.width;
  const h=rect.height;
  const cx=w/2;
  const cy=h/2+4;
  const r=Math.min(w,h)*0.405*globeZoom;

  return {rect,w,h,cx,cy,r};
}

function pauseGlobeAutoRotate(){
  globeAutoRotate=false;
  clearTimeout(globeResumeTimer);
}

function resumeGlobeAutoRotate(delay=3600){
  clearTimeout(globeResumeTimer);

  // Quando il globo è ingrandito lo lasciamo fermo:
  // è molto più semplice selezionare Stati piccoli.
  if(globeZoom > 1.05){
    globeAutoRotate=false;
    return;
  }

  globeResumeTimer=setTimeout(()=>{
    if(!globeDragging && !globePinching && activeGlobePointers.size===0){
      globeAutoRotate=true;
    }
  }, delay);
}

function setGlobeZoom(nextZoom){
  const clamped=clamp(nextZoom, globeMinZoom, globeMaxZoom);
  if(Math.abs(clamped-globeZoom)<0.001) return;
  globeZoom=clamped;
  drawGlobe();
}

function pointerDistance(a,b){
  const dx=a.x-b.x;
  const dy=a.y-b.y;
  return Math.hypot(dx,dy);
}

function globeProject(lon,lat,cx,cy,r){
  const rad=Math.PI/180;
  const lambda=lon*rad;
  const phi=lat*rad;
  const lambda0=globeRotation.lon*rad;
  const phi0=globeRotation.lat*rad;
  const dl=lambda-lambda0;

  const cosPhi=Math.cos(phi);
  const sinPhi=Math.sin(phi);
  const cosPhi0=Math.cos(phi0);
  const sinPhi0=Math.sin(phi0);

  const visible=sinPhi0*sinPhi + cosPhi0*cosPhi*Math.cos(dl);
  const x=cx + r*cosPhi*Math.sin(dl);
  const y=cy - r*(cosPhi0*sinPhi - sinPhi0*cosPhi*Math.cos(dl));

  return {x,y,visible};
}

function globeInverse(x,y,cx,cy,r){
  const dx=(x-cx)/r;
  const dy=-(y-cy)/r;
  const rho=Math.sqrt(dx*dx+dy*dy);
  if(rho>1) return null;

  if(rho<1e-8){
    return {lon:globeRotation.lon,lat:globeRotation.lat};
  }

  const c=Math.asin(Math.min(1,rho));
  const sinc=Math.sin(c);
  const cosc=Math.cos(c);
  const phi0=globeRotation.lat*Math.PI/180;
  const lambda0=globeRotation.lon*Math.PI/180;

  const lat=Math.asin(
    cosc*Math.sin(phi0) + (dy*sinc*Math.cos(phi0))/rho
  );

  const lon=lambda0 + Math.atan2(
    dx*sinc,
    rho*Math.cos(phi0)*cosc - dy*Math.sin(phi0)*sinc
  );

  return {
    lon:((lon*180/Math.PI+540)%360)-180,
    lat:lat*180/Math.PI
  };
}


function geometryPolygons(feature){
  const geom=feature?.geometry;
  if(!geom) return [];
  if(geom.type==="Polygon") return [geom.coordinates];
  if(geom.type==="MultiPolygon") return geom.coordinates;
  return [];
}

function polygonApproxBounds(polygon){
  const ring=polygon?.[0] || [];
  let minLon=Infinity, maxLon=-Infinity, minLat=Infinity, maxLat=-Infinity;

  for(const coord of ring){
    const lon=coord[0], lat=coord[1];
    if(lon<minLon) minLon=lon;
    if(lon>maxLon) maxLon=lon;
    if(lat<minLat) minLat=lat;
    if(lat>maxLat) maxLat=lat;
  }

  return {minLon,maxLon,minLat,maxLat};
}

function polygonApproxCenter(polygon){
  const b=polygonApproxBounds(polygon);
  return {
    lon:(b.minLon + b.maxLon) / 2,
    lat:(b.minLat + b.maxLat) / 2
  };
}

function worldDisplayPolygons(feature){
  const polygons=geometryPolygons(feature);
  const iso3=getCountryIso3(feature);

  // Francia: nel dataset mondiale compaiono anche i territori oltremare
  // (es. Guyana francese). Per Orbmark, coerentemente con il dettaglio
  // interno dell'app, mostriamo sul globo solo la Francia metropolitana + Corsica.
  if(iso3==="FRA" && polygons.length>1){
    const metro=polygons.filter(poly=>{
      const c=polygonApproxCenter(poly);
      return c.lon >= -6.5 && c.lon <= 10.5 && c.lat >= 41 && c.lat <= 52.5;
    });

    if(metro.length) return metro;
  }

  return polygons;
}

function featureForWorldHitTest(feature){
  const polygons=worldDisplayPolygons(feature);
  if(!polygons.length) return null;

  if(polygons.length===1){
    return {
      type:"Feature",
      properties: feature.properties || {},
      geometry:{type:"Polygon", coordinates:polygons[0]}
    };
  }

  return {
    type:"Feature",
    properties: feature.properties || {},
    geometry:{type:"MultiPolygon", coordinates:polygons}
  };
}

function globeDrawRing(ctx,ring,cx,cy,r){
  let drawing=false;
  let visibleCount=0;

  ctx.beginPath();

  for(const coord of ring){
    const p=globeProject(coord[0],coord[1],cx,cy,r);

    if(p.visible>0){
      visibleCount++;
      if(!drawing){
        ctx.moveTo(p.x,p.y);
        drawing=true;
      }else{
        ctx.lineTo(p.x,p.y);
      }
    }else{
      drawing=false;
    }
  }

  return visibleCount>2;
}

function globeDrawFeature(feature,cx,cy,r){
  const iso3=getCountryIso3(feature);
  const name=getCountryName(feature);
  const visited=isCountryVisited(iso3,name);

  const polygons=worldDisplayPolygons(feature);

  for(const polygon of polygons){
    for(let ri=0;ri<polygon.length;ri++){
      const ring=polygon[ri];
      const hasVisible=globeDrawRing(globeCtx,ring,cx,cy,r);
      if(!hasVisible) continue;

      if(ri===0){
        globeCtx.fillStyle=visited ? "rgba(47,156,255,.96)" : "rgba(91,108,124,.78)";
        globeCtx.fill();
      }

      globeCtx.strokeStyle=visited ? "rgba(224,248,255,.96)" : "rgba(190,205,220,.72)";
      globeCtx.lineWidth=visited ? 1.25 : .7;
      globeCtx.stroke();
    }
  }
}

function resizeGlobeCanvas(){
  if(!globeCanvas) return;
  const rect=globeCanvas.parentElement.getBoundingClientRect();
  const dpr=Math.min(window.devicePixelRatio || 1,2);

  globeCanvas.width=Math.max(1,Math.round(rect.width*dpr));
  globeCanvas.height=Math.max(1,Math.round(rect.height*dpr));
  globeCanvas.style.width=`${rect.width}px`;
  globeCanvas.style.height=`${rect.height}px`;

  globeCtx=globeCanvas.getContext("2d",{alpha:true});
  globeCtx.setTransform(dpr,0,0,dpr,0,0);
  drawGlobe();
}

function drawGlobe(){
  if(!globeCtx || !globeCanvas || !worldGeoJSON) return;

  const metrics=getGlobeMetrics();
  if(!metrics) return;

  const {w,h,cx,cy,r}=metrics;

  globeCtx.clearRect(0,0,w,h);

  // Atmosphere glow
  const glow=globeCtx.createRadialGradient(cx,cy,r*.72,cx,cy,r*1.18);
  glow.addColorStop(0,"rgba(20,65,125,0)");
  glow.addColorStop(.70,"rgba(66,156,255,.08)");
  glow.addColorStop(.88,"rgba(83,164,255,.20)");
  glow.addColorStop(1,"rgba(83,164,255,0)");
  globeCtx.fillStyle=glow;
  globeCtx.beginPath();
  globeCtx.arc(cx,cy,r*1.18,0,Math.PI*2);
  globeCtx.fill();

  // Ocean
  const ocean=globeCtx.createRadialGradient(cx-r*.34,cy-r*.36,r*.08,cx,cy,r);
  ocean.addColorStop(0,"#17345c");
  ocean.addColorStop(.55,"#0d213b");
  ocean.addColorStop(1,"#071424");
  globeCtx.fillStyle=ocean;
  globeCtx.beginPath();
  globeCtx.arc(cx,cy,r,0,Math.PI*2);
  globeCtx.fill();

  globeCtx.save();
  globeCtx.beginPath();
  globeCtx.arc(cx,cy,r,0,Math.PI*2);
  globeCtx.clip();

  // Light meridians/parallels for depth.
  globeCtx.strokeStyle="rgba(135,190,240,.07)";
  globeCtx.lineWidth=.6;

  for(let lat=-60;lat<=60;lat+=30){
    globeCtx.beginPath();
    let started=false;
    for(let lon=-180;lon<=180;lon+=4){
      const p=globeProject(lon,lat,cx,cy,r);
      if(p.visible>0){
        if(!started){globeCtx.moveTo(p.x,p.y);started=true}
        else globeCtx.lineTo(p.x,p.y);
      }else started=false;
    }
    globeCtx.stroke();
  }

  for(let lon=-150;lon<=180;lon+=30){
    globeCtx.beginPath();
    let started=false;
    for(let lat=-85;lat<=85;lat+=3){
      const p=globeProject(lon,lat,cx,cy,r);
      if(p.visible>0){
        if(!started){globeCtx.moveTo(p.x,p.y);started=true}
        else globeCtx.lineTo(p.x,p.y);
      }else started=false;
    }
    globeCtx.stroke();
  }

  for(const feature of worldGeoJSON.features){
    globeDrawFeature(feature,cx,cy,r);
  }

  globeCtx.restore();

  // Sphere border
  globeCtx.strokeStyle="rgba(159,214,255,.42)";
  globeCtx.lineWidth=1.5;
  globeCtx.beginPath();
  globeCtx.arc(cx,cy,r,0,Math.PI*2);
  globeCtx.stroke();

  // Gloss
  const gloss=globeCtx.createRadialGradient(cx-r*.34,cy-r*.42,0,cx-r*.28,cy-r*.34,r*.75);
  gloss.addColorStop(0,"rgba(255,255,255,.16)");
  gloss.addColorStop(.30,"rgba(255,255,255,.045)");
  gloss.addColorStop(1,"rgba(255,255,255,0)");
  globeCtx.fillStyle=gloss;
  globeCtx.beginPath();
  globeCtx.arc(cx,cy,r,0,Math.PI*2);
  globeCtx.fill();
}

function findCountryAtLonLat(lon,lat){
  if(typeof turf==="undefined") return null;
  const point=turf.point([lon,lat]);

  for(const feature of worldGeoJSON.features){
    try{
      const worldFeature=featureForWorldHitTest(feature) || feature;
      if(turf.booleanPointInPolygon(point,worldFeature)){
        return feature;
      }
    }catch{}
  }
  return null;
}

function startGlobeAnimation(){
  if(globeAnimFrame) cancelAnimationFrame(globeAnimFrame);

  let last=performance.now();
  const tick=(now)=>{
    const dt=Math.min(40,now-last);
    last=now;

    if(globeAutoRotate && !globeDragging){
      globeRotation.lon=(globeRotation.lon + dt*.0025)%360;
      drawGlobe();
    }

    globeAnimFrame=requestAnimationFrame(tick);
  };

  globeAnimFrame=requestAnimationFrame(tick);
}

function setupGlobeInteraction(){
  const canvas=globeCanvas;
  const pointFromEvent=e=>({x:e.clientX,y:e.clientY});

  canvas.addEventListener("wheel",e=>{
    e.preventDefault();
    pauseGlobeAutoRotate();
    setGlobeZoom(globeZoom + (e.deltaY < 0 ? 0.22 : -0.22));
    resumeGlobeAutoRotate(4200);
  }, {passive:false});

  canvas.addEventListener("pointerdown",e=>{
    pauseGlobeAutoRotate();

    activeGlobePointers.set(e.pointerId, pointFromEvent(e));
    canvas.setPointerCapture?.(e.pointerId);

    if(activeGlobePointers.size===1){
      globeDragging=true;
      globePinching=false;
      globeDragMoved=false;
      globeLastPointer=pointFromEvent(e);
    }else if(activeGlobePointers.size===2){
      globeDragging=false;
      globePinching=true;
      globeDragMoved=true;

      const [p1,p2]=[...activeGlobePointers.values()];
      globePinchStartDist=pointerDistance(p1,p2) || 1;
      globePinchStartZoom=globeZoom;
    }
  });

  canvas.addEventListener("pointermove",e=>{
    if(activeGlobePointers.has(e.pointerId)){
      activeGlobePointers.set(e.pointerId, pointFromEvent(e));
    }

    if(globePinching && activeGlobePointers.size>=2){
      const [p1,p2]=[...activeGlobePointers.values()];
      const dist=pointerDistance(p1,p2);
      if(globePinchStartDist > 0 && dist > 0){
        setGlobeZoom(globePinchStartZoom * (dist / globePinchStartDist));
      }
      return;
    }

    if(!globeDragging || !globeLastPointer) return;

    const p=pointFromEvent(e);
    const dx=p.x-globeLastPointer.x;
    const dy=p.y-globeLastPointer.y;

    if(Math.abs(dx)>1 || Math.abs(dy)>1) globeDragMoved=true;

    globeRotation.lon-=dx*.38;
    globeRotation.lat=Math.max(-75,Math.min(75,globeRotation.lat+dy*.30));
    globeLastPointer=p;

    drawGlobe();
  });

  const endPointer=e=>{
    const wasPinching=globePinching;
    const isTapCandidate=!wasPinching && !globeDragMoved;

    activeGlobePointers.delete(e.pointerId);

    if(wasPinching && activeGlobePointers.size>=2){
      const [p1,p2]=[...activeGlobePointers.values()];
      globePinchStartDist=pointerDistance(p1,p2) || 1;
      globePinchStartZoom=globeZoom;
      return;
    }

    if(activeGlobePointers.size===1){
      const remaining=[...activeGlobePointers.values()][0];
      globePinching=false;
      globeDragging=true;
      globeLastPointer=remaining;
      globeDragMoved=true;
      return;
    }

    globeDragging=false;
    globePinching=false;
    globeLastPointer=null;
    resumeGlobeAutoRotate(4200);

    if(isTapCandidate){
      const metrics=getGlobeMetrics();
      if(!metrics) return;

      const {rect,cx,cy,r}=metrics;
      const ll=globeInverse(e.clientX-rect.left,e.clientY-rect.top,cx,cy,r);
      if(!ll) return;

      const feature=findCountryAtLonLat(ll.lon,ll.lat);
      if(!feature) return;

      const c={
        name:getCountryName(feature),
        iso3:getCountryIso3(feature),
        feature
      };

      if(!c.iso3) return;
      if(SUPPORTED_VISUAL(c.iso3)) openCountry(c);
      else openCountryOnly(c);
    }
  };

  canvas.addEventListener("pointerup",endPointer);
  canvas.addEventListener("pointercancel",e=>{
    activeGlobePointers.delete(e.pointerId);
    globeDragging=false;
    globePinching=false;
    globeLastPointer=null;
    resumeGlobeAutoRotate(2400);
  });
}

async function hydrateLegacyParentAreas(){
  const pendingCountries=[...new Set(
    places
      .filter(p=>!p.countryOnly && !p.parentAreaId && p.countryIso3 && (p.areaId || p.areaName))
      .map(p=>p.countryIso3)
  )];

  if(!pendingCountries.length) return;

  const previousCountry=currentCountry;
  let changed=false;

  for(const iso3 of pendingCountries){
    try{
      currentCountry={iso3};

      let adm1=null;
      let adm2=null;

      if(iso3==="FRA"){
        await loadFranceDepartmentMetadata();
        adm1=await fetchBoundary("FRA","ADM1");

        const regionById=new Map(
          adm1.geojson.features.map(f=>[
            String(getAreaId(f,"ADM1")),
            getAreaName(f,"ADM1")
          ])
        );

        for(const p of places){
          if(p.countryIso3!==iso3 || p.countryOnly || p.parentAreaId) continue;
          const regionId=franceDeptRegionMap.get(String(p.areaId || ""));
          if(regionId){
            p.parentAreaId=String(regionId);
            p.parentAreaName=regionById.get(String(regionId)) || "";
            changed=true;
          }
        }

        continue;
      }

      adm1=await fetchBoundary(iso3,"ADM1");
      adm2=await fetchBoundary(iso3,"ADM2");
      if(!adm1?.geojson?.features || !adm2?.geojson?.features) continue;

      const parentByChildId=new Map();
      const parentByChildName=new Map();

      if(iso3==="ITA"){
        const regionById=new Map(
          adm1.geojson.features.map(f=>[
            String(getAreaId(f,"ADM1")),
            {id:String(getAreaId(f,"ADM1")),name:getAreaName(f,"ADM1")}
          ])
        );

        for(const child of adm2.geojson.features){
          const props=child.properties || {};
          const parentId=String(props.reg_istat_code_num ?? props.reg_istat_code ?? "");
          const parent=regionById.get(parentId);
          if(!parent) continue;

          parentByChildId.set(String(getAreaId(child,"ADM2")),parent);
          parentByChildName.set(normalize(getAreaName(child,"ADM2")),parent);
        }
      }else{
        for(const child of adm2.geojson.features){
          let parent=null;

          try{
            const pt=turf.pointOnFeature(child);
            for(const region of adm1.geojson.features){
              if(turf.booleanPointInPolygon(pt,region)){
                parent={
                  id:String(getAreaId(region,"ADM1")),
                  name:getAreaName(region,"ADM1")
                };
                break;
              }
            }
          }catch{}

          if(parent){
            parentByChildId.set(String(getAreaId(child,"ADM2")),parent);
            parentByChildName.set(normalize(getAreaName(child,"ADM2")),parent);
          }
        }
      }

      for(const p of places){
        if(p.countryIso3!==iso3 || p.countryOnly || p.parentAreaId) continue;

        const parent=
          (p.areaId ? parentByChildId.get(String(p.areaId)) : null) ||
          parentByChildName.get(normalize(p.areaName));

        if(parent){
          p.parentAreaId=String(parent.id);
          p.parentAreaName=parent.name || "";
          changed=true;
        }
      }

    }catch(err){
      console.warn("Migrazione gerarchia non riuscita per",iso3,err);
    }
  }

  currentCountry=previousCountry;

  if(changed){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(places));
  }
}

async function initWorldMap() {
  try {
    worldGeoJSON=await fetch(WORLD_GEOJSON).then(r=>{if(!r.ok)throw new Error();return r.json()});

    countries=worldGeoJSON.features.map(f=>{
      const name=getCountryName(f);
      let iso3=getCountryIso3(f);

      if(!iso3 && normalize(name)==="france") iso3="FRA";
      if(!iso3 && normalize(name)==="norway") iso3="NOR";

      return {name,iso3,feature:f};
    })
      .filter(c=>c.name && c.iso3)
      .sort((a,b)=>a.name.localeCompare(b.name,"it"));

    globeCanvas=document.getElementById("globeCanvas");
    resizeGlobeCanvas();
    setupGlobeInteraction();
    startGlobeAnimation();

    hydrateLegacyParentAreas().then(()=>{
      refreshUI();
      drawGlobe();
    });

    window.addEventListener("resize",resizeGlobeCanvas);
  } catch {
    document.getElementById("worldMap").innerHTML='<div class="map-loading">Impossibile caricare il mappamondo.</div>';
  }
}

function zoomToCountry(country,layer) {
  const bounds=layer.getBounds?.();
  if (bounds?.isValid()) worldMap.fitBounds(bounds,{padding:[25,25],maxZoom:5});

  setTimeout(()=>{
    if (SUPPORTED_VISUAL(country.iso3)) openCountry(country);
    else openCountryOnly(country);
  },250);
}


async function fetchFranceBoundary(level) {
  if(level==="ADM1"){
    const r = await fetch(FRANCE_REGIONS_GEOJSON,{cache:"no-store"});
    if(!r.ok) throw new Error(`Francia ADM1: HTTP ${r.status}`);

    const geojson = await r.json();
    if(!geojson || !Array.isArray(geojson.features)){
      throw new Error("Francia ADM1: GeoJSON non valido");
    }

    return {
      level:"ADM1",
      meta:{source:"france-geojson/regions-version-simplifiee.geojson"},
      geojson
    };
  }

  return null;
}

async function loadFranceDepartmentMetadata(){
  if(franceDeptRegionMap.size) return;

  const r = await fetch(`${FRANCE_API}/departements`,{cache:"no-store"});
  if(!r.ok) throw new Error(`API dipartimenti Francia: HTTP ${r.status}`);

  const data = await r.json();
  franceDeptRegionMap = new Map(
    data.map(d => [String(d.code), String(d.codeRegion)])
  );
}

async function fetchFranceDepartmentsForRegion(region){
  const slug = franceRegionSlug(region.name);
  const url = `${FRANCE_REGION_BASE}/${slug}/departements-${slug}.geojson`;

  const r = await fetch(url,{cache:"no-store"});
  if(!r.ok) throw new Error(`Dipartimenti ${region.name}: HTTP ${r.status}`);

  const geojson = await r.json();
  if(!geojson || !Array.isArray(geojson.features)){
    throw new Error(`Dipartimenti ${region.name}: GeoJSON non valido`);
  }

  return {
    level:"ADM2",
    meta:{source:url},
    geojson
  };
}

async function fetchItalyBoundary(level) {
  const url = level==="ADM1" ? ITALY_REGIONS_GEOJSON : ITALY_PROVINCES_GEOJSON;
  const r = await fetch(url,{cache:"no-store"});
  if(!r.ok) throw new Error(`Italia ${level}: HTTP ${r.status}`);
  const geojson = await r.json();
  if(!geojson || !Array.isArray(geojson.features)) throw new Error(`Italia ${level}: GeoJSON non valido`);
  return {
    level,
    meta:{source:"openpolis/geojson-italy"},
    geojson
  };
}

async function fetchBoundary(iso3, level) {
  if(iso3==="ITA") return fetchItalyBoundary(level);
  if(iso3==="FRA") return fetchFranceBoundary(level);

  function githubMediaFallback(url) {
    try {
      const u=new URL(url);
      if(u.hostname==="github.com" && u.pathname.startsWith("/wmgeolab/geoBoundaries/raw/")) {
        const rest=u.pathname.replace("/wmgeolab/geoBoundaries/raw/","");
        return "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/" + rest;
      }
      if(u.hostname==="raw.githubusercontent.com" && u.pathname.startsWith("/wmgeolab/geoBoundaries/")) {
        const rest=u.pathname.replace("/wmgeolab/geoBoundaries/","");
        return "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/" + rest;
      }
    } catch {}
    return null;
  }

  function rawGithubFallback(url) {
    try {
      const u=new URL(url);
      if(u.hostname==="github.com" && u.pathname.startsWith("/wmgeolab/geoBoundaries/raw/")) {
        return "https://raw.githubusercontent.com/wmgeolab/geoBoundaries/" +
          u.pathname.replace("/wmgeolab/geoBoundaries/raw/","");
      }
    } catch {}
    return null;
  }

  async function fetchGeoJSONFromCandidates(urls) {
    let err;
    for(const url of urls.filter(Boolean)) {
      try {
        const r=await fetch(url,{cache:"no-store"});
        if(!r.ok) throw new Error(`HTTP ${r.status}`);
        const text=await r.text();

        if(text.startsWith("version https://git-lfs.github.com/spec/v1")) {
          throw new Error("Git LFS pointer invece del GeoJSON reale");
        }

        const data=JSON.parse(text);
        if(!data || !Array.isArray(data.features)) throw new Error("GeoJSON non valido");
        return data;
      } catch(e) { err=e; }
    }
    throw err || new Error("Download GeoJSON fallito");
  }

  const metaResp=await fetch(`${GEOBOUNDARIES_API}/${iso3}/${level}/`,{cache:"no-store"});
  if(!metaResp.ok) throw new Error(`Metadata ${level}: HTTP ${metaResp.status}`);

  const meta=await metaResp.json();
  const candidates=[
    githubMediaFallback(meta.simplifiedGeometryGeoJSON),
    meta.simplifiedGeometryGeoJSON,
    rawGithubFallback(meta.simplifiedGeometryGeoJSON),
    githubMediaFallback(meta.gjDownloadURL),
    meta.gjDownloadURL,
    rawGithubFallback(meta.gjDownloadURL)
  ];

  const geojson=await fetchGeoJSONFromCandidates(candidates);
  return {level,meta,geojson};
}

async function openCountry(country) {
  currentCountry=country;
  currentAdmin1=null;
  currentAdmin2=null;
  selectedRegion=null;
  selectedArea=null;
  currentLevel="ADM1";

  showScreen("countryScreen");
  document.getElementById("countryTitle").textContent=country.name;
  document.getElementById("countrySubtitle").textContent=prettyAdminLabel(country.iso3,"ADM1");
  document.getElementById("crumbCountry").textContent=country.name;
  document.getElementById("crumbRegion").hidden=true;
  document.getElementById("crumbSep").hidden=true;
  document.getElementById("countryMapTip").textContent=isTouchLike()
    ? "1° tap: mostra il nome · 2° tap: apri"
    : (currentCountry?.iso3==="ITA" ? "Tocca una regione" : "Tocca una regione / stato");

  if(countryMap){countryMap.remove();countryMap=null;countryLayer=null;}
  document.getElementById("countryMap").innerHTML='<div class="map-loading">Caricamento regioni…</div>';

  try{
    if(country.iso3==="FRA"){
      const results=await Promise.allSettled([
        fetchBoundary("FRA","ADM1"),
        loadFranceDepartmentMetadata()
      ]);

      if(results[0].status!=="fulfilled") throw results[0].reason;

      currentAdmin1=results[0].value;
      currentAdmin2=null;

      renderAdmin1Map();
      refreshUI();
    }else{
      const results=await Promise.allSettled([
        fetchBoundary(country.iso3,"ADM1"),
        fetchBoundary(country.iso3,"ADM2")
      ]);

      if(results[0].status!=="fulfilled") throw results[0].reason;

      currentAdmin1=results[0].value;
      currentAdmin2=results[1].status==="fulfilled" ? results[1].value : null;

      renderAdmin1Map();
      refreshUI();
    }
  }catch(err){
    document.getElementById("countryMap").innerHTML=
      '<div class="map-loading">Non riesco a caricare le regioni di questo Paese.<br><br>Puoi comunque segnarlo come visitato.</div>';
    document.getElementById("countrySubtitle").textContent="Aree temporaneamente non disponibili";
    console.error("Errore ADM1:",err);
  }
}

function renderAdmin1Map(){
  clearMobileMapSelection();
  currentLevel="ADM1";
  selectedRegion=null;
  document.getElementById("countrySubtitle").textContent=prettyAdminLabel(currentCountry.iso3,"ADM1");
  document.getElementById("crumbRegion").hidden=true;
  document.getElementById("crumbSep").hidden=true;
  document.getElementById("countryMapTip").textContent=currentCountry?.iso3==="ITA" ? "Tocca una regione" : "Tocca una regione / stato";

  if(countryMap){countryMap.remove();countryMap=null;countryLayer=null;}
  document.getElementById("countryMap").innerHTML="";

  countryMap=L.map("countryMap",{zoomControl:false,attributionControl:false,minZoom:2,maxZoom:12});
  L.control.zoom({position:"bottomright"}).addTo(countryMap);
  addBaseTiles(countryMap);

  countryLayer=L.geoJSON(currentAdmin1.geojson,{
    style:styleAdmin1Feature,
    smoothFactor:1.2,
    onEachFeature:(feature,layer)=>{
      const region={name:getAreaName(feature,"ADM1"),id:getAreaId(feature,"ADM1"),feature};
      bindAreaLabel(layer,region.name);
      attachHoverEffects(layer, styleAdmin1Feature, {
        color:"#ffffff",
        weight:2,
        fillOpacity:.78
      });
      layer.on("click",()=>{
        const key=`ADM1|${currentCountry?.iso3 || ""}|${region.id}`;
        if(mobileFirstTap(layer,key,feature,styleAdmin1Feature)) return;

        const b=layer.getBounds?.();
        if(b?.isValid()) countryMap.fitBounds(b,{padding:[20,20],maxZoom:7});
        setTimeout(()=>openRegion(region),180);
      });
    }
  }).addTo(countryMap);

  const bounds=countryLayer.getBounds();
  if(bounds.isValid()) countryMap.fitBounds(bounds,{padding:[8,8]});
}

async function openRegion(region){
  selectedRegion=region;
  currentLevel="ADM2";
  document.getElementById("crumbRegion").textContent=region.name;
  document.getElementById("crumbRegion").hidden=false;
  document.getElementById("crumbSep").hidden=false;
  document.getElementById("countrySubtitle").textContent=prettyAdminLabel(currentCountry.iso3,"ADM2");
  document.getElementById("countryMapTip").textContent=isTouchLike()
    ? "1° tap: mostra il nome · 2° tap: seleziona"
    : (currentCountry?.iso3==="ITA" ? "Tocca una provincia / città metropolitana" : "Tocca una provincia / distretto per aggiungerla");

  if(countryMap){countryMap.remove();countryMap=null;countryLayer=null;}
  document.getElementById("countryMap").innerHTML='<div class="map-loading">Caricamento province / distretti…</div>';

  try{
    if(currentCountry.iso3==="FRA"){
      currentAdmin2=await fetchFranceDepartmentsForRegion(region);
    }else if(!currentAdmin2){
      currentAdmin2=await fetchBoundary(currentCountry.iso3,"ADM2");
    }

    renderAdmin2ForRegion(region);
  }catch(err){
    document.getElementById("countryMap").innerHTML=
      '<div class="map-loading">Il secondo livello non è disponibile per questa zona.<br><br>Puoi tornare indietro e scegliere un’altra regione.</div>';
    console.error("Errore ADM2:",err);
  }
}

function markAreaVisited(area){
  if(!currentCountry || !area) return;

  const exists=places.some(p =>
    p.countryIso3===currentCountry.iso3 &&
    ((p.areaId && String(p.areaId)===String(area.id)) || normalize(p.areaName)===normalize(area.name))
  );

  if(!exists){
    places.push({
      id:makeId(),
      countryName:currentCountry.name,
      countryIso3:currentCountry.iso3,
      adminLevel:"ADM2",
      areaName:area.name,
      areaId:String(area.id),
      parentAreaName:selectedRegion?.name || "",
      parentAreaId:selectedRegion?.id ? String(selectedRegion.id) : "",
      countryOnly:false,
      areaOnly:true,
      city:"",
      name:"",
      date:new Date().toISOString().slice(0,10),
      notes:"",
      createdAt:new Date().toISOString()
    });
    savePlaces();
  }
}

function unmarkAreaVisited(area){
  if(!currentCountry || !area) return;

  const specificPlaces=places.filter(p =>
    p.countryIso3===currentCountry.iso3 &&
    ((p.areaId && String(p.areaId)===String(area.id)) || normalize(p.areaName)===normalize(area.name)) &&
    !p.areaOnly
  );

  if(specificPlaces.length){
    alert("Questa provincia contiene già luoghi salvati. Elimina prima quei luoghi se vuoi togliere il colore.");
    return;
  }

  places=places.filter(p => !(
    p.countryIso3===currentCountry.iso3 &&
    ((p.areaId && String(p.areaId)===String(area.id)) || normalize(p.areaName)===normalize(area.name)) &&
    p.areaOnly
  ));
  savePlaces();
}

function renderAdmin2ForRegion(region){
  clearMobileMapSelection();
  const regionFeature=region.feature;

  const filtered=currentAdmin2.geojson.features.filter(feature=>{
    const p=feature.properties || {};

    if(currentCountry.iso3==="ITA"){
      const parentRegionId=String(p.reg_istat_code_num ?? p.reg_istat_code ?? "");
      return parentRegionId===String(region.id);
    }

    if(currentCountry.iso3==="FRA"){
      return true;
    }

    try{
      const pt=turf.pointOnFeature(feature);
      return turf.booleanPointInPolygon(pt,regionFeature);
    }catch{
      return false;
    }
  });

  if(countryMap){countryMap.remove();countryMap=null;countryLayer=null;}
  document.getElementById("countryMap").innerHTML="";
  countryMap=L.map("countryMap",{zoomControl:false,attributionControl:false,minZoom:2,maxZoom:13});
  L.control.zoom({position:"bottomright"}).addTo(countryMap);
  addBaseTiles(countryMap);

  countryLayer=L.geoJSON({type:"FeatureCollection",features:filtered},{
    style:styleAdmin2Feature,
    smoothFactor:1.2,
    onEachFeature:(feature,layer)=>{
      const area={name:getAreaName(feature,"ADM2"),id:getAreaId(feature,"ADM2"),feature};
      bindAreaLabel(layer,area.name);
      attachHoverEffects(layer, styleAdmin2Feature, {
        color:"#ffffff",
        weight:2,
        fillOpacity:.72
      });
      layer.on("click",()=>{
        const key=`ADM2|${currentCountry?.iso3 || ""}|${area.id}`;
        if(mobileFirstTap(layer,key,feature,styleAdmin2Feature)) return;

        const visited=isAreaVisited(currentCountry.iso3,area.name,area.id);

        if(!visited){
          openAreaConfirm(area);
        }else{
          openProvinceActions(area);
        }
      });
    }
  }).addTo(countryMap);

  const bounds=countryLayer.getBounds();
  if(bounds.isValid()) countryMap.fitBounds(bounds,{padding:[8,8]});
  else{
    const temp=L.geoJSON(regionFeature);
    const rb=temp.getBounds();
    if(rb.isValid()) countryMap.fitBounds(rb,{padding:[8,8]});
  }
}

function openAreaConfirm(area){
  areaConfirmPending=area;

  document.getElementById("areaConfirmName").textContent=area.name;
  document.getElementById("areaConfirmPath").textContent=
    [currentCountry?.name, selectedRegion?.name].filter(Boolean).join(" › ");

  document.getElementById("areaConfirmDialog").showModal();
}

function openProvinceActions(area){
  // Se la zona è già stata aggiunta, il secondo tap porta direttamente
  // all'inserimento di un luogo specifico dentro quella provincia/distretto.
  openVisualPlaceDialog(area);
}

function openVisualPlaceDialog(area) {
  selectedArea=area;
  document.getElementById("selectedCountryLabel").textContent=currentCountry.name;
  document.getElementById("selectedAreaLabel").textContent=[selectedRegion?.name,area.name].filter(Boolean).join(" › ");
  document.getElementById("cityInput").value="";
  document.getElementById("placeNameInput").value="";
  document.getElementById("dateInput").value=new Date().toISOString().slice(0,10);
  document.getElementById("notesInput").value="";
  document.getElementById("placeDialog").showModal();
}

function markCountryVisited(country) {
  if(!country) return;

  const exists=places.some(p=>p.countryIso3===country.iso3 && p.countryOnly);
  if(!exists){
    places.push({
      id:makeId(),
      countryName:country.name,
      countryIso3:country.iso3,
      adminLevel:"",
      areaName:"",
      areaId:"",
      countryOnly:true,
      city:"",
      name:"",
      date:new Date().toISOString().slice(0,10),
      notes:"",
      createdAt:new Date().toISOString()
    });
    savePlaces();
  }
}

function openCountryOnly(country) {
  countryOnlyPending=country;
  document.getElementById("countryOnlyTitle").textContent=country.name;
  document.getElementById("countryOnlyDialog").showModal();
}

/* Ricerca Paese tipo autocomplete */
function openCountrySearch() {
  const input=document.getElementById("countrySearchInput");
  input.value="";
  renderCountrySuggestions("");
  document.getElementById("countryDialog").showModal();
  setTimeout(()=>input.focus(),120);
}

function renderCountrySuggestions(query) {
  const q=normalize(query);
  const box=document.getElementById("countrySuggestions");

  let filtered = !q
    ? countries.slice(0,20)
    : countries.filter(c =>
        normalize(c.name).startsWith(q) ||
        normalize(c.iso3).startsWith(q)
      );
  filtered=filtered.slice(0,40);

  box.innerHTML=filtered.length
    ? filtered.map(c=>`
      <button type="button" class="suggestion-btn" data-iso="${escapeHtml(c.iso3)}">
        ${escapeHtml(c.name)}
        <small>${SUPPORTED_VISUAL(c.iso3) ? "Dettaglio aree disponibile" : "Paese disponibile; aree non ancora attive"}</small>
      </button>`).join("")
    : '<div class="empty">Nessun Paese trovato.</div>';

  box.querySelectorAll("[data-iso]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const c=countries.find(x=>x.iso3===btn.dataset.iso);
      if(!c) return;
      document.getElementById("countryDialog").close();

      const targetLayer = findWorldLayerByIso(c.iso3);
      const bounds=targetLayer?.getBounds?.();
      if(bounds?.isValid()) worldMap.fitBounds(bounds,{padding:[25,25],maxZoom:5});

      setTimeout(()=>{
        if(SUPPORTED_VISUAL(c.iso3)) openCountry(c);
        else openCountryOnly(c);
      },180);
    });
  });
}

function findWorldLayerByIso(iso3) {
  let found=null;
  worldLayer?.eachLayer(layer=>{
    if(getCountryIso3(layer.feature)===iso3) found=layer;
  });
  return found;
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.screen===id));
  if(id==="homeScreen" && globeCanvas) setTimeout(()=>resizeGlobeCanvas(),50);
  if(id==="countryScreen" && countryMap) setTimeout(()=>countryMap.invalidateSize(),50);
  if(id==="placesScreen") renderPlaces(document.getElementById("searchInput").value);
  if(id==="statsScreen") renderStats();
}

function renderPlaces(query="") {
  const q=normalize(query),list=document.getElementById("placesList");
  const filtered=places
    .filter(p=>!p.countryOnly)
    .filter(p=>!q || [p.countryName,p.areaName,p.city,p.name,p.notes].some(v=>normalize(v).includes(q)))
    .sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));

  if(!filtered.length){list.innerHTML='<div class="empty">Nessun luogo salvato ancora.</div>';return}

  list.innerHTML=filtered.map(p=>`
    <article class="place-card">
      <div>
        <h3>${escapeHtml(p.name || p.city || p.areaName || p.countryName)}</h3>
        <p>
          ${p.areaOnly ? "📍 Provincia / distretto · " : ""}
          ${[p.city,p.areaName,p.countryName].filter(Boolean).map(escapeHtml).join(" · ")}
          ${p.date?" · "+formatDate(p.date):""}
        </p>
      </div>
      <button data-delete="${escapeHtml(p.id)}">✕</button>
    </article>`).join("");

  list.querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",()=>{
    if(confirm("Eliminare questo luogo?")) {
      places=places.filter(p=>p.id!==btn.dataset.delete);
      savePlaces();
    }
  }));
}

function getVisitedParentAreaKeys(){
  return new Set(
    places
      .filter(p=>!p.countryOnly && p.parentAreaId)
      .map(p=>`${p.countryIso3}|${p.parentAreaId}`)
  );
}

function getVisitedLeafAreaKeys(){
  return new Set(
    places
      .filter(p=>!p.countryOnly && (p.areaId || p.areaName))
      .map(p=>`${p.countryIso3}|${p.areaId || normalize(p.areaName)}`)
  );
}

function renderStats() {
  const countryKeys=new Set(places.map(p=>p.countryIso3 || normalize(p.countryName)).filter(Boolean));
  const visitedCountries=countryKeys.size;
  const remainingCountries=Math.max(0, TOTAL_WORLD_COUNTRIES - visitedCountries);
  const countryPercent=(visitedCountries / TOTAL_WORLD_COUNTRIES) * 100;
  const formattedPercent=countryPercent.toLocaleString("it-IT",{
    minimumFractionDigits:1,
    maximumFractionDigits:1
  });

  const worldChart=document.getElementById("worldCountriesChart");
  if(worldChart){
    worldChart.style.setProperty("--world-pct", `${countryPercent}%`);
  }

  const worldPercentBig=document.getElementById("worldCountriesPercentBig");
  if(worldPercentBig){
    worldPercentBig.textContent=`${formattedPercent}%`;
  }

  const worldVisitedCount=document.getElementById("worldVisitedCount");
  if(worldVisitedCount){
    worldVisitedCount.textContent=visitedCountries;
  }

  const worldRemainingCount=document.getElementById("worldRemainingCount");
  if(worldRemainingCount){
    worldRemainingCount.textContent=remainingCountries;
  }

  const worldProgressBarFill=document.getElementById("worldProgressBarFill");
  if(worldProgressBarFill){
    worldProgressBarFill.style.width=`${Math.min(100,countryPercent)}%`;
    worldProgressBarFill.setAttribute("aria-valuenow",countryPercent.toFixed(1));
  }

  const recent=places.filter(p=>!p.countryOnly).sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")).slice(0,5);
  document.getElementById("recentPlaces").innerHTML=recent.length
    ? recent.map(p=>`<p>📍 <strong>${escapeHtml(p.name || p.city || p.areaName || p.countryName)}</strong><br><small>${p.areaOnly ? "Provincia / distretto · " : ""}${escapeHtml([p.areaName,p.countryName].filter(Boolean).join(" · "))}</small></p>`).join("")
    : '<p class="empty">Ancora nessun luogo.</p>';
}

function refreshUI() {
  const countryKeys=new Set(places.map(p=>p.countryIso3 || normalize(p.countryName)).filter(Boolean));
  const parentAreaKeys=getVisitedParentAreaKeys();
  const leafAreaKeys=getVisitedLeafAreaKeys();

  document.getElementById("countriesCount").textContent=countryKeys.size;
  document.getElementById("areasCount").textContent=parentAreaKeys.size;
  document.getElementById("placesCount").textContent=leafAreaKeys.size;

  if(currentCountry){
    const cp=places.filter(p=>p.countryIso3===currentCountry.iso3 && !p.countryOnly);
    const parentKeys=new Set(cp.filter(p=>p.parentAreaId).map(p=>String(p.parentAreaId)));
    const leafKeys=new Set(cp.map(p=>String(p.areaId || normalize(p.areaName))).filter(Boolean));

    document.getElementById("countryAreasCount").textContent=parentKeys.size;
    document.getElementById("countryPlacesCount").textContent=leafKeys.size;
  }

  if(worldLayer) worldLayer.setStyle(styleWorldCountry);
  if(globeCanvas) drawGlobe();
  if(countryLayer && currentLevel==="ADM2"){
    countryLayer.setStyle(styleAdmin2Feature);
  }

  if(countryLayer && currentLevel==="ADM1"){
    countryLayer.setStyle(styleAdmin1Feature);
  }
  renderPlaces(document.getElementById("searchInput")?.value || "");
  renderStats();
}

function formatDate(s) {
  return s ? new Date(`${s}T12:00:00`).toLocaleDateString("it-IT") : "";
}


function getIsoWeekKey(date=new Date()){
  const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  const day=d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate()+4-day);
  const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const week=Math.ceil((((d-yearStart)/86400000)+1)/7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2,"0")}`;
}

function daysSince(dateString){
  if(!dateString) return Infinity;
  const then=new Date(dateString);
  if(Number.isNaN(then.getTime())) return Infinity;
  return (Date.now()-then.getTime())/86400000;
}

function maybeShowWeeklyBackupReminder(){
  const now=new Date();
  const isSunday=now.getDay()===0;
  const isEvening=now.getHours()>=18;
  if(!isSunday || !isEvening) return;

  const weekKey=getIsoWeekKey(now);
  if(localStorage.getItem(LAST_BACKUP_REMINDER_WEEK_KEY)===weekKey) return;

  const lastBackup=localStorage.getItem(LAST_EXTERNAL_BACKUP_KEY);
  const ageDays=daysSince(lastBackup);

  // Se hai fatto un backup negli ultimi 7 giorni, non serve ricordartelo.
  if(ageDays < 7) return;

  const text=document.getElementById("backupReminderText");
  if(text){
    if(!lastBackup){
      text.textContent="Non risulta ancora un backup esterno recente.";
    }else{
      const rounded=Math.max(7,Math.floor(ageDays));
      text.textContent=`L'ultimo backup esportato risale a circa ${rounded} giorni fa.`;
    }
  }

  localStorage.setItem(LAST_BACKUP_REMINDER_WEEK_KEY,weekKey);
  document.getElementById("backupReminderDialog")?.showModal();
}

/* Eventi */
document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>showScreen(btn.dataset.screen)));
document.getElementById("settingsBtn").addEventListener("click",()=>showScreen("settingsScreen"));
document.getElementById("countryBackBtn").addEventListener("click",()=>{
  if(currentLevel==="ADM2" && currentAdmin1){
    renderAdmin1Map();
  }else{
    showScreen("homeScreen");
  }
});
document.getElementById("crumbCountry").addEventListener("click",()=>{
  if(currentAdmin1) renderAdmin1Map();
});
document.getElementById("crumbRegion").addEventListener("click",()=>{
  if(selectedRegion) openRegion(selectedRegion);
});
document.getElementById("globeZoomInBtn")?.addEventListener("click",()=>{
  pauseGlobeAutoRotate();
  setGlobeZoom(globeZoom + (globeZoom < 2 ? 0.25 : 0.40));
  resumeGlobeAutoRotate(4200);
});
document.getElementById("globeZoomOutBtn")?.addEventListener("click",()=>{
  pauseGlobeAutoRotate();
  setGlobeZoom(globeZoom - (globeZoom <= 2 ? 0.25 : 0.40));
  resumeGlobeAutoRotate(4200);
});
document.getElementById("addCountryBtn").addEventListener("click",openCountrySearch);
document.getElementById("markCountryBtn").addEventListener("click",()=>{
  if(!currentCountry) return;
  markCountryVisited(currentCountry);
  alert(`${currentCountry.name} segnato come visitato.`);
});

document.getElementById("closeCountryDialogBtn").addEventListener("click",()=>document.getElementById("countryDialog").close());
document.getElementById("closePlaceDialogBtn").addEventListener("click",()=>document.getElementById("placeDialog").close());
document.getElementById("closeCountryOnlyBtn").addEventListener("click",()=>document.getElementById("countryOnlyDialog").close());
document.getElementById("closeBackupReminderBtn")?.addEventListener("click",()=>{
  document.getElementById("backupReminderDialog").close();
});
document.getElementById("backupLaterBtn")?.addEventListener("click",()=>{
  document.getElementById("backupReminderDialog").close();
});
document.getElementById("backupNowBtn")?.addEventListener("click",()=>{
  document.getElementById("backupReminderDialog").close();
  exportBackup();
});

document.getElementById("closeAreaConfirmBtn").addEventListener("click",()=>{
  areaConfirmPending=null;
  document.getElementById("areaConfirmDialog").close();
});
document.getElementById("cancelAreaConfirmBtn").addEventListener("click",()=>{
  areaConfirmPending=null;
  document.getElementById("areaConfirmDialog").close();
});
document.getElementById("areaConfirmForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(!areaConfirmPending) return;

  const area=areaConfirmPending;
  areaConfirmPending=null;

  markAreaVisited(area);
  document.getElementById("areaConfirmDialog").close();

  if(countryLayer && currentLevel==="ADM2"){
    countryLayer.setStyle(styleAdmin2Feature);
  }
});



document.getElementById("countrySearchInput").addEventListener("input",e=>renderCountrySuggestions(e.target.value));

document.getElementById("placeForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(!currentCountry || !selectedArea) return;

  places.push({
    id:makeId(),
    countryName:currentCountry.name,
    countryIso3:currentCountry.iso3,
    adminLevel:"ADM2",
    areaName:selectedArea.name,
    areaId:String(selectedArea.id),
    parentAreaName:selectedRegion?.name || "",
    parentAreaId:selectedRegion?.id ? String(selectedRegion.id) : "",
    countryOnly:false,
    areaOnly:false,
    city:document.getElementById("cityInput").value.trim(),
    name:document.getElementById("placeNameInput").value.trim(),
    date:document.getElementById("dateInput").value,
    notes:document.getElementById("notesInput").value.trim(),
    createdAt:new Date().toISOString()
  });
  savePlaces();
  document.getElementById("placeDialog").close();
});

document.getElementById("countryOnlyForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(!countryOnlyPending) return;
  markCountryVisited(countryOnlyPending);
  document.getElementById("countryOnlyDialog").close();
  showScreen("homeScreen");
});

document.getElementById("searchInput").addEventListener("input",e=>renderPlaces(e.target.value));

/* Backup */
function exportBackup(){
  const blob=new Blob([JSON.stringify({version:3,exportedAt:new Date().toISOString(),places},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`orbmark-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  localStorage.setItem(LAST_EXTERNAL_BACKUP_KEY,new Date().toISOString());
}

document.getElementById("exportBtn").addEventListener("click",exportBackup);

document.getElementById("importInput").addEventListener("change",async e=>{
  const file=e.target.files?.[0];
  if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.places))throw new Error();
    places=data.places;
    savePlaces();
    alert("Backup importato.");
  }catch{alert("File di backup non valido.")}
  e.target.value="";
});

document.getElementById("resetBtn").addEventListener("click",()=>{
  if(confirm("Vuoi davvero cancellare tutti i dati?")){places=[];savePlaces()}
});

initWorldMap();
refreshUI();
setTimeout(maybeShowWeeklyBackupReminder,700);

if("serviceWorker" in navigator){
  window.addEventListener("load",async()=>{
    const regs=await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r=>r.unregister()));
  });
}

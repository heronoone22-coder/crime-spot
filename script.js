/* CrimeSpot — map, routing, safety (news list in news.js) */

var sectors = [
  "Sector 15 Noida",
  "Sector 16 Noida",
  "Sector 18 Noida",
  "Sector 22 Noida",
  "Sector 37 Noida",
  "Sector 44 Noida",
  "Sector 62 Noida",
  "Sector 63 Noida",
  "Sector 137 Noida",
  "Sector 142 Noida",
  "Alpha 1 Greater Noida",
  "Beta 1 Greater Noida",
  "Gamma 1 Greater Noida",
  "Pari Chowk Greater Noida",
  "Knowledge Park Greater Noida",
];

var crimeTypes = [
  "Mobile phone snatching by bike riders",
  "House burglary reported at residential apartment",
  "Two car collision at traffic signal",
  "Truck and bike accident causing heavy traffic",
  "Road rage between car drivers",
  "Chain snatching incident reported",
  "Car theft from parking area",
  "Hit and run accident",
  "Drunk driving crash involving two vehicles",
  "Pedestrian injured in road accident",
];

var initialReports = [
  {
    lat: 28.5705,
    lng: 77.3272,
    title: "Reported serious incident",
    description: "High-profile case in media; avoid rumor — follow official updates.",
    type: "crime",
  },
  {
    lat: 28.567,
    lng: 77.321,
    title: "Attempt to murder FIR",
    description: "Police investigation ongoing in dense urban pocket.",
    type: "crime",
  },
  {
    lat: 28.5635,
    lng: 77.329,
    title: "Fatal incident under probe",
    description: "Use well-lit corridors; community helpline active.",
    type: "crime",
  },
];

var currentRouteCoords = [];

var crimeIcon = L.icon({ iconUrl: "https://maps.google.com/mapfiles/ms/icons/red-dot.png", iconSize: [32, 32] });
var accidentIcon = L.icon({ iconUrl: "https://maps.google.com/mapfiles/ms/icons/orange-dot.png", iconSize: [32, 32] });
var unsafeIcon = L.icon({ iconUrl: "https://maps.google.com/mapfiles/ms/icons/yellow-dot.png", iconSize: [32, 32] });
var animalIcon = L.icon({ iconUrl: "https://maps.google.com/mapfiles/ms/icons/green-dot.png", iconSize: [32, 32] });
var darkRoadIcon = L.icon({ iconUrl: "https://maps.google.com/mapfiles/ms/icons/purple-dot.png", iconSize: [32, 32] });
var infraIcon = L.icon({ iconUrl: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png", iconSize: [32, 32] });
var policeIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/2991/2991173.png",
  iconSize: [30, 30],
});
var busIcon = L.icon({ iconUrl: "https://cdn-icons-png.flaticon.com/512/61/61231.png", iconSize: [28, 28] });

var routeControl;
var reporting = false;
var crimeMarkers = [];
var liveLocationMarker;
var heatPoints = [];
var heatLayer;
var driveMarker;
var sharePopupOpened = false;

var streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
});

var satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Tiles © Esri",
});

var map = L.map("map", {
  center: [28.57, 77.33],
  zoom: 12,
  layers: [streetLayer],
});

L.control.layers({
  "Street view": streetLayer,
  "Satellite": satelliteLayer,
}).addTo(map);

var policeStaticGroup = L.layerGroup().addTo(map);
var busStaticGroup = L.layerGroup().addTo(map);
var policeStaticData = [];
var staticAmenitiesLoaded = false;
var staticAmenitiesLoading = false;

function randomLocation() {
  return { lat: 28.45 + Math.random() * 0.15, lng: 77.3 + Math.random() * 0.25 };
}

function severityWeight(text) {
  var t = text.toLowerCase();
  if (t.includes("murder") || t.includes("death") || t.includes("kill") || t.includes("attack")) return 12;
  if (t.includes("theft") || t.includes("snatching") || t.includes("burglary")) return 10;
  if (t.includes("accident") || t.includes("collision") || t.includes("crash")) return 7;
  if (t.includes("animal")) return 5;
  if (t.includes("dark")) return 6;
  if (t.includes("infra")) return 4;
  return 5;
}

/**
 * CrimeSpot score: distance-weighted penalties with a floor so values stay interpretable (not stuck at 0).
 */
function computeSafetyScoreForPoint(latLng, radiusKm) {
  var penalty = 0;
  crimeMarkers.forEach(function (marker) {
    var distanceKm = latLng.distanceTo(marker.getLatLng()) / 1000;
    if (distanceKm > radiusKm) return;
    var proximity = Math.pow(1 - distanceKm / radiusKm, 1.45);
    var text = marker.getPopup().getContent();
    var w = severityWeight(text);
    penalty += w * proximity;
  });
  var baseline = 78;
  var curve = baseline + (100 - baseline) * Math.exp(-penalty / 32);
  var score = Math.round(curve);
  if (score < 44) score = 44;
  if (score > 97) score = 97;
  return score;
}

function setRouteTimeMessage(text) {
  var el = document.getElementById("routeTime");
  if (el) el.textContent = text;
}

function setSafetyLabel(score, label) {
  var el = document.getElementById("safetyScore");
  if (!el) return;
  el.textContent = "CrimeSpot safety score" + (label ? " (" + label + ")" : "") + ": " + score + " / 100";
}

function getCrimeSpotProfile() {
  try {
    return JSON.parse(localStorage.getItem("crimespot_profile") || "null");
  } catch (e) {
    return null;
  }
}

function loadStaticAmenities() {
  if (staticAmenitiesLoading || staticAmenitiesLoaded) return;
  staticAmenitiesLoading = true;
  var clat = 28.57;
  var clng = 77.33;
  var query =
    "[out:json][timeout:35];(" +
    'node["amenity"="police"](around:16000,' +
    clat +
    "," +
    clng +
    ");" +
    'node["highway"="bus_stop"](around:12000,' +
    clat +
    "," +
    clng +
    "););out;";

  var panel = document.getElementById("nearestPoliceText");
  if (panel) panel.textContent = "Loading police stations and bus stops on the map…";

  fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: query })
    .then(function (res) {
      return res.json();
    })
    .then(function (data) {
      policeStaticGroup.clearLayers();
      busStaticGroup.clearLayers();
      policeStaticData = [];
      var busAdded = 0;
      var maxBus = 120;

      (data.elements || []).forEach(function (el) {
        if (el.lat == null || el.lon == null) return;
        var tags = el.tags || {};
        if (tags.amenity === "police") {
          var pname = tags.name || tags["name:en"] || "Police station";
          policeStaticData.push({ lat: el.lat, lon: el.lon, name: pname });
          L.marker([el.lat, el.lon], { icon: policeIcon })
            .addTo(policeStaticGroup)
            .bindPopup("Police · " + pname);
        }
        if (tags.highway === "bus_stop" && busAdded < maxBus) {
          busAdded++;
          var bname = tags.name || "Bus stop";
          L.marker([el.lat, el.lon], { icon: busIcon })
            .addTo(busStaticGroup)
            .bindPopup("Bus · " + bname);
        }
      });

      staticAmenitiesLoaded = true;
      staticAmenitiesLoading = false;
      if (panel) {
        panel.innerHTML =
          "<strong>Map markers</strong><br>" +
          policeStaticData.length +
          " police stations and " +
          busAdded +
          " bus stops are shown. Plan a route to highlight the nearest station to your destination.";
      }
    })
    .catch(function () {
      staticAmenitiesLoading = false;
      if (panel)
        panel.textContent =
          "Could not load station data right now. Check your connection and refresh the page.";
    });
}

function openMessengerWindow(path, toPhone, lat, lng) {
  var q = "?to=" + encodeURIComponent(toPhone || "");
  if (lat != null && lng != null) q += "&lat=" + encodeURIComponent(String(lat)) + "&lng=" + encodeURIComponent(String(lng));
  window.open(
    path + q,
    "CrimeSpotMsg",
    "width=400,height=560,noopener,noreferrer,left=120,top=80"
  );
}

async function getCoordinates(place) {
  var url = "https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(place);
  var response = await fetch(url);
  var data = await response.json();
  if (data.length > 0) return { lat: data[0].lat, lon: data[0].lon };
  alert("CrimeSpot: location not found.");
  return null;
}

function formatTripDuration(seconds) {
  var s = Math.round(seconds);
  var h = Math.floor(s / 3600);
  var m = Math.round((s % 3600) / 60);
  if (h > 0) return h + " h " + m + " min";
  if (m < 1) return "Under 1 min";
  return m + " min";
}

async function findRoute() {
  var start = document.getElementById("start").value.trim();
  var end = document.getElementById("end").value.trim();
  var mode = document.getElementById("transport").value;

  if (!start || !end) {
    alert("CrimeSpot: enter both start and destination.");
    return;
  }

  var startCoord = await getCoordinates(start);
  var endCoord = await getCoordinates(end);
  if (!startCoord || !endCoord) return;

  var destinationLatLng = L.latLng(endCoord.lat, endCoord.lon);

  if (routeControl) map.removeControl(routeControl);

  setRouteTimeMessage("CrimeSpot: calculating route and travel time…");

  routeControl = L.Routing.control({
    router: L.Routing.osrmv1({
      profile: mode === "walk" ? "foot" : mode === "cycle" ? "bike" : "car",
    }),
    waypoints: [L.latLng(startCoord.lat, startCoord.lon), L.latLng(endCoord.lat, endCoord.lon)],
    routeWhileDragging: false,
  }).addTo(map);

  routeControl.on("routesfound", function (e) {
    if (e.routes && e.routes.length > 0) {
      var route = e.routes[0];
      currentRouteCoords = route.coordinates;
      var timeStr = formatTripDuration(route.summary.totalTime);
      var km = (route.summary.totalDistance / 1000).toFixed(1);
      setRouteTimeMessage(
        "CrimeSpot route — est. travel time: " + timeStr + " · distance ~ " + km + " km · mode: " + mode
      );
    }
  });

  calculateSafetyScoreAtDestination(destinationLatLng);
  showAreaAnalysis(endCoord.lat, endCoord.lon);
  findNearestPolice(endCoord.lat, endCoord.lon);
}

function enableReport() {
  reporting = true;
  alert("CrimeSpot: click the map where the incident happened.");
}

map.on("click", function (e) {
  if (!reporting) return;
  var type = prompt("Report type: crime / accident / animal / dark / infrastructure");
  if (!type) return;
  var title = prompt("Short title");
  var description = prompt("Details");
  if (!title) return;

  var iconType =
    type === "crime"
      ? crimeIcon
      : type === "accident"
        ? accidentIcon
        : type === "animal"
          ? animalIcon
          : type === "dark"
            ? darkRoadIcon
            : type === "infrastructure"
              ? infraIcon
              : unsafeIcon;

  var marker = L.marker([e.latlng.lat, e.latlng.lng], { icon: iconType })
    .addTo(map)
    .bindPopup("<strong>" + title + "</strong><br>" + description);

  crimeMarkers.push(marker);
  heatPoints.push([e.latlng.lat, e.latlng.lng, 1]);
  updateHeatmap();
  calculateSafetyScore();

  reporting = false;
});

function calculateSafetyScore() {
  var center = map.getCenter();
  var score = computeSafetyScoreForPoint(center, 12);
  setSafetyLabel(score, "map center · 12 km");
}

function calculateSafetyScoreAtDestination(destLatLng) {
  var score = computeSafetyScoreForPoint(destLatLng, 20);
  setSafetyLabel(score, "destination · 20 km");
}

function updateHeatmap() {
  if (heatLayer) map.removeLayer(heatLayer);
  heatLayer = L.heatLayer(heatPoints, {
    radius: 30,
    blur: 25,
    maxZoom: 17,
    gradient: { 0.2: "#1b5e20", 0.45: "#c6ff00", 0.65: "#ff9800", 0.85: "#b71c1c" },
  }).addTo(map);
}

function loadInitialReports() {
  initialReports.forEach(function (report) {
    var iconType =
      report.type === "crime" ? crimeIcon : report.type === "accident" ? accidentIcon : unsafeIcon;
    var marker = L.marker([report.lat, report.lng], { icon: iconType })
      .addTo(map)
      .bindPopup("<strong>" + report.title + "</strong><br>" + report.description);
    crimeMarkers.push(marker);
    heatPoints.push([report.lat, report.lng, 1]);
  });
  updateHeatmap();
  calculateSafetyScore();
}

function generateSyntheticReports() {
  for (var i = 0; i < 200; i++) {
    var location = randomLocation();
    var sector = sectors[Math.floor(Math.random() * sectors.length)];
    var crime = crimeTypes[Math.floor(Math.random() * crimeTypes.length)];
    var description = sector + " — " + crime;

    var iconType =
      crime.includes("theft") || crime.includes("snatching") || crime.includes("burglary")
        ? crimeIcon
        : crime.includes("accident") || crime.includes("collision") || crime.includes("crash")
          ? accidentIcon
          : unsafeIcon;

    var marker = L.marker([location.lat, location.lng], { icon: iconType })
      .addTo(map)
      .bindPopup(description);

    crimeMarkers.push(marker);
    heatPoints.push([location.lat, location.lng, 1]);
  }
  updateHeatmap();
  calculateSafetyScore();
}

function renderNews() {
  if (window.renderCrimeSpotNewsList) window.renderCrimeSpotNewsList();
}

function filterNews() {
  renderNews();
}

function driveRoute() {
  if (currentRouteCoords.length === 0) {
    alert("CrimeSpot: find a route first.");
    return;
  }
  if (driveMarker) map.removeLayer(driveMarker);
  driveMarker = L.marker(currentRouteCoords[0], {
    icon: L.icon({
      iconUrl: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
      iconSize: [32, 32],
    }),
  }).addTo(map);

  var index = 0;
  var interval = setInterval(function () {
    index++;
    if (index >= currentRouteCoords.length) clearInterval(interval);
    else {
      driveMarker.setLatLng(currentRouteCoords[index]);
      map.panTo(currentRouteCoords[index]);
    }
  }, 300);
}

function startLiveLocation() {
  if (!navigator.geolocation) {
    alert("CrimeSpot: geolocation not supported.");
    return;
  }
  sharePopupOpened = false;
  navigator.geolocation.watchPosition(
    function (position) {
      var lat = position.coords.latitude;
      var lng = position.coords.longitude;
      var userLatLng = L.latLng(lat, lng);

      if (!liveLocationMarker) {
        liveLocationMarker = L.marker(userLatLng, {
          icon: L.icon({
            iconUrl: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
            iconSize: [32, 32],
          }),
        })
          .addTo(map)
          .bindPopup("CrimeSpot — your live position");
      } else {
        liveLocationMarker.setLatLng(userLatLng);
      }
      map.panTo(userLatLng);

      if (!sharePopupOpened) {
        sharePopupOpened = true;
        var p = getCrimeSpotProfile();
        var to = (p && (p.emergencyPhone || p.phone)) || "+91 00000 00000";
        openMessengerWindow("share-live.html", to, lat, lng);
      }
    },
    function () {
      alert("CrimeSpot: unable to read your location.");
    },
    { enableHighAccuracy: true, maximumAge: 10000 }
  );
}

function sendEmergencyAlert() {
  if (!navigator.geolocation) {
    alert("CrimeSpot: geolocation not supported.");
    return;
  }
  var p = getCrimeSpotProfile();
  var to = (p && (p.emergencyPhone || p.phone)) || "+91 00000 00000";

  navigator.geolocation.getCurrentPosition(
    function (position) {
      var lat = position.coords.latitude;
      var lng = position.coords.longitude;
      openMessengerWindow("sos.html", to, lat, lng);
    },
    function () {
      openMessengerWindow("sos.html", to, null, null);
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

function showAreaAnalysis(lat, lng) {
  var destination = L.latLng(lat, lng);
  var crimeCount = 0,
    trafficCount = 0,
    animalCount = 0,
    darkCount = 0,
    infraCount = 0;

  crimeMarkers.forEach(function (marker) {
    var distance = destination.distanceTo(marker.getLatLng()) / 1000;
    if (distance > 5) return;
    var text = marker.getPopup().getContent().toLowerCase();
    if (text.includes("theft") || text.includes("snatching") || text.includes("burglary")) crimeCount++;
    else if (text.includes("accident") || text.includes("collision") || text.includes("crash")) trafficCount++;
    else if (text.includes("animal")) animalCount++;
    else if (text.includes("dark")) darkCount++;
    else infraCount++;
  });

  var safetyScore = computeSafetyScoreForPoint(destination, 5);

  var areaType = "Urban";
  if (animalCount > 3) areaType = "Wildlife / fringe zone signal";
  else if (infraCount > 3) areaType = "Infra / service pockets";
  else if (darkCount > 3) areaType = "Low-light corridors";

  var safetyLevel = "Comfortable";
  if (safetyScore < 72) safetyLevel = "Elevated attention";
  if (safetyScore < 58) safetyLevel = "Higher caution";

  var popupContent =
    "<h2>CrimeSpot area brief</h2>" +
    "<b>Safety score:</b> " +
    safetyScore +
    "/100<br>" +
    "<b>Guide level:</b> " +
    safetyLevel +
    "<br>" +
    "<b>Area signal:</b> " +
    areaType +
    "<br><br>" +
    "<b>Crime-weighted points (5 km):</b> " +
    crimeCount +
    "<br>" +
    "<b>Traffic incidents:</b> " +
    trafficCount +
    "<br>" +
    "<b>Other flags:</b> animal " +
    animalCount +
    ", lighting " +
    darkCount +
    ", infra " +
    infraCount +
    "<br><br>" +
    "<b>CrimeSpot tips:</b> prefer main roads, share ETA with someone you trust, keep emergency numbers ready.";

  var reportEl = document.getElementById("safetyReport");
  var modalEl = document.getElementById("safetyModal");
  if (reportEl) reportEl.innerHTML = popupContent;
  if (modalEl) modalEl.style.display = "block";

  var closeBtn = document.getElementById("closeSafety");
  if (closeBtn) {
    closeBtn.onclick = function () {
      modalEl.style.display = "none";
    };
  }

  findNearestPolice(lat, lng);
}

function findNearestPolice(lat, lng) {
  var panel = document.getElementById("nearestPoliceText");
  if (!policeStaticData.length) {
    if (!staticAmenitiesLoading && !staticAmenitiesLoaded) loadStaticAmenities();
    if (panel)
      panel.textContent =
        "Station markers are loading on the map. Use Find route again in a moment for nearest details.";
    return;
  }

  var best = null;
  var bestD = Infinity;
  policeStaticData.forEach(function (p) {
    var d = L.latLng(lat, lng).distanceTo(L.latLng(p.lat, p.lon));
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  });

  if (!best) {
    if (panel) panel.textContent = "No police station data available for this view yet.";
    return;
  }

  if (panel) {
    panel.innerHTML =
      "<strong>Nearest to your destination</strong><br>" +
      escapeHtml(best.name) +
      "<br>~ " +
      (bestD / 1000).toFixed(1) +
      " km<br><small>All police stations and bus stops are marked on the map.</small>";
  }
}

function escapeHtml(s) {
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

map.whenReady(function () {
  loadStaticAmenities();
});

loadInitialReports();
generateSyntheticReports();
renderNews();

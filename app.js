const map = L.map("map", {
  crs: L.CRS.Simple,
  zoomControl: false
});
map.attributionControl.addAttribution("made by Sinrai");
map.createPane("contentPane");
map.getPane("contentPane").style.zIndex = 650;
map.getPane("tooltipPane").style.zIndex = 700;

const zoomControl = L.control.zoom({ position: "bottomright" });
zoomControl.addTo(map);
let levelControlContainer = null;
let hasMultipleLevels = false;

const urlParams = new URLSearchParams(window.location.search);
const requestedZoom = Number.parseFloat(urlParams.get("zoom") ?? "");
const requestedLevel = Number.parseInt(urlParams.get("level") ?? "", 10);
const state = {
  zoneSlug: urlParams.get("zone") || "crash_site_outpost",
  showZoomDebug: urlParams.get("debug") === "1",
  requestedZoom: Number.isFinite(requestedZoom) ? requestedZoom : null,
  requestedLevel: Number.isInteger(requestedLevel) ? requestedLevel : null,
  regionZoomThreshold: 0,
  activeLevel: 0,
  worldLayers: [],
  regionalLayers: [],
  contentLayers: []
};

function toLeafletBounds(bounds) {
  const [[minX, minY], [maxX, maxY]] = bounds;
  return L.latLngBounds(L.latLng(minY, minX), L.latLng(maxY, maxX));
}

function updateLayerVisibility() {
  const zoom = map.getZoom();
  const inRegionalMode = zoom > state.regionZoomThreshold;
  const showWorldByZoom = !inRegionalMode;
  const showRegionalsByZoom = inRegionalMode;

  for (const layerDef of state.worldLayers) {
    const shouldShow = showWorldByZoom;
    if (shouldShow) {
      layerDef.layer.addTo(map);
    } else {
      map.removeLayer(layerDef.layer);
    }
  }

  for (const layerDef of state.regionalLayers) {
    const shouldShow = showRegionalsByZoom && layerDef.level === state.activeLevel;
    if (shouldShow) {
      layerDef.layer.addTo(map);
    } else {
      map.removeLayer(layerDef.layer);
    }
  }

  for (const contentLayer of state.contentLayers) {
    if (contentLayer.enabled) {
      let visibleMarkerCount = 0;
      for (const markerEntry of contentLayer.markers) {
        const shouldShowMarker = !inRegionalMode || markerEntry.level === state.activeLevel;
        if (shouldShowMarker) {
          if (!contentLayer.group.hasLayer(markerEntry.marker)) {
            contentLayer.group.addLayer(markerEntry.marker);
          }
          visibleMarkerCount += 1;
        } else if (contentLayer.group.hasLayer(markerEntry.marker)) {
          contentLayer.group.removeLayer(markerEntry.marker);
        }
      }

      if (visibleMarkerCount > 0) {
        contentLayer.group.addTo(map);
      } else {
        map.removeLayer(contentLayer.group);
      }

      contentLayer.group.eachLayer((marker) => {
        if (typeof marker.bringToFront === "function") {
          marker.bringToFront();
        }
      });
    } else {
      map.removeLayer(contentLayer.group);
    }
  }

  if (levelControlContainer) {
    levelControlContainer.style.display = hasMultipleLevels && inRegionalMode ? "" : "none";
  }
}

function createCoordsControl() {
  const CoordsControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const container = L.DomUtil.create("div", "swtor-control coords-control");
      container.innerHTML = `<div class="coords-value" id="coordsValue">x:    - | y:    -</div>`;
      L.DomEvent.disableClickPropagation(container);
      return container;
    }
  });
  map.addControl(new CoordsControl());
}

function createZoomDebugControl() {
  if (!state.showZoomDebug) {
    return;
  }
  if (document.getElementById("zoomDebugValue")) {
    return;
  }

  const container = document.createElement("div");
  container.className = "swtor-control zoom-debug-box";
  container.innerHTML = `<div class="coords-value" id="zoomDebugValue">zoom: -</div>`;
  document.body.appendChild(container);
}

function formatCoord(value) {
  const rounded = String(Math.round(value * 10));
  const maxFour = rounded.length > 4 ? rounded.slice(0, 4) : rounded;
  return maxFour.padStart(4, " ");
}

function updateZoomDebugValue() {
  if (!state.showZoomDebug) {
    return;
  }

  const zoomDebugValue = document.getElementById("zoomDebugValue");
  if (zoomDebugValue) {
    zoomDebugValue.textContent = `zoom: ${map.getZoom().toFixed(2)}`;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveAssetUrl(zoneAssetBase, assetPath) {
  const path = String(assetPath || "");
  if (!path) {
    return "";
  }
  if (/^(https?:)?\/\//.test(path)) {
    return path;
  }
  return `${zoneAssetBase}/${path.replace(/^\/+/, "")}`;
}

function markerCoordsToLatLng(coord) {
  const [x10, y10] = coord;
  return L.latLng(-Number(y10) / 10, Number(x10) / 10);
}

function createPopupHtml(markerDef, layerDef, zoneAssetBase) {
  const x10 = Number(markerDef.coord[0]);
  const y10 = Number(markerDef.coord[1]);
  const name = escapeHtml(markerDef.name || markerDef.id || "Marker");

  const markerImage = markerDef.image || layerDef.image || "";
  const markerLink = markerDef.link || layerDef.link || "";
  const imageUrl = markerImage ? resolveAssetUrl(zoneAssetBase, markerImage) : "";

  let mediaHtml = "";
  if (imageUrl) {
    mediaHtml += `<div class="popup-image-wrap"><img src="${escapeHtml(imageUrl)}" alt="${name}" class="popup-image" /></div>`;
  }
  if (markerLink) {
    const safeLink = escapeHtml(markerLink);
    mediaHtml += `<div class="popup-link-wrap"><a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeLink}</a></div>`;
  }

  return `
    <div class="popup-content">
      <div class="popup-title">${name}</div>
      <div class="popup-coords">x: ${x10}, y: ${y10}</div>
      ${mediaHtml}
    </div>
  `;
}

function createLegendControl(contentLayers) {
  const LegendControl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const container = L.DomUtil.create("div", "swtor-control layer-legend");
      const rows = contentLayers
        .map((layer) => {
          const color = escapeHtml(layer.marker?.color || "#ffffff");
          const name = escapeHtml(layer.name || layer.id || "Layer");
          const checked = layer.enabled ? "checked" : "";
          return `
            <div class="legend-row">
              <input type="checkbox" class="legend-toggle" data-layer-id="${escapeHtml(layer.id || "")}" ${checked} />
              <span class="legend-swatch" style="background:${color}"></span>
              <span class="legend-name">${name}</span>
            </div>
          `;
        })
        .join("");
      container.innerHTML = rows || "<div>No layers found</div>";
      L.DomEvent.disableClickPropagation(container);
      return container;
    }
  });

  const control = new LegendControl();
  map.addControl(control);

  document.querySelectorAll(".legend-toggle").forEach((el) => {
    el.addEventListener("change", (event) => {
      const layerId = event.currentTarget.dataset.layerId;
      const layer = state.contentLayers.find((entry) => entry.id === layerId);
      if (!layer) {
        return;
      }
      layer.enabled = event.currentTarget.checked;
      updateLayerVisibility();
    });
  });
}

async function loadContentLayers(zoneAssetBase) {
  try {
    const response = await fetch(`${zoneAssetBase}/layers.json`);
    if (!response.ok) {
      console.warn("layers.json not found or unavailable, skipping layers overlay.");
      return;
    }

    const data = await response.json();
    const layers = Array.isArray(data.layers) ? data.layers : [];

    for (const layerDef of layers) {
      const markerType = layerDef.marker?.type || "circle";
      if (markerType !== "circle") {
        console.warn(`Unsupported marker type '${markerType}' for layer '${layerDef.id}'.`);
        continue;
      }

      const markerSize = Number(layerDef.marker?.size || 8);
      const markerColor = String(layerDef.marker?.color || "#ffffff");
      const showLabels = layerDef.show_labels === true;
      const markers = Array.isArray(layerDef.markers) ? layerDef.markers : [];
      const group = L.layerGroup();
      const markerEntries = [];

      for (const markerDef of markers) {
        if (!Array.isArray(markerDef.coord) || markerDef.coord.length < 2) {
          continue;
        }

        const latLng = markerCoordsToLatLng(markerDef.coord);
        const marker = L.circleMarker(latLng, {
          radius: markerSize,
          color: markerColor,
          fillColor: markerColor,
          fillOpacity: 0.95,
          weight: 1,
          pane: "contentPane"
        });

        marker.bindPopup(createPopupHtml(markerDef, layerDef, zoneAssetBase));
        if (showLabels) {
          marker.bindTooltip(markerDef.name || markerDef.id || "Marker", {
            permanent: true,
            direction: "top",
            className: "marker-label",
            offset: [0, -markerSize]
          });
        }

        const markerLevel = Number.isFinite(Number(markerDef.level))
          ? Number(markerDef.level)
          : 0;
        markerEntries.push({
          marker,
          level: markerLevel
        });
      }

      state.contentLayers.push({
        id: String(layerDef.id || ""),
        name: String(layerDef.name || layerDef.id || "Layer"),
        marker: layerDef.marker || {},
        enabled: layerDef.enabled !== false,
        group,
        markers: markerEntries
      });
    }

    if (state.contentLayers.length > 0) {
      createLegendControl(state.contentLayers);
    }
  } catch (error) {
    console.warn("Failed to load layers.json, skipping content layers:", error);
  }
}

function createLevelControl(levels) {
  const sortedLevels = [...levels].sort((a, b) => b - a);
  const LevelControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const container = L.DomUtil.create("div", "swtor-control level-switcher center-left");
      const rows = sortedLevels
        .map((level) => {
          const activeClass = level === state.activeLevel ? "is-active" : "";
          return `<button type="button" class="level-btn ${activeClass}" data-level="${level}">${level}</button>`;
        })
        .join("");

      container.innerHTML = `<div class="level-switcher-panel">${rows || "<div>No levels found</div>"}</div>`;
      L.DomEvent.disableClickPropagation(container);
      levelControlContainer = container;
      return container;
    }
  });

  const control = new LevelControl();
  map.addControl(control);

  document.querySelectorAll(".level-btn").forEach((el) => {
    el.addEventListener("click", (event) => {
      state.activeLevel = Number(event.currentTarget.dataset.level);
      document.querySelectorAll(".level-btn").forEach((button) => {
        button.classList.toggle(
          "is-active",
          Number(button.dataset.level) === state.activeLevel
        );
      });
      updateLayerVisibility();
    });
  });
}

function createFullscreenControl() {
  const zoomContainer = document.querySelector(".leaflet-control-zoom");
  if (!zoomContainer || zoomContainer.querySelector(".fullscreen-btn")) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "fullscreen-btn";
  button.title = "Toggle fullscreen";
  button.textContent = "⛶";
  L.DomEvent.disableClickPropagation(button);
  L.DomEvent.on(button, "click", async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  });
  zoomContainer.appendChild(button);
}

function showStatus(message) {
  const banner = document.createElement("div");
  banner.className = "status-banner";
  banner.textContent = message;
  document.body.appendChild(banner);
  return banner;
}

async function loadZone() {
  const status = showStatus(`Loading zone: ${state.zoneSlug}`);
  try {
    const zoneAssetBase = `assets/${state.zoneSlug}`;
    const response = await fetch(`${zoneAssetBase}/zone.json`);
    if (!response.ok) {
      throw new Error(`Could not load zone.json for "${state.zoneSlug}"`);
    }

    const zoneData = await response.json();
    state.regionZoomThreshold = Number(zoneData.region_zoom_threshold ?? 0);

    const maps = Array.isArray(zoneData.maps) ? zoneData.maps : [];
    if (maps.length === 0) {
      throw new Error("zone.json has no maps.");
    }

    let combinedBounds = null;
    for (const mapDef of maps) {
      if (mapDef.hidden === true) {
        continue;
      }

      const imagePath = String(mapDef.image || "");
      const imageUrl = /^(https?:)?\/\//.test(imagePath)
        ? imagePath
        : `${zoneAssetBase}/${imagePath.replace(/^\/+/, "")}`;
      const bounds = toLeafletBounds(mapDef.bounds);
      const overlay = L.imageOverlay(imageUrl, bounds, {
        opacity: 1
      });
      overlay.setZIndex(1000 + Number(mapDef.draw_priority || 0));

      const layerDef = {
        name: mapDef.name,
        layer: overlay,
        level: Number(mapDef.level || 0),
        bounds
      };

      if (!combinedBounds) {
        combinedBounds = L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
      } else {
        combinedBounds.extend(bounds);
      }
      if (mapDef.name === "world_map") {
        state.worldLayers.push(layerDef);
      } else {
        state.regionalLayers.push(layerDef);
      }
    }

    state.regionalLayers.sort((a, b) => a.level - b.level);

    const regionalLevels = Array.from(
      new Set(state.regionalLayers.map((layerDef) => layerDef.level))
    ).sort((a, b) => a - b);
    hasMultipleLevels = regionalLevels.length > 1;

    state.activeLevel = regionalLevels.includes(0) ? 0 : (regionalLevels[0] ?? 0);
    if (
      state.requestedLevel !== null &&
      regionalLevels.includes(state.requestedLevel)
    ) {
      state.activeLevel = state.requestedLevel;
    }

    map.fitBounds(combinedBounds, { padding: [20, 20] });
    map.setMaxBounds(combinedBounds.pad(0.35));
    if (state.requestedZoom !== null) {
      map.setZoom(state.requestedZoom);
    }

    createCoordsControl();
    createZoomDebugControl();
    createLevelControl(regionalLevels);
    createFullscreenControl();
    await loadContentLayers(zoneAssetBase);

    map.on("zoomend", () => {
      updateLayerVisibility();
      updateZoomDebugValue();
    });
    map.on("mousemove", (event) => {
      const x = event.latlng.lng;
      const y = event.latlng.lat;
      const coordsValue = document.getElementById("coordsValue");
      if (coordsValue) {
        coordsValue.textContent = `x: ${formatCoord(x)} | y: ${formatCoord(-y)}`;
      }
    });

    updateLayerVisibility();
    updateZoomDebugValue();
    status.remove();
  } catch (error) {
    status.textContent = error.message;
    console.error(error);
  }
}

loadZone();

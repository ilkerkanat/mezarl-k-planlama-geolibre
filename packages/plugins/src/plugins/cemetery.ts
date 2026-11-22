import type { GeoLibreAppAPI, GeoLibrePlugin } from "../types";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

export const CEMETERY_PLANNER_PLUGIN_ID = "cemetery-planner";
const CEMETERY_BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export const CEMETERY_LAYER_BOUNDARY = "Cemetery Boundary";
export const CEMETERY_LAYER_ROADS = "Cemetery Roads";
export const CEMETERY_LAYER_PLOTS = "Cemetery Plots";
export const CEMETERY_LAYER_GRAVES = "Cemetery Graves";

const PANEL_ID = "cemetery-info-panel";

export type CemeteryTur = "normal" | "aile" | "katli";

export interface CemeteryOranlar {
  aile: number;
  cocuk: number;
  normal: number;
}

export interface CemeteryPlanInput {
  boundary: Feature<Polygon | MultiPolygon> | null;
  oranlar: CemeteryOranlar;
}

export interface CemeteryPlan {
  boundary: Feature<Polygon | MultiPolygon> | null;
  roads: FeatureCollection;
  plots: FeatureCollection;
  graves: FeatureCollection;
}

export interface CemeteryPlanStats {
  normalMezar: number;
  aileMezar: number;
  katliMezar: number;
  toplamKisi: number;
  cesme: number;
  otopark: number;
  kapi: number;
}

const PERIMETER_ROAD_WIDTH_M = 4;
const PLOT_PAYASI = 0.6;
const PLOT_BOYUTU_M2: Record<string, number> = { aile: 40, cocuk: 20, normal: 30 };
const MEZAR_KAPACITE: Record<CemeteryTur, number> = { normal: 1, aile: 15, katli: 1 };

function polygonArea(feature: Feature<Polygon | MultiPolygon>): number {
  const geometry = feature.geometry;
  if (!geometry) return 0;
  const coordinates = geometry.type === "Polygon" ? geometry.coordinates : [];
  let area = 0;
  for (const ring of coordinates) {
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      area += (x1 * y2 - x2 * y1) / 2;
    }
  }
  return Math.abs(area);
}

function rectangleRing(m2: number): number[][] {
  const side = Math.sqrt(m2);
  return [
    [0, 0],
    [side, 0],
    [side, side],
    [0, side],
    [0, 0],
  ];
}

export function generateCemeteryPlan(input: CemeteryPlanInput): CemeteryPlan {
  const plan: CemeteryPlan = {
    boundary: input.boundary,
    roads: { type: "FeatureCollection", features: [] },
    plots: { type: "FeatureCollection", features: [] },
    graves: { type: "FeatureCollection", features: [] },
  };
  const boundary = input.boundary;
  if (!boundary) return plan;

  plan.roads = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: (boundary.geometry.type === "Polygon" ? boundary.geometry.coordinates[0] : []) as number[][] },
        properties: { id: "perimeter-1", tur: "perimeter", genislik: PERIMETER_ROAD_WIDTH_M },
      },
    ],
  };

  const alan = polygonArea(boundary);
  const kullanilabilirAlan = alan * PLOT_PAYASI;
  const toplamOran = input.oranlar.aile + input.oranlar.cocuk + input.oranlar.normal;
  const toplamOranKisi = toplamOran > 0 ? toplamOran : 1;

  const plotAlanlari: { tur: CemeteryTur; alan: number }[] = [
    { tur: "aile", alan: (kullanilabilirAlan * input.oranlar.aile) / toplamOranKisi },
    { tur: "katli", alan: (kullanilabilirAlan * input.oranlar.cocuk) / toplamOranKisi },
    { tur: "normal", alan: (kullanilabilirAlan * input.oranlar.normal) / toplamOranKisi },
  ];

  const plotFeatures: Feature<Polygon | MultiPolygon>[] = [];
  const graveFeatures: Feature<Polygon | MultiPolygon>[] = [];
  let plotIndex = 0;

  for (const pa of plotAlanlari) {
    if (pa.alan <= 0) continue;
    const plotBoyutu = PLOT_BOYUTU_M2[pa.tur] ?? 30;
    const adet = Math.max(1, Math.floor(pa.alan / plotBoyutu));
    const tekPlotAlani = pa.alan / adet;

    for (let i = 0; i < adet; i += 1) {
      plotIndex += 1;
      const plotId = `plot-${plotIndex}`;
      const kapaciteKisi = MEZAR_KAPACITE[pa.tur];
      const geometry: Polygon = { type: "Polygon", coordinates: [rectangleRing(tekPlotAlani)] };
      plotFeatures.push({
        type: "Feature",
        geometry,
        properties: { id: plotId, tur: pa.tur, kapaciteKisi, mezarSayisi: kapaciteKisi },
      });
      graveFeatures.push({
        type: "Feature",
        geometry,
        properties: { id: `${plotId}-mezar`, plotId, tur: pa.tur, kapaciteKisi, mezarSayisi: kapaciteKisi },
      });
    }
  }

  plan.plots = { type: "FeatureCollection", features: plotFeatures };
  plan.graves = { type: "FeatureCollection", features: graveFeatures };

  return plan;
}

export function hesaplaIstatistikler(plan: CemeteryPlan): CemeteryPlanStats {
  const plots = plan.plots.features;
  const normalMezar = plots.filter((p) => p.properties?.tur === "normal").length;
  const aileMezar = plots.filter((p) => p.properties?.tur === "aile").length;
  const katliMezar = plots.filter((p) => p.properties?.tur === "katli").length;
  const toplamKisi = plots.reduce((s, p) => s + (p.properties?.kapaciteKisi ?? 0), 0);

  const alan = plan.boundary ? polygonArea(plan.boundary) : 0;
  const cesme = Math.max(1, Math.floor(toplamKisi / 50));
  const otopark = Math.max(1, Math.floor(alan / 500));
  const kapi = Math.max(1, Math.ceil(alan / 2000));

  return { normalMezar, aileMezar, katliMezar, toplamKisi, cesme, otopark, kapi };
}

// --- UI wiring ---

let appRef: GeoLibreAppAPI | null = null;
let panelContainer: HTMLElement | null = null;
let statsEl: HTMLElement | null = null;
let layerIds: string[] = [];

function asFeatureCollection(feature: Feature): FeatureCollection {
  return { type: "FeatureCollection", features: [feature] };
}

function renderStats(stats: CemeteryPlanStats): void {
  if (!statsEl) return;
  statsEl.innerHTML = "";
  const rows: [string, number][] = [
    ["Normal Mezar", stats.normalMezar],
    ["Aile Mezarı", stats.aileMezar],
    ["Katlı Mezar", stats.katliMezar],
    ["Toplam Kişi", stats.toplamKisi],
    ["Çeşme", stats.cesme],
    ["Otopark", stats.otopark],
    ["Kapı", stats.kapi],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.padding = "2px 0";
    const l = document.createElement("span");
    l.textContent = label;
    const v = document.createElement("span");
    v.textContent = String(value);
    v.style.fontWeight = "bold";
    row.appendChild(l);
    row.appendChild(v);
    statsEl.appendChild(row);
  }
}

function uretPlan(): void {
  if (!appRef) return;
  const features = appRef.getDrawnFeatures?.() ?? [];
  const boundary = features.find(
    (f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
  ) as Feature<Polygon | MultiPolygon> | undefined;
  if (!boundary) {
    if (statsEl) statsEl.textContent = "Önce sınır çiz (draw)." ;
    return;
  }

  // remove previous layers
  for (const id of layerIds) appRef.removeLayer?.(id);
  layerIds = [];

  const plan = generateCemeteryPlan({ boundary, oranlar: { aile: 35, cocuk: 5, normal: 60 } });
  layerIds.push(appRef.addGeoJsonLayer(CEMETERY_LAYER_BOUNDARY, asFeatureCollection(boundary)));
  layerIds.push(appRef.addGeoJsonLayer(CEMETERY_LAYER_ROADS, plan.roads));
  layerIds.push(appRef.addGeoJsonLayer(CEMETERY_LAYER_PLOTS, plan.plots));
  layerIds.push(appRef.addGeoJsonLayer(CEMETERY_LAYER_GRAVES, plan.graves));

  renderStats(hesaplaIstatistikler(plan));
}

const floatingPanelRegistration = {
  id: PANEL_ID,
  title: "Mezarlık Planı",
  defaultWidth: 260,
  render: (container: HTMLElement) => {
    panelContainer = container;
    container.innerHTML = "";
    const btn = document.createElement("button");
    btn.textContent = "Plan Üret";
    btn.style.padding = "6px 12px";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", uretPlan);
    container.appendChild(btn);

    statsEl = document.createElement("div");
    statsEl.style.marginTop = "8px";
    container.appendChild(statsEl);
  },
};

export const cemeteryPlannerPlugin: GeoLibrePlugin = {
  id: CEMETERY_PLANNER_PLUGIN_ID,
  name: "Cemetery Planner",
  version: "0.1.0",
  activeByDefault: true,
  activate: (app: GeoLibreAppAPI) => {
    app.setBasemap(CEMETERY_BASEMAP_STYLE);
    appRef = app;
    const unregister = app.registerFloatingPanel?.(floatingPanelRegistration as any);
    void unregister;
    setTimeout(() => app.openFloatingPanel?.(PANEL_ID), 0);
    return true;
  },
  deactivate: (app: GeoLibreAppAPI) => {
    for (const id of layerIds) app.removeLayer?.(id);
    layerIds = [];
    app.closeFloatingPanel?.(PANEL_ID);
    app.unregisterFloatingPanel?.(PANEL_ID);
    appRef = null;
    panelContainer = null;
    statsEl = null;
  },
};

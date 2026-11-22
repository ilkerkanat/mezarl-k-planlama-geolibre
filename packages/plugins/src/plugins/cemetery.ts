import type { GeoLibreAppAPI, GeoLibrePlugin } from "../types";

export const CEMETERY_PLANNER_PLUGIN_ID = "cemetery-planner";

const CEMETERY_BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export const cemeteryPlannerPlugin: GeoLibrePlugin = {
  id: CEMETERY_PLANNER_PLUGIN_ID,
  name: "Cemetery Planner",
  version: "0.1.0",
  activeByDefault: true,
  activate: (app: GeoLibreAppAPI) => {
    app.setBasemap(CEMETERY_BASEMAP_STYLE);
    return true;
  },
  deactivate: () => {
    /* Basemap stays until the user changes it. */
  },
};

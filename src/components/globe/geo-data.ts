// Re-exports the real coastline dataset and provides city node positions.

export type LatLon = [number, number];

export { COASTLINE_DATA as CONTINENT_OUTLINES } from "./coastline-data";

// City nodes: [latitude, longitude, label]
export const NODE_POSITIONS: [number, number, string][] = [
  [40.71, -74.01, "New York"],
  [51.51, -0.13, "London"],
  [48.86, 2.35, "Paris"],
  [35.68, 139.69, "Tokyo"],
  [22.32, 114.17, "Hong Kong"],
  [1.35, 103.82, "Singapore"],
  [-33.87, 151.21, "Sydney"],
  [37.57, 127.0, "Seoul"],
  [55.76, 37.62, "Moscow"],
  [19.43, -99.13, "Mexico City"],
  [-23.55, -46.63, "São Paulo"],
  [28.61, 77.21, "New Delhi"],
  [39.91, 116.39, "Beijing"],
  [-1.29, 36.82, "Nairobi"],
  [25.2, 55.27, "Dubai"],
  [52.52, 13.41, "Berlin"],
  [34.05, -118.24, "Los Angeles"],
  [43.65, -79.38, "Toronto"],
  [30.04, 31.24, "Cairo"],
  [-34.6, -58.38, "Buenos Aires"],
  [13.76, 100.5, "Bangkok"],
  [41.01, 28.98, "Istanbul"],
  [59.33, 18.07, "Stockholm"],
  [47.5, 19.04, "Budapest"],
  [35.69, 51.39, "Tehran"],
  [-6.21, 106.85, "Jakarta"],
  [14.6, 120.98, "Manila"],
  [33.59, -7.61, "Casablanca"],
  [37.78, -122.42, "San Francisco"],
  [-26.2, 28.04, "Johannesburg"],
];

// Curated global observing sites for the location picker.
//
// `lat`/`lng` are signed decimal degrees (N/E positive); `elevation` in metres.
// A selected site feeds StellariumBridge.setLocation(lat, lng, elevation), which
// re-parks the night-locked clock for the new longitude. See config.nightSky.

export const OBSERVING_LOCATIONS = [
  {
    region: "North America",
    sites: [
      { name: "Montréal",      country: "Canada",        lat: 45.50, lng: -73.57,  elevation: 50,   desc: "Default observer — urban northern sky." },
      { name: "Mauna Kea",     country: "USA (Hawaii)",  lat: 19.82, lng: -155.47, elevation: 4205, desc: "13,800 ft summit; among Earth's darkest skies." },
      { name: "Kitt Peak",     country: "USA (Arizona)", lat: 31.96, lng: -111.60, elevation: 2096, desc: "Sonoran Desert observatory ridge." },
      { name: "McDonald Obs.", country: "USA (Texas)",   lat: 30.67, lng: -104.02, elevation: 2070, desc: "Davis Mountains dark-sky reserve." },
      { name: "Mexico City",   country: "Mexico",        lat: 19.43, lng: -99.13,  elevation: 2240, desc: "Low-latitude city; ecliptic rides high." },
    ],
  },
  {
    region: "South America",
    sites: [
      { name: "Cerro Paranal", country: "Chile",         lat: -24.63, lng: -70.40, elevation: 2635, desc: "Atacama; ESO VLT — exceptional transparency." },
      { name: "La Silla",      country: "Chile",         lat: -29.26, lng: -70.73, elevation: 2400, desc: "Southern Atacama ridge observatory." },
      { name: "Cusco",         country: "Peru",          lat: -13.53, lng: -71.97, elevation: 3399, desc: "High Andes; Magellanic Clouds overhead." },
      { name: "Quito",         country: "Ecuador",       lat:  -0.18, lng: -78.47, elevation: 2850, desc: "On the equator — both poles graze the horizon." },
    ],
  },
  {
    region: "Europe",
    sites: [
      { name: "Roque de los Muchachos", country: "Spain (La Palma)", lat: 28.76, lng: -17.89, elevation: 2396, desc: "Canary ridge above the cloud layer." },
      { name: "Greenwich",     country: "UK",            lat: 51.48, lng:  0.00,  elevation: 47,   desc: "The prime meridian, 0° longitude." },
      { name: "Reykjavík",     country: "Iceland",       lat: 64.15, lng: -21.94, elevation: 40,   desc: "Sub-Arctic; aurora latitudes." },
      { name: "Calar Alto",    country: "Spain",         lat: 37.22, lng:  -2.55, elevation: 2168, desc: "Andalusian high-desert observatory." },
      { name: "Pic du Midi",   country: "France",        lat: 42.94, lng:   0.14, elevation: 2877, desc: "Pyrenees summit observatory." },
    ],
  },
  {
    region: "Africa & Middle East",
    sites: [
      { name: "Sutherland (SAAO)", country: "South Africa", lat: -32.38, lng: 20.81, elevation: 1798, desc: "Karoo plateau; deep southern sky." },
      { name: "Cairo",         country: "Egypt",         lat:  30.04, lng: 31.24,  elevation: 23,   desc: "Where much of our star naming began." },
      { name: "Oukaïmeden",    country: "Morocco",       lat:  31.21, lng: -7.87,  elevation: 2700, desc: "High Atlas observatory." },
      { name: "Cape Town",     country: "South Africa",  lat: -33.93, lng: 18.42,  elevation: 25,   desc: "Southern Cross near the zenith." },
    ],
  },
  {
    region: "Asia & Oceania",
    sites: [
      { name: "Siding Spring", country: "Australia",     lat: -31.27, lng: 149.07, elevation: 1165, desc: "Warrumbungle dark-sky park." },
      { name: "Mt. John (UC)", country: "New Zealand",   lat: -43.99, lng: 170.46, elevation: 1029, desc: "Aoraki Mackenzie dark-sky reserve." },
      { name: "Ladakh (IAO)",  country: "India",         lat:  32.78, lng: 78.96,  elevation: 4500, desc: "Hanle, 14,800 ft Himalayan desert." },
      { name: "Tokyo",         country: "Japan",         lat:  35.68, lng: 139.69, elevation: 40,   desc: "Mid-northern megacity sky." },
      { name: "Singapore",     country: "Singapore",     lat:   1.35, lng: 103.82, elevation: 15,   desc: "Near-equatorial; celestial equator overhead." },
    ],
  },
  {
    region: "Polar",
    sites: [
      { name: "South Pole (Amundsen–Scott)", country: "Antarctica", lat: -90.00, lng: 0.00, elevation: 2835, desc: "Sky rotates flat; the south pole is the zenith." },
      { name: "Svalbard",      country: "Norway",        lat:  78.22, lng: 15.65,  elevation: 30,   desc: "High Arctic; months-long polar night." },
    ],
  },
];

// Flattened lookup of every site (carries its region for filtering/search).
export const ALL_SITES = OBSERVING_LOCATIONS.flatMap((g) =>
  g.sites.map((s) => ({ ...s, region: g.region }))
);

// Pretty-print signed decimal degrees, e.g. "45.5°N" / "73.6°W".
export function fmtLat(lat) { return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`; }
export function fmtLng(lng) { return `${Math.abs(lng).toFixed(1)}°${lng >= 0 ? "E" : "W"}`; }

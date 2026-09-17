export type Language = 'ka' | 'en';

export interface Translations {
  searchPlaceholder: string;
  route: string;
  showRoute: string;
  startNavigation: string;
  distance: string;
  duration: string;
  currentLocation: string;
  noResults: string;
  searchError: string;
  destination: string;
  clearDestination: string;
  calculating: string;
  routeError: string;
  locationError: string;
  locationDenied: string;
  locationUnavailable: string;
  km: string;
  min: string;
  hours: string;
  zoomIn: string;
  zoomOut: string;
  locateMe: string;
  loading: string;
  mapLoadError: string;
  networkError: string;
  retry: string;
  close: string;
  via: string;
  drivingRoute: string;
  searchingFor: string;
  tapToRoute: string;
  routeReady: string;
  clearRoute: string;
  geocodingError: string;
  permissionRequired: string;
  enableLocation: string;
  appName: string;
  // Map style
  mapStyle: string;
  styleStandard: string;
  styleDark: string;
  styleSatellite: string;
  styleStreets: string;
  // Follow vehicle
  followVehicle: string;
  // Traffic
  traffic: string;
  // Routes
  routes: string;
  fastest: string;
  alternative: string;
  navigateHere: string;
  recalculateRoute: string;
  highway: string;
  mainRoad: string;
  localRoad: string;
  // Tap to navigate
  tapDestination: string;
  replaceDestination: string;
  cancelPin: string;
  remainingDistance: string;
  eta: string;
  offRoute: string;
  // Recenter / compass button
  recenter: string;
  // Settings / help
  settings: string;
  help: string;
  helpText: string;
  // Map controls (collapsible secondary controls panel)
  mapControls: string;
  language: string;
}

export const translations: Record<Language, Translations> = {
  ka: {
    appName: 'GeoNav',
    searchPlaceholder: 'სად გსურთ წასვლა?',
    route: 'მარშრუტი',
    showRoute: 'მარშრუტის ჩვენება',
    startNavigation: 'ნავიგაციის დაწყება',
    distance: 'მანძილი',
    duration: 'დრო',
    currentLocation: 'ჩემი მდებარეობა',
    noResults: 'შედეგები ვერ მოიძებნა',
    searchError: 'ძიებისას შეცდომა მოხდა',
    destination: 'დანიშნულება',
    clearDestination: 'გასუფთავება',
    calculating: 'მარშრუტი გამოითვლება...',
    routeError: 'მარშრუტის გამოთვლა ვერ მოხერხდა',
    locationError: 'მდებარეობა ვერ მოიძებნა',
    locationDenied: 'გთხოვთ, დაუშვათ მდებარეობაზე წვდომა',
    locationUnavailable: 'მდებარეობა მიუწვდომელია',
    km: 'კმ',
    min: 'წთ',
    hours: 'სთ',
    zoomIn: 'გადიდება',
    zoomOut: 'დაპატარავება',
    locateMe: 'ჩემი მდებარეობა',
    loading: 'იტვირთება...',
    mapLoadError: 'რუკა ვერ ჩაიტვირთა',
    networkError: 'ქსელის შეცდომა',
    retry: 'თავიდან ცდა',
    close: 'დახურვა',
    via: 'გავლით',
    drivingRoute: 'სამგზავრო მარშრუტი',
    searchingFor: 'ძიება...',
    tapToRoute: 'შეეხეთ მარშრუტის სანახავად',
    routeReady: 'მარშრუტი მზადაა',
    clearRoute: 'მარშრუტის გასუფთავება',
    geocodingError: 'მისამართი ვერ მოიძებნა',
    permissionRequired: 'მდებარეობაზე წვდომა საჭიროა',
    enableLocation: 'ადგილმდებარეობის ჩართვა',
    mapStyle: 'რუკის სტილი',
    styleStandard: 'სტანდარტული',
    styleDark: 'მუქი',
    styleSatellite: 'სატელიტი',
    styleStreets: 'ქუჩები',
    followVehicle: 'მანქანის თვალყურის დევნება',
    // Traffic
    traffic: 'ტრეფიკი',
    // Routes
    routes: 'მარშრუტები',
    fastest: 'სწრაფი',
    alternative: 'ალტერნატიული',
    navigateHere: 'აქ წასვლა',
    recalculateRoute: 'მარშრუტის ხელახლა გამოთვლა',
    highway: 'ავტომაგისტრალი',
    mainRoad: 'მთავარი გზა',
    localRoad: 'ადგილობრივი გზა',
    // Tap to navigate
    tapDestination: 'დანიშნულება',
    replaceDestination: 'დანიშნულების შეცვლა?',
    cancelPin: 'გაუქმება',
    remainingDistance: 'დარჩენილი',
    eta: 'ჩასვლა',
    offRoute: 'მარშრუტის ხელახლა გამოთვლა',
    recenter: 'ცენტრში დაბრუნება',
    settings: 'პარამეტრები',
    help: 'დახმარება',
    helpText: 'მოძებნეთ მისამართი ზემოთ და დააჭირეთ მარშრუტს ნავიგაციის დასაწყებად. გამოიყენეთ ღილაკები ეკრანის კიდეებზე რუკის მართვისთვის.',
    mapControls: 'რუკის მართვა',
    language: 'ენა',
  },
  en: {
    appName: 'GeoNav',
    searchPlaceholder: 'Where do you want to go?',
    route: 'Route',
    showRoute: 'Show Route',
    startNavigation: 'Start Navigation',
    distance: 'Distance',
    duration: 'Time',
    currentLocation: 'My Location',
    noResults: 'No results found',
    searchError: 'Search error occurred',
    destination: 'Destination',
    clearDestination: 'Clear',
    calculating: 'Calculating route...',
    routeError: 'Could not calculate route',
    locationError: 'Location not found',
    locationDenied: 'Please allow location access',
    locationUnavailable: 'Location unavailable',
    km: 'km',
    min: 'min',
    hours: 'hr',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    locateMe: 'My Location',
    loading: 'Loading...',
    mapLoadError: 'Map failed to load',
    networkError: 'Network error',
    retry: 'Retry',
    close: 'Close',
    via: 'via',
    drivingRoute: 'Driving Route',
    searchingFor: 'Searching...',
    tapToRoute: 'Tap to see route',
    routeReady: 'Route ready',
    clearRoute: 'Clear Route',
    geocodingError: 'Address not found',
    permissionRequired: 'Location access required',
    enableLocation: 'Enable Location',
    mapStyle: 'Map Style',
    styleStandard: 'Standard',
    styleDark: 'Dark',
    styleSatellite: 'Satellite',
    styleStreets: 'Streets',
    followVehicle: 'Follow Vehicle',
    // Traffic
    traffic: 'Traffic',
    // Routes
    routes: 'Routes',
    fastest: 'Fastest',
    alternative: 'Alternative',
    navigateHere: 'Navigate here',
    recalculateRoute: 'Recalculate route',
    highway: 'Highway',
    mainRoad: 'Main road',
    localRoad: 'Local road',
    // Tap to navigate
    tapDestination: 'Destination',
    replaceDestination: 'Replace destination?',
    cancelPin: 'Cancel',
    remainingDistance: 'Remaining',
    eta: 'ETA',
    offRoute: 'Recalculate route',
    recenter: 'Recenter',
    settings: 'Settings',
    help: 'Help',
    helpText: 'Search an address above and tap a route to start navigating. Use the buttons on the edges of the screen to control the map.',
    mapControls: 'Map Controls',
    language: 'Language',
  },
};

export function getTranslations(lang: Language): Translations {
  return translations[lang];
}

export const LANGUAGE_KEY = 'geonav_language';
export const MAP_STYLE_KEY = 'geonav_map_style';
export const TRAFFIC_KEY = 'geonav_traffic';

export function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'ka';
  const stored = localStorage.getItem(LANGUAGE_KEY);
  if (stored === 'ka' || stored === 'en') return stored;
  return 'ka';
}

export function setStoredLanguage(lang: Language): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LANGUAGE_KEY, lang);
}
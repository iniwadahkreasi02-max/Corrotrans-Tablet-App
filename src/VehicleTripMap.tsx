import { useEffect, useRef, useState } from 'react';
import './VehicleTripMap.css';

type Language = 'id' | 'en';
type Coordinates = { latitude: number; longitude: number };
type MapStatus = 'loading' | 'ready' | 'route' | 'routeError' | 'error';

const mapCopy = {
  id: {
    title: 'PETA GOOGLE MAPS',
    badge: 'GOOGLE MAPS · RUTE JALAN',
    loading: 'Memuat Google Maps…',
    ready: 'Peta Google siap',
    routeError: 'Rute jalan Google belum tersedia',
    mapError: 'Google Maps tidak dapat dimuat',
    routeDistance: (meters: number) => `Rute Google · ${(meters / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`,
    pickup: 'TITIK JEMPUT',
    destination: 'TUJUAN',
    mapDescription: (pickup: string, destination: string) => `Peta Google Maps untuk perjalanan. Titik jemput: ${pickup}. Tujuan: ${destination}.`,
  },
  en: {
    title: 'GOOGLE MAPS',
    badge: 'GOOGLE MAPS · ROAD ROUTE',
    loading: 'Loading Google Maps…',
    ready: 'Google map ready',
    routeError: 'Google road route is unavailable',
    mapError: 'Google Maps could not be loaded',
    routeDistance: (meters: number) => `Google route · ${(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} km`,
    pickup: 'PICKUP POINT',
    destination: 'DESTINATION',
    mapDescription: (pickup: string, destination: string) => `Google Maps for the trip. Pickup: ${pickup}. Destination: ${destination}.`,
  },
} as const;

function makeInteractiveMapUrl(pickup: Coordinates, destination: Coordinates) {
  const params = new URLSearchParams({
    lat: String(pickup.latitude),
    lng: String(pickup.longitude),
    toLat: String(destination.latitude),
    toLng: String(destination.longitude),
  });
  const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
  return `${apiBase}/api/maps/interactive?${params.toString()}`;
}

function GoogleMapFrame({
  language,
  src,
  title,
}: {
  language: Language;
  src: string;
  title: string;
}) {
  const [status, setStatus] = useState<MapStatus>('loading');
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const copy = mapCopy[language];

  useEffect(() => {
    const handleMapMessage = (event: MessageEvent) => {
      if (
        event.origin !== new URL(src, window.location.href).origin
        || event.source !== iframeRef.current?.contentWindow
        || !event.data
        || typeof event.data !== 'object'
      ) return;

      const message = event.data as { type?: unknown; distanceMeters?: unknown };
      if (message.type === 'ready') {
        setStatus((current) => current === 'loading' || current === 'error' ? 'ready' : current);
      } else if (message.type === 'route' && typeof message.distanceMeters === 'number' && Number.isFinite(message.distanceMeters)) {
        setDistanceMeters(message.distanceMeters);
        setStatus('route');
      } else if (message.type === 'routeError') {
        setStatus('routeError');
      } else if (message.type === 'error') {
        setStatus('error');
      }
    };

    const timeout = window.setTimeout(() => {
      setStatus((current) => current === 'loading' ? 'error' : current);
    }, 15_000);

    window.addEventListener('message', handleMapMessage);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', handleMapMessage);
    };
  }, [src]);

  let statusText: string | null = null;
  if (status === 'loading') statusText = copy.loading;
  else if (status === 'ready') statusText = copy.ready;
  else if (status === 'routeError') statusText = copy.routeError;
  else if (status === 'error') statusText = copy.mapError;
  else if (status === 'route' && distanceMeters !== null) statusText = copy.routeDistance(distanceMeters);

  return (
    <div className="vd-map-visual">
      <iframe
        ref={iframeRef}
        className="vd-google-map-iframe"
        src={src}
        title={title}
        loading="eager"
        referrerPolicy="strict-origin-when-cross-origin"
        onError={() => setStatus('error')}
      />
      {statusText && (
        <div
          className={`vd-map-status vd-map-status--${status}`}
          role={status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {status === 'loading' && <span className="vd-map-spinner" aria-hidden="true" />}
          <span>{statusText}</span>
        </div>
      )}
    </div>
  );
}

function RouteStops({ language, pickup, destination }: { language: Language; pickup: string; destination: string }) {
  const copy = mapCopy[language];
  return (
    <div className="vd-map-stops">
      <div className="vd-map-stop">
        <span className="vd-map-stop-dot" aria-hidden="true" />
        <div><small>{copy.pickup}</small><strong title={pickup}>{pickup}</strong></div>
      </div>
      <span className="vd-map-stop-connector" aria-hidden="true" />
      <div className="vd-map-stop vd-map-stop--destination">
        <span className="vd-map-stop-dot" aria-hidden="true" />
        <div><small>{copy.destination}</small><strong title={destination}>{destination}</strong></div>
      </div>
    </div>
  );
}

export function VehicleTripMap({
  language,
  pickup,
  pickupCoordinates,
  destination,
  destinationCoordinates,
}: {
  language: Language;
  pickup: string;
  pickupCoordinates: Coordinates;
  destination: string;
  destinationCoordinates: Coordinates;
}) {
  const copy = mapCopy[language];
  const mapUrl = makeInteractiveMapUrl(pickupCoordinates, destinationCoordinates);
  const mapDescription = copy.mapDescription(pickup, destination);

  return (
    <article className="vd-trip-map-panel" aria-labelledby="vd-trip-map-heading">
      <div className="vd-trip-map-heading">
        <span id="vd-trip-map-heading" className="vd-overline">{copy.title}</span>
        <span className="vd-map-route-badge"><i aria-hidden="true" />{copy.badge}</span>
      </div>
      <GoogleMapFrame language={language} src={mapUrl} title={mapDescription} />
      <RouteStops language={language} pickup={pickup} destination={destination} />
    </article>
  );
}
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import L from 'leaflet';
import { useAppearance } from '@/hooks/use-appearance';
import 'leaflet/dist/leaflet.css';
// Marker clustering: groups nearby markers, splits on click/zoom (spiderfy).
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

// Fit the whole Indonesian archipelago and keep the center over Indonesia.
// SW (south of Java / west of Sumatra) → NE (north Sulawesi / east Papua).
const INDONESIA_BOUNDS: L.LatLngBoundsLiteral = [
    [-11.2, 94.7],
    [6.3, 141.2],
];

// Fix default marker icons in webpack/vite bundled environments
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl:
        'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom marker icons per status
function createStatusIcon(status: string) {
    const colors: Record<string, string> = {
        online: '#10b981',
        warning: '#f59e0b',
        offline: '#ef4444',
    };
    const color = colors[status] || '#6b7280';

    return L.divIcon({
        className: 'custom-marker',
        html: `
            <div style="
                width: 28px; height: 28px;
                background: ${color};
                border: 3px solid white;
                border-radius: 50%;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                display: flex; align-items: center; justify-content: center;
            ">
                <div style="width: 8px; height: 8px; background: white; border-radius: 50%;"></div>
            </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16],
    });
}

interface LoggerMarker {
    id: number;
    name: string;
    status: 'online' | 'offline' | 'warning';
    location: string;
    lat: number;
    lng: number;
    sensorsCount: number;
    serialNumber?: string | null;
    loggerMode?: string | null;
    projectName?: string | null;
    projectColor?: string | null;
}

interface LoggerMapProps {
    loggers: LoggerMarker[];
}

const statusLabel: Record<string, string> = {
    online: '🟢 Online',
    warning: '🟡 Warning',
    offline: '🔴 Offline',
};

const lightTileLayer = {
    attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    subdomains: 'abc',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
};

const darkTileLayer = {
    attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (c) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[c] as string,
    );
}

// Build the marker popup as an HTML string (markercluster works with raw
// Leaflet markers, so we render the popup via bindPopup instead of <Popup/>).
function buildPopupHtml(logger: LoggerMarker): string {
    const row = (label: string, value: string) => `
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="color:#6b7280;">${label}</span>
            <span>${value}</span>
        </div>`;

    const serial = logger.serialNumber
        ? `<div style="font-size:11px;font-family:monospace;color:#9ca3af;margin-bottom:6px;">${escapeHtml(logger.serialNumber)}</div>`
        : '';

    const location = logger.location
        ? row(
              'Lokasi',
              `<span style="text-align:right;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;">${escapeHtml(logger.location)}</span>`,
          )
        : '';

    const mode = logger.loggerMode
        ? row(
              'Mode',
              `<span style="font-family:monospace;font-size:11px;background:#f3f4f6;padding:1px 6px;border-radius:4px;">${escapeHtml(logger.loggerMode)}</span>`,
          )
        : '';

    const project = logger.projectName
        ? row(
              'Project',
              `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${logger.projectColor || '#6b7280'};display:inline-block;"></span>${escapeHtml(logger.projectName)}</span>`,
          )
        : '';

    return `
        <div style="min-width:200px;font-family:system-ui,sans-serif;">
            <div style="font-weight:700;font-size:14px;margin-bottom:2px;color:#111;">${escapeHtml(logger.name)}</div>
            ${serial}
            <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;margin-bottom:8px;">
                ${row('Status', statusLabel[logger.status] || logger.status)}
                ${location}
                ${row('Sensors', `${logger.sensorsCount} sensor${logger.sensorsCount !== 1 ? 's' : ''}`)}
                ${mode}
                ${project}
            </div>
            <div style="height:1px;background:#e5e7eb;margin-bottom:8px;"></div>
            <a href="/loggers/${logger.id}" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:#3b82f6;text-decoration:none;">View Details →</a>
        </div>`;
}

// Adds all loggers to a marker cluster group on the map. Nearby markers merge
// into a numbered cluster; clicking a cluster zooms to its bounds and, once at
// max zoom, spiderfies so individual markers fan out.
function ClusteredMarkers({ loggers }: { loggers: LoggerMarker[] }) {
    const map = useMap();

    useEffect(() => {
        const group = L.markerClusterGroup({
            showCoverageOnHover: false,
            maxClusterRadius: 60,
            spiderfyOnMaxZoom: true,
            zoomToBoundsOnClick: true,
        });

        loggers.forEach((logger) => {
            const marker = L.marker([logger.lat, logger.lng], {
                icon: createStatusIcon(logger.status),
            });
            marker.bindPopup(buildPopupHtml(logger), { minWidth: 200 });
            group.addLayer(marker);
        });

        map.addLayer(group);

        return () => {
            map.removeLayer(group);
        };
    }, [loggers, map]);

    return null;
}

export default function LoggerMap({ loggers }: LoggerMapProps) {
    const { resolvedAppearance } = useAppearance();
    const activeTileLayer =
        resolvedAppearance === 'dark' ? darkTileLayer : lightTileLayer;
    // Filter loggers that have valid coordinates
    const validLoggers = loggers.filter((l) => l.lat !== 0 && l.lng !== 0);

    if (validLoggers.length === 0) {
        return (
            <div className="flex h-[400px] items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                No logger locations available.
            </div>
        );
    }

    return (
        <MapContainer
            bounds={INDONESIA_BOUNDS}
            className="logger-map"
            scrollWheelZoom={true}
            style={{
                height: '400px',
                width: '100%',
                borderRadius: '0.5rem',
                zIndex: 0,
            }}
        >
            <TileLayer
                attribution={activeTileLayer.attribution}
                maxZoom={activeTileLayer.maxZoom}
                subdomains={activeTileLayer.subdomains}
                url={activeTileLayer.url}
            />
            <ClusteredMarkers loggers={validLoggers} />
        </MapContainer>
    );
}

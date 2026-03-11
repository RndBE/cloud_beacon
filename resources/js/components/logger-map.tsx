import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from '@inertiajs/react';

// Fix default marker icons in webpack/vite bundled environments
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
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
}

interface LoggerMapProps {
    loggers: LoggerMarker[];
}

export default function LoggerMap({ loggers }: LoggerMapProps) {
    // Filter loggers that have valid coordinates
    const validLoggers = loggers.filter(l => l.lat !== 0 && l.lng !== 0);

    if (validLoggers.length === 0) {
        return (
            <div className="flex h-[400px] items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                No logger locations available.
            </div>
        );
    }

    // Calculate center from all markers
    const centerLat = validLoggers.reduce((sum, l) => sum + l.lat, 0) / validLoggers.length;
    const centerLng = validLoggers.reduce((sum, l) => sum + l.lng, 0) / validLoggers.length;

    const statusLabel: Record<string, string> = {
        online: '🟢 Online',
        warning: '🟡 Warning',
        offline: '🔴 Offline',
    };

    return (
        <MapContainer
            center={[centerLat, centerLng]}
            zoom={10}
            scrollWheelZoom={true}
            style={{ height: '400px', width: '100%', borderRadius: '0.5rem', zIndex: 0 }}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {validLoggers.map((logger) => (
                <Marker
                    key={logger.id}
                    position={[logger.lat, logger.lng]}
                    icon={createStatusIcon(logger.status)}
                >
                    <Popup>
                        <div style={{ minWidth: '180px' }}>
                            <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
                                {logger.name}
                            </div>
                            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>
                                {logger.location || 'No location set'}
                            </div>
                            <div style={{ fontSize: '12px', marginBottom: '2px' }}>
                                {statusLabel[logger.status] || logger.status}
                            </div>
                            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                                {logger.sensorsCount} sensor{logger.sensorsCount !== 1 ? 's' : ''}
                            </div>
                            <a
                                href={`/loggers/${logger.id}`}
                                style={{
                                    display: 'inline-block',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: '#3b82f6',
                                    textDecoration: 'none',
                                }}
                            >
                                View Details →
                            </a>
                        </div>
                    </Popup>
                </Marker>
            ))}
        </MapContainer>
    );
}

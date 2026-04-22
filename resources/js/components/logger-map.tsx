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
    serialNumber?: string | null;
    loggerMode?: string | null;
    projectName?: string | null;
    projectColor?: string | null;
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
                        <div style={{ minWidth: '200px', fontFamily: 'system-ui, sans-serif' }}>
                            {/* Header */}
                            <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '2px', color: '#111' }}>
                                {logger.name}
                            </div>
                            {logger.serialNumber && (
                                <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#9ca3af', marginBottom: '6px' }}>
                                    {logger.serialNumber}
                                </div>
                            )}

                            {/* Info rows */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', marginBottom: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#6b7280' }}>Status</span>
                                    <span>{statusLabel[logger.status] || logger.status}</span>
                                </div>
                                {logger.location && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ color: '#6b7280' }}>Lokasi</span>
                                        <span style={{ textAlign: 'right', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{logger.location}</span>
                                    </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#6b7280' }}>Sensors</span>
                                    <span>{logger.sensorsCount} sensor{logger.sensorsCount !== 1 ? 's' : ''}</span>
                                </div>
                                {logger.loggerMode && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ color: '#6b7280' }}>Mode</span>
                                        <span style={{ fontFamily: 'monospace', fontSize: '11px', background: '#f3f4f6', padding: '1px 6px', borderRadius: '4px' }}>{logger.loggerMode}</span>
                                    </div>
                                )}
                                {logger.projectName && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ color: '#6b7280' }}>Project</span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: logger.projectColor || '#6b7280', display: 'inline-block' }}></span>
                                            {logger.projectName}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Divider */}
                            <div style={{ height: '1px', background: '#e5e7eb', marginBottom: '8px' }}></div>

                            {/* Link */}
                            <a
                                href={`/loggers/${logger.id}`}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
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

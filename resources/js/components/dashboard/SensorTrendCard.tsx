import { useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CHART_COLORS, formatTrendTick } from '@/lib/chart-theme';

export interface TrendPoint {
    t: string;
    value: number;
}
export interface TrendData {
    points: TrendPoint[];
    unit: string | null;
    sensorName: string | null;
}
export interface TrendSensor {
    key: string;
    name: string;
    unit: string | null;
}
export interface TrendLogger {
    id: number;
    name: string;
}
export interface TrendDefaults {
    logger: number | null;
    sensor: string | null;
    range: '24h' | '7d';
}

interface Props {
    trend: TrendData;
    trendLoggers: TrendLogger[];
    trendSensors: TrendSensor[];
    trendDefaults: TrendDefaults;
}

const RANGES: { value: '24h' | '7d'; label: string }[] = [
    { value: '24h', label: '24 Jam' },
    { value: '7d', label: '7 Hari' },
];

export default function SensorTrendCard({ trend, trendLoggers, trendSensors, trendDefaults }: Props) {
    const [loggerId, setLoggerId] = useState<number | null>(trendDefaults.logger);
    const [sensorKey, setSensorKey] = useState<string | null>(trendDefaults.sensor);
    const [range, setRange] = useState<'24h' | '7d'>(trendDefaults.range);
    const [data, setData] = useState<TrendData>(trend);
    const [sensors, setSensors] = useState<TrendSensor[]>(trendSensors);
    const [loading, setLoading] = useState(false);

    async function load(nextLogger: number | null, nextSensor: string | null, nextRange: '24h' | '7d') {
        setLoading(true);
        try {
            const params = new URLSearchParams({ range: nextRange });
            if (nextLogger) params.set('logger', String(nextLogger));
            if (nextSensor) params.set('sensor', nextSensor);
            const res = await fetch(`/api/dashboard/trends?${params.toString()}`, {
                headers: { Accept: 'application/json' },
            });
            const json = await res.json();
            setData(json.trend);
            setSensors(json.sensors);
            return json as { trend: TrendData; sensors: TrendSensor[] };
        } catch {
            return null;
        } finally {
            setLoading(false);
        }
    }

    function onLogger(value: string) {
        const id = Number(value);
        setLoggerId(id);
        setSensorKey(null);
        load(id, null, range).then((json) => {
            if (json) setSensorKey(json.sensors[0]?.key ?? null);
        });
    }

    function onSensor(value: string) {
        setSensorKey(value);
        load(loggerId, value, range);
    }

    function onRange(value: '24h' | '7d') {
        setRange(value);
        load(loggerId, sensorKey, value);
    }

    const unit = data.unit ? ` (${data.unit})` : '';

    return (
        <Card className="glass-card glass-animate-in glass-delay-5">
            <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Activity className="size-5" />
                            Tren Sensor {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                        </CardTitle>
                        <CardDescription>
                            {data.sensorName ? `${data.sensorName}${unit}` : 'Data pembacaan sensor dari waktu ke waktu'}
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {trendLoggers.length > 0 && (
                            <Select value={loggerId ? String(loggerId) : undefined} onValueChange={onLogger}>
                                <SelectTrigger className="w-[150px]">
                                    <SelectValue placeholder="Logger" />
                                </SelectTrigger>
                                <SelectContent>
                                    {trendLoggers.map((l) => (
                                        <SelectItem key={l.id} value={String(l.id)}>
                                            {l.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        {sensors.length > 0 && (
                            <Select value={sensorKey ?? undefined} onValueChange={onSensor}>
                                <SelectTrigger className="w-[150px]">
                                    <SelectValue placeholder="Sensor" />
                                </SelectTrigger>
                                <SelectContent>
                                    {sensors.map((s) => (
                                        <SelectItem key={s.key} value={s.key}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <div className="flex rounded-lg border p-0.5">
                            {RANGES.map((r) => (
                                <button
                                    key={r.value}
                                    type="button"
                                    onClick={() => onRange(r.value)}
                                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                                        range === r.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {data.points.length === 0 ? (
                    <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                        Belum ada data pembacaan untuk pilihan ini
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={data.points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={CHART_COLORS.blue} stopOpacity={0.35} />
                                    <stop offset="95%" stopColor={CHART_COLORS.blue} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                            <XAxis
                                dataKey="t"
                                tickFormatter={(t: string) => formatTrendTick(t, range)}
                                tick={{ fontSize: 11 }}
                                minTickGap={24}
                            />
                            <YAxis tick={{ fontSize: 11 }} width={44} />
                            <Tooltip
                                labelFormatter={(label) => formatTrendTick(String(label), range)}
                                formatter={(value) => [`${value}${data.unit ? ' ' + data.unit : ''}`, data.sensorName ?? 'Nilai'] as [string, string]}
                                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                            />
                            <Area type="monotone" dataKey="value" stroke={CHART_COLORS.blue} strokeWidth={2} fill="url(#trendFill)" />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </CardContent>
        </Card>
    );
}

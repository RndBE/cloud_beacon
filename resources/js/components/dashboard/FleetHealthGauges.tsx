import { BatteryLow, Clock, HardDrive } from 'lucide-react';
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { healthColor } from '@/lib/chart-theme';
import type { FleetHealth } from './types';

interface Props {
    fleetHealth: FleetHealth;
}

function Gauge({ label, value, suffix = '%' }: { label: string; value: number | null; suffix?: string }) {
    const v = value ?? 0;
    const color = healthColor(v);
    return (
        <div className="flex flex-col items-center">
            <div className="relative h-[110px] w-[110px]">
                <ResponsiveContainer width="100%" height="100%">
                    <RadialBarChart
                        innerRadius="72%"
                        outerRadius="100%"
                        barSize={9}
                        data={[{ value: v }]}
                        startAngle={90}
                        endAngle={-270}
                    >
                        <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                        <RadialBar dataKey="value" cornerRadius={8} fill={color} background angleAxisId={0} />
                    </RadialBarChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-bold">{value === null ? '—' : `${v}${suffix}`}</span>
                </div>
            </div>
            <span className="mt-1 text-xs text-muted-foreground">{label}</span>
        </div>
    );
}

export default function FleetHealthGauges({ fleetHealth }: Props) {
    return (
        <Card className="glass-card glass-animate-in glass-delay-6">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <HardDrive className="size-5" />
                    Kesehatan Armada
                </CardTitle>
                <CardDescription>Rata-rata kondisi perangkat</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-3 gap-2">
                    <Gauge label="Baterai" value={fleetHealth.avgBattery} />
                    <Gauge label="Sinyal" value={fleetHealth.avgSignal} />
                    <Gauge label="SD Card" value={fleetHealth.sdPercent} />
                </div>

                <div className="mt-4 space-y-3">
                    <div>
                        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-600">
                            <BatteryLow className="size-3.5" />
                            Baterai lemah ({fleetHealth.lowBatteryCount})
                        </p>
                        {fleetHealth.lowBattery.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Tidak ada</p>
                        ) : (
                            <ul className="space-y-0.5">
                                {fleetHealth.lowBattery.slice(0, 4).map((l) => (
                                    <li key={l.name} className="flex justify-between text-xs">
                                        <span className="truncate">{l.name}</span>
                                        <span className="font-medium text-amber-600">{l.battery}%</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div>
                        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-red-600">
                            <Clock className="size-3.5" />
                            Tidak kirim data &gt;24j ({fleetHealth.staleCount})
                        </p>
                        {fleetHealth.stale.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Tidak ada</p>
                        ) : (
                            <ul className="space-y-0.5">
                                {fleetHealth.stale.slice(0, 4).map((l) => (
                                    <li key={l.name} className="flex justify-between gap-2 text-xs">
                                        <span className="truncate">{l.name}</span>
                                        <span className="shrink-0 text-muted-foreground">{l.lastDataReceivedAt ?? 'belum pernah'}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

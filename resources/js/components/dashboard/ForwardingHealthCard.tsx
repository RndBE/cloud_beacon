import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { Send } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CHART_COLORS } from '@/lib/chart-theme';
import type { ForwardingHealth } from './types';

interface Props {
    forwarding: ForwardingHealth;
}

export default function ForwardingHealthCard({ forwarding }: Props) {
    const data = [
        { name: 'Sukses', value: forwarding.success, color: CHART_COLORS.emerald },
        { name: 'Gagal', value: forwarding.error, color: CHART_COLORS.red },
        { name: 'Dilewati', value: forwarding.skipped, color: CHART_COLORS.slate },
    ].filter((d) => d.value > 0);

    return (
        <Card className="glass-card glass-animate-in glass-delay-7">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Send className="size-5" />
                    Pengiriman Data
                </CardTitle>
                <CardDescription>Status forwarding 24 jam terakhir</CardDescription>
            </CardHeader>
            <CardContent>
                {forwarding.total === 0 ? (
                    <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                        Belum ada aktivitas pengiriman
                    </div>
                ) : (
                    <div className="relative h-[160px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={data} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="100%" paddingAngle={2}>
                                    {data.map((d) => (
                                        <Cell key={d.name} fill={d.color} />
                                    ))}
                                </Pie>
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-2xl font-bold">{forwarding.successRate ?? 0}%</span>
                            <span className="text-xs text-muted-foreground">sukses</span>
                        </div>
                    </div>
                )}

                <div className="mt-3 flex justify-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: CHART_COLORS.emerald }} />
                        {forwarding.success}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: CHART_COLORS.red }} />
                        {forwarding.error}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: CHART_COLORS.slate }} />
                        {forwarding.skipped}
                    </span>
                </div>

                {forwarding.recentFailures.length > 0 && (
                    <div className="mt-3 border-t pt-2">
                        <p className="mb-1 text-xs font-medium text-red-600">Kegagalan terbaru</p>
                        <ul className="space-y-0.5">
                            {forwarding.recentFailures.slice(0, 3).map((f, i) => (
                                <li key={i} className="flex justify-between gap-2 text-xs">
                                    <span className="truncate">{f.target}{f.httpStatus ? ` (${f.httpStatus})` : ''}</span>
                                    <span className="shrink-0 text-muted-foreground">{f.at}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

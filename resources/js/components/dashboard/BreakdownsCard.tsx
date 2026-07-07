import { PieChartIcon } from 'lucide-react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { seriesColor } from '@/lib/chart-theme';
import type { Breakdowns } from './types';

interface Props {
    breakdowns: Breakdowns;
}

const tooltipStyle = { fontSize: 12, borderRadius: 8 } as const;

function EmptyState() {
    return <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">Belum ada data</div>;
}

function Donut({ data, nameKey, colors }: { data: { count: number }[]; nameKey: string; colors?: string[] }) {
    if (data.length === 0) return <EmptyState />;
    return (
        <ResponsiveContainer width="100%" height={240}>
            <PieChart>
                <Pie data={data} dataKey="count" nameKey={nameKey} innerRadius="55%" outerRadius="85%" paddingAngle={2} label>
                    {data.map((_, i) => (
                        <Cell key={i} fill={colors ? colors[i] : seriesColor(i)} />
                    ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
        </ResponsiveContainer>
    );
}

function Bars({ data, categoryKey, colors }: { data: { count: number }[]; categoryKey: string; colors?: string[] }) {
    if (data.length === 0) return <EmptyState />;
    return (
        <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <XAxis dataKey={categoryKey} tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={48} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {data.map((_, i) => (
                        <Cell key={i} fill={colors ? colors[i] : seriesColor(i)} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}

export default function BreakdownsCard({ breakdowns }: Props) {
    const projectColors = breakdowns.byProject.map((p) => p.color);

    return (
        <Card className="glass-card glass-animate-in glass-delay-6">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <PieChartIcon className="size-5" />
                    Komposisi
                </CardTitle>
                <CardDescription>Distribusi sensor & perangkat</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="type">
                    <TabsList className="mb-3">
                        <TabsTrigger value="type">Sensor</TabsTrigger>
                        <TabsTrigger value="project">Project</TabsTrigger>
                        <TabsTrigger value="firmware">Firmware</TabsTrigger>
                        <TabsTrigger value="mode">Mode</TabsTrigger>
                    </TabsList>
                    <TabsContent value="type">
                        <Donut data={breakdowns.sensorsByType} nameKey="type" />
                    </TabsContent>
                    <TabsContent value="project">
                        <Bars data={breakdowns.byProject} categoryKey="name" colors={projectColors} />
                    </TabsContent>
                    <TabsContent value="firmware">
                        <Bars data={breakdowns.byFirmware} categoryKey="version" />
                    </TabsContent>
                    <TabsContent value="mode">
                        <Donut data={breakdowns.byMode} nameKey="mode" />
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}

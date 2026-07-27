import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Code2,
    Copy,
} from 'lucide-react';
// =============================================================================
// API Documentation Component
// =============================================================================

interface ApiEndpoint {
    method: 'GET' | 'POST';
    path: string;
    title: string;
    description: string;
    params?: {
        name: string;
        type: string;
        required: boolean;
        description: string;
    }[];
    requestBody?: string;
    responseExample: string;
}

export function ApiDocumentation({
    loggerId,
    loggerName,
}: {
    loggerId: string;
    loggerName: string;
}) {
    const [expandedEndpoint, setExpandedEndpoint] = useState<number | null>(
        null,
    );
    const [copiedUrl, setCopiedUrl] = useState(false);

    const baseUrl =
        typeof window !== 'undefined'
            ? `${window.location.origin}/api/v1`
            : '/api/v1';

    const endpoints: ApiEndpoint[] = [
        {
            method: 'GET',
            path: `/loggers/${loggerId}`,
            title: 'Get Logger Details',
            description: `Retrieve complete device information for "${loggerName}" including status, location, firmware, and GPS coordinates.`,
            responseExample: JSON.stringify(
                {
                    success: true,
                    data: {
                        id: loggerId,
                        name: loggerName,
                        serial_number: 'BLC-2024-XXXXX',
                        status: 'online',
                        connection_type: '4g-lte',
                        firmware_version: 'v3.2.1',
                        battery: '13.2',
                        signal_strength: 85,
                        gps: { lat: '-6.6301', lng: '106.8517', alt: '250' },
                        last_seen_at: '2026-03-11T01:00:00+07:00',
                    },
                },
                null,
                2,
            ),
        },
        {
            method: 'GET',
            path: `/loggers/${loggerId}/sensors`,
            title: 'Get Sensor Readings',
            description:
                'Retrieve all sensor channel readings including current values, units, status, and min/max ranges.',
            responseExample: JSON.stringify(
                {
                    success: true,
                    data: {
                        logger_id: loggerId,
                        logger_name: loggerName,
                        sensors: [
                            {
                                id: 1,
                                name: 'Water Level',
                                type: 'water-level',
                                value: 2.45,
                                unit: 'm',
                                status: 'active',
                                min_value: 0,
                                max_value: 10,
                                last_reading_at: '2026-03-11T01:00:00+07:00',
                            },
                        ],
                    },
                },
                null,
                2,
            ),
        },
        {
            method: 'GET',
            path: `/loggers/${loggerId}/logs`,
            title: 'Get Activity Logs',
            description:
                'Retrieve activity log entries for this logger. Supports pagination via limit parameter.',
            params: [
                {
                    name: 'limit',
                    type: 'integer',
                    required: false,
                    description:
                        'Number of log entries (default: 50, max: 100)',
                },
            ],
            responseExample: JSON.stringify(
                {
                    success: true,
                    data: [
                        {
                            id: 1,
                            action: 'Config Sync',
                            status: 'success',
                            level: 'info',
                            message: 'Configuration synced successfully',
                            created_at: '2026-03-11T01:00:00+07:00',
                        },
                    ],
                },
                null,
                2,
            ),
        },
        {
            method: 'POST',
            path: `/loggers/${loggerId}/command`,
            title: 'Send Command',
            description:
                'Send a remote command to the logger device. Available commands: reboot, sync_config, backup_config, request_info.',
            params: [
                {
                    name: 'command',
                    type: 'string',
                    required: true,
                    description:
                        'Command to execute: reboot | sync_config | backup_config | request_info',
                },
                {
                    name: 'params',
                    type: 'object',
                    required: false,
                    description: 'Optional parameters for the command',
                },
            ],
            requestBody: JSON.stringify(
                {
                    command: 'sync_config',
                    params: {},
                },
                null,
                2,
            ),
            responseExample: JSON.stringify(
                {
                    success: true,
                    data: {
                        logger_id: loggerId,
                        command: 'sync_config',
                        status: 'queued',
                        message: `Command 'sync_config' has been queued for ${loggerName}.`,
                    },
                },
                null,
                2,
            ),
        },
        {
            method: 'POST',
            path: `/loggers/${loggerId}/sensors/data`,
            title: 'Push Sensor Data',
            description:
                'Push new sensor readings to the logger. Each reading must specify the sensor type and value.',
            params: [
                {
                    name: 'readings',
                    type: 'array',
                    required: true,
                    description: 'Array of sensor readings',
                },
                {
                    name: 'readings[].sensor_type',
                    type: 'string',
                    required: true,
                    description:
                        'Sensor type identifier (e.g. water-level, temperature)',
                },
                {
                    name: 'readings[].value',
                    type: 'number',
                    required: true,
                    description: 'Sensor reading value',
                },
                {
                    name: 'readings[].timestamp',
                    type: 'datetime',
                    required: false,
                    description:
                        'Reading timestamp (ISO 8601, defaults to now)',
                },
            ],
            requestBody: JSON.stringify(
                {
                    readings: [
                        { sensor_type: 'water-level', value: 2.45 },
                        {
                            sensor_type: 'temperature',
                            value: 28.3,
                            timestamp: '2026-03-11T01:00:00+07:00',
                        },
                    ],
                },
                null,
                2,
            ),
            responseExample: JSON.stringify(
                {
                    success: true,
                    data: {
                        logger_id: loggerId,
                        results: [
                            {
                                sensor_type: 'water-level',
                                value: 2.45,
                                status: 'updated',
                            },
                            {
                                sensor_type: 'temperature',
                                value: 28.3,
                                status: 'updated',
                            },
                        ],
                    },
                },
                null,
                2,
            ),
        },
    ];

    function copyToClipboard(text: string) {
        navigator.clipboard.writeText(text);
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
    }

    function toggleEndpoint(index: number) {
        setExpandedEndpoint(expandedEndpoint === index ? null : index);
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Base URL Card */}
            <Card>
                <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-muted-foreground">
                            Base URL
                        </p>
                        <code className="text-sm font-semibold break-all">
                            {baseUrl}
                        </code>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1.5"
                        onClick={() => copyToClipboard(baseUrl)}
                    >
                        <Copy className="size-3.5" />
                        {copiedUrl ? 'Copied!' : 'Copy'}
                    </Button>
                </CardContent>
            </Card>

            {/* Endpoints */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Code2 className="size-5" />
                        API Endpoints
                    </CardTitle>
                    <CardDescription>
                        {endpoints.length} endpoints available for this logger
                    </CardDescription>
                </CardHeader>
                <Separator />
                <CardContent className="p-0">
                    {endpoints.map((endpoint, idx) => (
                        <div key={idx} className={idx > 0 ? 'border-t' : ''}>
                            {/* Endpoint Header */}
                            <button
                                onClick={() => toggleEndpoint(idx)}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                            >
                                {expandedEndpoint === idx ? (
                                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                                ) : (
                                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                                )}
                                <span
                                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold tracking-wide uppercase ${
                                        endpoint.method === 'GET'
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                    }`}
                                >
                                    {endpoint.method}
                                </span>
                                <code className="text-sm font-medium">
                                    {endpoint.path}
                                </code>
                                <span className="ml-auto text-xs text-muted-foreground">
                                    {endpoint.title}
                                </span>
                            </button>

                            {/* Expanded Details */}
                            {expandedEndpoint === idx && (
                                <div className="border-t bg-muted/30 px-6 py-5">
                                    <div className="flex flex-col gap-5">
                                        {/* Description */}
                                        <p className="text-sm text-muted-foreground">
                                            {endpoint.description}
                                        </p>

                                        {/* Full URL */}
                                        <div>
                                            <p className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                                                URL
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 rounded-md border bg-background px-3 py-2 text-sm break-all">
                                                    {baseUrl}
                                                    {endpoint.path}
                                                </code>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() =>
                                                        copyToClipboard(
                                                            `${baseUrl}${endpoint.path}`,
                                                        )
                                                    }
                                                >
                                                    <Copy className="size-3.5" />
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Parameters */}
                                        {endpoint.params &&
                                            endpoint.params.length > 0 && (
                                                <div>
                                                    <p className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                                                        Parameters
                                                    </p>
                                                    <div className="overflow-hidden rounded-md border">
                                                        <Table>
                                                            <TableHeader>
                                                                <TableRow>
                                                                    <TableHead className="text-xs">
                                                                        Name
                                                                    </TableHead>
                                                                    <TableHead className="text-xs">
                                                                        Type
                                                                    </TableHead>
                                                                    <TableHead className="text-xs">
                                                                        Required
                                                                    </TableHead>
                                                                    <TableHead className="text-xs">
                                                                        Description
                                                                    </TableHead>
                                                                </TableRow>
                                                            </TableHeader>
                                                            <TableBody>
                                                                {endpoint.params.map(
                                                                    (
                                                                        param,
                                                                        pIdx,
                                                                    ) => (
                                                                        <TableRow
                                                                            key={
                                                                                pIdx
                                                                            }
                                                                        >
                                                                            <TableCell className="font-mono text-xs font-medium">
                                                                                {
                                                                                    param.name
                                                                                }
                                                                            </TableCell>
                                                                            <TableCell>
                                                                                <Badge
                                                                                    variant="outline"
                                                                                    className="text-[10px]"
                                                                                >
                                                                                    {
                                                                                        param.type
                                                                                    }
                                                                                </Badge>
                                                                            </TableCell>
                                                                            <TableCell>
                                                                                {param.required ? (
                                                                                    <Badge
                                                                                        variant="default"
                                                                                        className="bg-red-500/80 text-[10px]"
                                                                                    >
                                                                                        Required
                                                                                    </Badge>
                                                                                ) : (
                                                                                    <Badge
                                                                                        variant="secondary"
                                                                                        className="text-[10px]"
                                                                                    >
                                                                                        Optional
                                                                                    </Badge>
                                                                                )}
                                                                            </TableCell>
                                                                            <TableCell className="text-xs text-muted-foreground">
                                                                                {
                                                                                    param.description
                                                                                }
                                                                            </TableCell>
                                                                        </TableRow>
                                                                    ),
                                                                )}
                                                            </TableBody>
                                                        </Table>
                                                    </div>
                                                </div>
                                            )}

                                        {/* Request Body */}
                                        {endpoint.requestBody && (
                                            <div>
                                                <div className="mb-1.5 flex items-center justify-between">
                                                    <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                                                        Request Body
                                                    </p>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 gap-1 text-xs"
                                                        onClick={() =>
                                                            copyToClipboard(
                                                                endpoint.requestBody!,
                                                            )
                                                        }
                                                    >
                                                        <Copy className="size-3" />{' '}
                                                        Copy
                                                    </Button>
                                                </div>
                                                <pre className="overflow-x-auto rounded-md border bg-zinc-950 p-4 text-xs text-emerald-400">
                                                    <code>
                                                        {endpoint.requestBody}
                                                    </code>
                                                </pre>
                                            </div>
                                        )}

                                        {/* Response Example */}
                                        <div>
                                            <div className="mb-1.5 flex items-center justify-between">
                                                <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                                                    Response Example
                                                </p>
                                                <Badge
                                                    variant="default"
                                                    className="gap-1 bg-emerald-500/80 text-[10px]"
                                                >
                                                    <CheckCircle2 className="size-2.5" />{' '}
                                                    200 OK
                                                </Badge>
                                            </div>
                                            <pre className="overflow-x-auto rounded-md border bg-zinc-950 p-4 text-xs text-emerald-400">
                                                <code>
                                                    {endpoint.responseExample}
                                                </code>
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* Usage Notes */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Integration Notes</CardTitle>
                </CardHeader>
                <CardContent>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                            <span>
                                <strong className="text-foreground">GET</strong>{' '}
                                endpoints are read-only and safe to call at any
                                frequency.
                            </span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                            <span>
                                <strong className="text-foreground">
                                    POST
                                </strong>{' '}
                                endpoints modify data or send commands. Use the{' '}
                                <code className="rounded bg-muted px-1 text-xs">
                                    Content-Type: application/json
                                </code>{' '}
                                header.
                            </span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                            <span>
                                All responses follow the format{' '}
                                <code className="rounded bg-muted px-1 text-xs">
                                    {'{ "success": true, "data": {...} }'}
                                </code>
                                .
                            </span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                            <span>
                                Timestamps are in{' '}
                                <strong className="text-foreground">
                                    ISO 8601
                                </strong>{' '}
                                format with timezone offset.
                            </span>
                        </li>
                    </ul>
                </CardContent>
            </Card>
        </div>
    );
}

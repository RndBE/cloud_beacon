import {
    AlertCircle,
    AlertTriangle,
    ArrowLeft,
    CheckCircle2,
    ChevronRight,
    Clock,
    Copy,
    Database,
    Download,
    Eye,
    EyeOff,
    FileText,
    HardDrive,
    Key,
    Loader2,
    Network,
    Pencil,
    Plug,
    Power,
    Radio,
    RefreshCw,
    Save,
    ScrollText,
    Settings,
    ShieldAlert,
    ShieldCheck,
    Upload,
    WifiOff,
    XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { apiFetch } from './api-fetch';
// =============================================================================
// FTP Configuration Card
// =============================================================================
type FtpPhase =
    | 'idle'
    | 'setting'
    | 'set_ok'
    | 'testing'
    | 'test_ok'
    | 'success'
    | 'error';
type FtpBrowserSource = 'all' | 'ftp' | 'logger';
type FtpBrowserSourceMap = Partial<Record<string, FtpBrowserSource[]>>;
type FtpLatestSource = 'all' | 'ftp' | 'logger' | 'none';

export function FtpConfigCard({
    deviceIdentifier,
    disabled,
    initialHost,
    initialPort,
    initialUser,
}: {
    deviceIdentifier: string;
    disabled?: boolean;
    initialHost?: string | null;
    initialPort?: number;
    initialUser?: string | null;
}) {
    const { t } = useTranslation();
    const [ftpHost, setFtpHost] = useState(initialHost || '');
    const [ftpPort, setFtpPort] = useState(initialPort || 21);
    const [ftpUser, setFtpUser] = useState(initialUser || '');
    const [ftpPass, setFtpPass] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [editing, setEditing] = useState(false);
    const [configured, setConfigured] = useState(!!initialHost);

    // Stepper dialog
    const [dialogOpen, setDialogOpen] = useState(false);
    const [phase, setPhase] = useState<FtpPhase>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [errorStep, setErrorStep] = useState<'set' | 'test'>('set');
    const [elapsed, setElapsed] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // File browser
    const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
    const [months, setMonths] = useState<string[]>([]);
    const [files, setFiles] = useState<string[]>([]);
    const [browserSource, setBrowserSource] =
        useState<FtpBrowserSource>('all');
    const [monthSources, setMonthSources] = useState<FtpBrowserSourceMap>({});
    const [fileSources, setFileSources] = useState<FtpBrowserSourceMap>({});
    const [sourceErrors, setSourceErrors] = useState<Record<string, string>>(
        {},
    );
    const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
    const [browseView, setBrowseView] = useState<'months' | 'files'>('months');
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

    function startTimer() {
        const start = Date.now();
        setElapsed(0);
        stopTimer();
        timerRef.current = setInterval(() => {
            setElapsed(Math.floor((Date.now() - start) / 1000));
        }, 1000);
    }

    function stopTimer() {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }

    function formatElapsed(seconds: number) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    // Step 1: Kirim — SET FTP credentials
    async function handleSet() {
        if (!ftpHost || !ftpUser || !ftpPass) return;

        setPhase('setting');
        setErrorMsg('');
        setDialogOpen(true);
        startTimer();

        try {
            const res = await apiFetch('/api/mqtt/ftp/set', {
                id_logger: deviceIdentifier,
                host: ftpHost,
                port: ftpPort,
                username: ftpUser,
                password: ftpPass,
            });
            const data = await res.json();
            stopTimer();

            if (data.success) {
                setPhase('set_ok');
            } else {
                setErrorMsg(data.message || 'Gagal mengirim konfigurasi FTP');
                setErrorStep('set');
                setPhase('error');
            }
        } catch {
            stopTimer();
            setErrorMsg('Network error — tidak dapat terhubung ke server');
            setErrorStep('set');
            setPhase('error');
        }
    }

    // Step 2: Test Koneksi — TES FTP
    async function handleTest() {
        setPhase('testing');
        startTimer();

        try {
            const res = await apiFetch('/api/mqtt/ftp/test', {
                id_logger: deviceIdentifier,
            });
            const data = await res.json();
            stopTimer();

            if (data.success) {
                setPhase('test_ok');
            } else {
                setErrorMsg(data.message || 'FTP test gagal');
                setErrorStep('test');
                setPhase('error');
            }
        } catch {
            stopTimer();
            setErrorMsg('Network error — tidak dapat terhubung ke server');
            setErrorStep('test');
            setPhase('error');
        }
    }

    // Step 3: Simpan — confirm and close
    function handleSave() {
        setPhase('success');
        setEditing(false);
        setConfigured(true);
    }

    function handleRetry() {
        if (errorStep === 'set') {
            handleSet();
        } else {
            handleTest();
        }
    }

    function handleDialogClose() {
        stopTimer();
        setDialogOpen(false);
        setPhase('idle');
    }

    // File browser — load months
    async function handleBrowseFiles(source: FtpBrowserSource = browserSource) {
        setLoadingFiles(true);
        setFileBrowserOpen(true);
        setMonths([]);
        setFiles([]);
        setMonthSources({});
        setFileSources({});
        setSourceErrors({});
        setSelectedMonth(null);
        setBrowseView('months');

        try {
            const res = await apiFetch('/api/mqtt/ftp/read', {
                id_logger: deviceIdentifier,
                source,
            });
            const data = await res.json();

            if (data.success && Array.isArray(data.months)) {
                setMonths(data.months);
                setMonthSources(data.month_sources || {});
                setSourceErrors(data.source_errors || {});
            } else {
                setMonths([]);
                setSourceErrors(
                    data.message ? { [source]: data.message } : {},
                );
            }
        } catch {
            setMonths([]);
            setSourceErrors({
                [source]: 'Network error - tidak dapat terhubung ke server',
            });
        } finally {
            setLoadingFiles(false);
        }
    }

    // File browser — load files for a selected month
    async function handleSelectMonth(
        monthStr: string,
        source: FtpBrowserSource = browserSource,
    ) {
        setSelectedMonth(monthStr);
        setBrowseView('files');
        setLoadingFiles(true);
        setFiles([]);
        setFileSources({});
        setSourceErrors({});

        // Parse "2026-03" → year=2026, month=3
        const [yearStr, monthNum] = monthStr.split('-');
        const year = parseInt(yearStr);
        const month = parseInt(monthNum);

        try {
            const res = await apiFetch('/api/mqtt/ftp/read', {
                id_logger: deviceIdentifier,
                year,
                month,
                source,
            });
            const data = await res.json();

            if (data.success && Array.isArray(data.files)) {
                setFiles(data.files);
                setFileSources(data.file_sources || {});
                setSourceErrors(data.source_errors || {});
            } else {
                setFiles([]);
                setSourceErrors(
                    data.message ? { [source]: data.message } : {},
                );
            }
        } catch {
            setFiles([]);
            setSourceErrors({
                [source]: 'Network error - tidak dapat terhubung ke server',
            });
        } finally {
            setLoadingFiles(false);
        }
    }

    function handleBackToMonths() {
        setBrowseView('months');
        setSelectedMonth(null);
        setFiles([]);
        setFileSources({});
    }

    function formatMonth(monthStr: string) {
        const [yearStr, monthNum] = monthStr.split('-');
        const monthNames = [
            'Januari',
            'Februari',
            'Maret',
            'April',
            'Mei',
            'Juni',
            'Juli',
            'Agustus',
            'September',
            'Oktober',
            'November',
            'Desember',
        ];
        return `${monthNames[parseInt(monthNum) - 1]} ${yearStr}`;
    }

    async function handleGetFile(filename: string) {
        setDownloadingFile(filename);
        try {
            const sources = fileSources[filename] || [browserSource];
            const needsLoggerUpload =
                browserSource === 'logger' ||
                (browserSource === 'all' &&
                    sources.includes('logger') &&
                    !sources.includes('ftp'));

            if (needsLoggerUpload) {
                const getRes = await apiFetch('/api/mqtt/ftp/get', {
                    id_logger: deviceIdentifier,
                    filename,
                });
                const getData = await getRes.json();

                if (!getData.success) {
                    alert(
                        `Gagal: ${getData.message || 'Logger tidak merespons'}`,
                    );
                    return;
                }
            }

            const csrfToken =
                document
                    .querySelector('meta[name="csrf-token"]')
                    ?.getAttribute('content') || '';
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = '/api/mqtt/ftp/download';
            form.style.display = 'none';

            const fields = {
                id_logger: deviceIdentifier,
                filename,
                _token: csrfToken,
            };
            for (const [key, value] of Object.entries(fields)) {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = key;
                input.value = value;
                form.appendChild(input);
            }

            document.body.appendChild(form);
            form.submit();
            document.body.removeChild(form);
        } catch {
            alert('Network error — tidak dapat terhubung ke server');
        } finally {
            setDownloadingFile(null);
        }
    }

    function handleSourceChange(source: FtpBrowserSource) {
        setBrowserSource(source);
        handleBrowseFiles(source);
    }

    function sourceLabel(source: FtpBrowserSource | FtpLatestSource) {
        if (source === 'ftp') return 'FTP';
        if (source === 'logger') return 'Logger';
        if (source === 'none') return '-';
        return 'Semua';
    }

    function renderSourceBadges(sources?: FtpBrowserSource[]) {
        if (!sources || sources.length === 0) return null;

        return (
            <div className="flex shrink-0 items-center gap-1">
                {sources.map((source) => (
                    <Badge
                        key={source}
                        variant={source === 'ftp' ? 'secondary' : 'outline'}
                        className="h-4 rounded px-1.5 text-[10px]"
                    >
                        {sourceLabel(source)}
                    </Badge>
                ))}
            </div>
        );
    }

    function sourceFiles(source: 'ftp' | 'logger') {
        return files.filter((file) => fileSources[file]?.includes(source));
    }

    function latestFile(fileList: string[]) {
        return fileList.reduce<string | null>(
            (latest, file) => (latest === null || file > latest ? file : latest),
            null,
        );
    }

    const ftpFiles = sourceFiles('ftp');
    const loggerFiles = sourceFiles('logger');
    const latestFtpFile = latestFile(ftpFiles);
    const latestLoggerFile = latestFile(loggerFiles);
    const latestSource: FtpLatestSource =
        browserSource !== 'all'
            ? browserSource
            : latestFtpFile && latestLoggerFile
              ? latestFtpFile === latestLoggerFile
                  ? 'all'
                  : latestFtpFile > latestLoggerFile
                    ? 'ftp'
                    : 'logger'
              : latestFtpFile
                ? 'ftp'
                : latestLoggerFile
                  ? 'logger'
                  : 'none';
    const visibleFiles =
        latestSource === 'ftp'
            ? ftpFiles
            : latestSource === 'logger'
              ? loggerFiles
              : files;

    function renderFileRow(file: string, sourceHint?: FtpBrowserSource) {
        return (
            <div
                key={`${sourceHint || 'file'}-${file}`}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
            >
                <div className="flex min-w-0 items-center gap-2">
                    <Database className="size-4 shrink-0 text-blue-500" />
                    <span className="truncate font-mono text-xs">{file}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {renderSourceBadges(
                        sourceHint ? [sourceHint] : fileSources[file],
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        disabled={downloadingFile === file}
                        onClick={() => handleGetFile(file)}
                        title={`Download ${file}`}
                    >
                        {downloadingFile === file ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <Download className="size-3.5" />
                        )}
                    </Button>
                </div>
            </div>
        );
    }

    const hasCredentials = ftpHost && ftpUser && ftpPass;

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Upload className="size-5" /> Konfigurasi FTP
                        </CardTitle>
                        <CardDescription className="mt-1">
                            Atur pengiriman data logger ke server FTP
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                        {!editing && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditing(true)}
                                className="size-8"
                                title="Edit konfigurasi FTP"
                            >
                                <Pencil className="size-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {!editing ? (
                    configured ? (
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="size-4 text-emerald-500" />
                                        <span className="text-sm font-medium">
                                            FTP Terkonfigurasi
                                        </span>
                                    </div>
                                    <p className="mt-3 text-xs text-muted-foreground">
                                        Detail host dan username tersedia di FTP
                                        File Browser.
                                    </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                        onClick={() => handleBrowseFiles()}
                                        disabled={disabled}
                                        title="FTP File Browser"
                                    >
                                        <HardDrive className="size-4" />
                                    </Button>
                                    <SystemLogsCard
                                        deviceIdentifier={deviceIdentifier}
                                        disabled={Boolean(disabled)}
                                        ftpConfigured={Boolean(
                                            configured && ftpHost && ftpUser,
                                        )}
                                        variant="icon"
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                        onClick={() => setEditing(true)}
                                        title="Edit Konfigurasi"
                                    >
                                        <Pencil className="size-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                            <div className="mb-3 flex items-center gap-2">
                                <Upload className="size-4 text-amber-500" />
                                <span className="text-sm font-medium">
                                    Konfigurasi FTP belum diatur
                                </span>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={() => setEditing(true)}
                                disabled={disabled}
                            >
                                <Settings className="size-4" /> Konfigurasi FTP
                            </Button>
                        </div>
                    )
                ) : (
                    <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="flex items-center gap-1.5 text-sm font-medium">
                                    <Network className="size-4 text-blue-500" />{' '}
                                    Host FTP
                                </label>
                                <input
                                    type="text"
                                    value={ftpHost}
                                    onChange={(e) => setFtpHost(e.target.value)}
                                    placeholder="103.82.241.100"
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="flex items-center gap-1.5 text-sm font-medium">
                                    <Plug className="size-4 text-amber-500" />{' '}
                                    Port
                                </label>
                                <input
                                    type="number"
                                    min={1}
                                    max={65535}
                                    value={ftpPort}
                                    onChange={(e) =>
                                        setFtpPort(
                                            parseInt(e.target.value) || 21,
                                        )
                                    }
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                                />
                            </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="flex items-center gap-1.5 text-sm font-medium">
                                    <Key className="size-4 text-emerald-500" />{' '}
                                    Username
                                </label>
                                <input
                                    type="text"
                                    value={ftpUser}
                                    onChange={(e) => setFtpUser(e.target.value)}
                                    placeholder="logger_30069"
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="flex items-center gap-1.5 text-sm font-medium">
                                    <Key className="size-4 text-rose-500" />{' '}
                                    Password
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPass ? 'text' : 'password'}
                                        value={ftpPass}
                                        onChange={(e) =>
                                            setFtpPass(e.target.value)
                                        }
                                        placeholder="••••••••"
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-9 text-sm shadow-sm transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPass(!showPass)}
                                        className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        {showPass ? (
                                            <EyeOff className="size-4" />
                                        ) : (
                                            <Eye className="size-4" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={handleSet}
                                disabled={!hasCredentials || disabled}
                                size="sm"
                                className="gap-2"
                                title={
                                    disabled
                                        ? 'Device offline — tidak bisa mengirim'
                                        : ''
                                }
                            >
                                <Upload className="size-4" /> Kirim ke Device
                            </Button>
                            <Button
                                onClick={() => setEditing(false)}
                                variant="outline"
                                size="sm"
                                className="gap-2"
                            >
                                <XCircle className="size-4" />{' '}
                                {t('common.cancel')}
                            </Button>
                            <span className="ml-auto text-[10px] text-muted-foreground">
                                {disabled
                                    ? '⚠️ Device offline'
                                    : 'via perangkat'}
                            </span>
                        </div>
                    </div>
                )}
            </CardContent>

            {/* ══════ FTP Stepper Dialog ══════ */}
            <Dialog
                open={dialogOpen}
                onOpenChange={(v) => {
                    if (!v && phase !== 'setting' && phase !== 'testing')
                        handleDialogClose();
                }}
            >
                <DialogContent
                    className="sm:max-w-md"
                    onInteractOutside={(e) => {
                        if (phase === 'setting' || phase === 'testing')
                            e.preventDefault();
                    }}
                >
                    {/* ─── Phase: Setting (sending SET) ─── */}
                    {phase === 'setting' && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="relative">
                                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/10">
                                    <Loader2 className="size-10 animate-spin text-amber-500" />
                                </div>
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">
                                    Mengirim Konfigurasi FTP...
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Mengirim kredensial FTP ke device...
                                </p>
                                <p className="mt-3 font-mono text-2xl font-bold text-muted-foreground tabular-nums">
                                    {formatElapsed(elapsed)}
                                </p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex items-center gap-3 text-sm text-foreground">
                                    <Loader2 className="size-4 shrink-0 animate-spin text-amber-500" />
                                    <span>FTP SET — Kirim kredensial</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
                                    <div className="size-4 shrink-0 rounded-full border-2 border-muted" />
                                    <span>FTP TES — Tes koneksi upload</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
                                    <div className="size-4 shrink-0 rounded-full border-2 border-muted" />
                                    <span>Simpan konfigurasi</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ─── Phase: SET OK → prompt user to Test ─── */}
                    {phase === 'set_ok' && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="flex h-20 w-20 animate-in items-center justify-center rounded-full bg-emerald-500/10 duration-300 zoom-in">
                                <CheckCircle2 className="size-10 text-emerald-500" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">
                                    Kredensial FTP Terkirim!
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Konfigurasi berhasil dikirim ke device dalam{' '}
                                    <strong>{formatElapsed(elapsed)}</strong>.
                                    <br />
                                    Lanjutkan dengan tes koneksi untuk
                                    memastikan FTP berfungsi.
                                </p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                                    <span>FTP SET — Kirim kredensial</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm font-medium text-foreground">
                                    <div className="size-4 shrink-0 rounded-full border-2 border-blue-500" />
                                    <span>FTP TES — Tes koneksi upload</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
                                    <div className="size-4 shrink-0 rounded-full border-2 border-muted" />
                                    <span>Simpan konfigurasi</span>
                                </div>
                            </div>
                            <DialogFooter className="gap-2 sm:gap-0">
                                <Button
                                    variant="outline"
                                    onClick={handleDialogClose}
                                >
                                    {t('common.cancel')}
                                </Button>
                                <Button
                                    onClick={handleTest}
                                    className="gap-1.5 bg-blue-600 hover:bg-blue-700"
                                >
                                    <Radio className="size-4" /> Test Koneksi
                                </Button>
                            </DialogFooter>
                        </div>
                    )}

                    {/* ─── Phase: Testing (sending TES) ─── */}
                    {phase === 'testing' && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="relative">
                                <div className="flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-blue-500/10">
                                    <Upload className="size-10 animate-pulse text-blue-500" />
                                </div>
                                <div className="absolute inset-0 animate-ping rounded-full border-2 border-blue-500/30" />
                                <div
                                    className="absolute -inset-3 animate-ping rounded-full border border-blue-500/10"
                                    style={{ animationDelay: '0.5s' }}
                                />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">
                                    Menguji Koneksi FTP...
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Logger sedang tes upload ke server FTP...
                                </p>
                                <p className="mt-3 font-mono text-2xl font-bold text-muted-foreground tabular-nums">
                                    {formatElapsed(elapsed)}
                                </p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                                    <span>FTP SET — Kirim kredensial</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-foreground">
                                    <Loader2 className="size-4 shrink-0 animate-spin text-blue-500" />
                                    <span>FTP TES — Tes koneksi upload</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
                                    <div className="size-4 shrink-0 rounded-full border-2 border-muted" />
                                    <span>Simpan konfigurasi</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ─── Phase: TES OK → prompt user to Save ─── */}
                    {phase === 'test_ok' && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="flex h-20 w-20 animate-in items-center justify-center rounded-full bg-emerald-500/10 duration-300 zoom-in">
                                <CheckCircle2 className="size-10 text-emerald-500" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">
                                    Koneksi FTP Berhasil!
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Logger berhasil terhubung ke{' '}
                                    <strong>
                                        {ftpHost}:{ftpPort}
                                    </strong>{' '}
                                    dalam{' '}
                                    <strong>{formatElapsed(elapsed)}</strong>.
                                    <br />
                                    Simpan konfigurasi ini?
                                </p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                                    <span>FTP SET — Kirim kredensial</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                                    <span>FTP TES — Tes koneksi upload</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm font-medium text-foreground">
                                    <div className="size-4 shrink-0 rounded-full border-2 border-emerald-500" />
                                    <span>Simpan konfigurasi</span>
                                </div>
                            </div>
                            <DialogFooter className="gap-2 sm:gap-0">
                                <Button
                                    variant="outline"
                                    onClick={handleDialogClose}
                                >
                                    {t('common.cancel')}
                                </Button>
                                <Button
                                    onClick={handleSave}
                                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                                >
                                    <Save className="size-4" /> Simpan
                                </Button>
                            </DialogFooter>
                        </div>
                    )}

                    {/* ─── Phase: Success (saved) ─── */}
                    {phase === 'success' && (
                        <div className="flex flex-col items-center gap-4 py-8">
                            <div className="flex h-16 w-16 animate-in items-center justify-center rounded-full bg-emerald-500/10 duration-500 zoom-in">
                                <CheckCircle2 className="size-8 text-emerald-500" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">
                                    FTP Berhasil Disimpan!
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Konfigurasi FTP ke{' '}
                                    <strong>
                                        {ftpHost}:{ftpPort}
                                    </strong>{' '}
                                    telah tersimpan
                                </p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                                    <span>FTP SET — Kirim kredensial</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                                    <span>FTP TES — Tes koneksi upload</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                                    <span>Simpan konfigurasi</span>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button
                                    onClick={handleDialogClose}
                                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                                >
                                    Done
                                </Button>
                            </DialogFooter>
                        </div>
                    )}

                    {/* ─── Phase: Error ─── */}
                    {phase === 'error' && (
                        <>
                            <div className="flex flex-col items-center gap-4 py-8">
                                <div className="flex h-16 w-16 animate-in items-center justify-center rounded-full bg-red-500/10 duration-500 zoom-in">
                                    <XCircle className="size-8 text-red-500" />
                                </div>
                                <div className="text-center">
                                    <h3 className="text-lg font-semibold">
                                        {errorStep === 'set'
                                            ? 'Gagal Mengirim Konfigurasi'
                                            : 'Tes Koneksi FTP Gagal'}
                                    </h3>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {errorMsg}
                                    </p>
                                </div>
                                <div className="w-full max-w-xs space-y-2">
                                    <div
                                        className={`flex items-center gap-3 text-sm ${errorStep === 'set' ? 'text-red-500' : 'text-muted-foreground'}`}
                                    >
                                        {errorStep === 'set' ? (
                                            <XCircle className="size-4 shrink-0 text-red-500" />
                                        ) : (
                                            <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                                        )}
                                        <span>FTP SET — Kirim kredensial</span>
                                    </div>
                                    <div
                                        className={`flex items-center gap-3 text-sm ${errorStep === 'test' ? 'text-red-500' : 'text-muted-foreground/50'}`}
                                    >
                                        {errorStep === 'test' ? (
                                            <XCircle className="size-4 shrink-0 text-red-500" />
                                        ) : (
                                            <div className="size-4 shrink-0 rounded-full border-2 border-muted" />
                                        )}
                                        <span>
                                            FTP TES — Tes koneksi upload
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
                                        <div className="size-4 shrink-0 rounded-full border-2 border-muted" />
                                        <span>Simpan konfigurasi</span>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button
                                    variant="outline"
                                    onClick={handleDialogClose}
                                >
                                    {t('common.cancel')}
                                </Button>
                                <Button
                                    onClick={handleRetry}
                                    className="gap-1.5"
                                >
                                    <RefreshCw className="size-4" /> Coba Lagi
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* ══════ FTP File Browser Dialog ══════ */}
            <Dialog open={fileBrowserOpen} onOpenChange={setFileBrowserOpen}>
                <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <HardDrive className="size-5" /> FTP File Browser
                        </DialogTitle>
                        <DialogDescription>
                            {browseView === 'months'
                                ? 'Pilih bulan untuk melihat daftar file'
                                : `File CSV — ${selectedMonth ? formatMonth(selectedMonth) : ''}`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                        <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1">
                            <dt className="text-muted-foreground">Host</dt>
                            <dd className="font-mono">
                                {ftpHost}:{ftpPort}
                            </dd>
                            <dt className="text-muted-foreground">
                                Username
                            </dt>
                            <dd className="font-mono">{ftpUser}</dd>
                        </dl>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background p-1">
                        {(['all', 'ftp', 'logger'] as FtpBrowserSource[]).map(
                            (source) => (
                                <Button
                                    key={source}
                                    type="button"
                                    variant={
                                        browserSource === source
                                            ? 'default'
                                            : 'ghost'
                                    }
                                    size="sm"
                                    className="h-7 flex-1 px-2 text-xs"
                                    disabled={loadingFiles}
                                    onClick={() => handleSourceChange(source)}
                                >
                                    {sourceLabel(source)}
                                </Button>
                            ),
                        )}
                    </div>
                    {Object.keys(sourceErrors).length > 0 && (
                        <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                            <div className="flex items-start gap-2">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                <div className="space-y-0.5">
                                    {Object.entries(sourceErrors).map(
                                        ([source, message]) => (
                                            <p key={source}>
                                                {sourceLabel(
                                                    source as FtpBrowserSource,
                                                )}
                                                : {message}
                                            </p>
                                        ),
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="py-2">
                        {loadingFiles ? (
                            <div className="flex flex-col items-center gap-3 py-8">
                                <Loader2 className="size-8 animate-spin text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">
                                    {browseView === 'months'
                                        ? 'Memuat daftar bulan...'
                                        : 'Memuat daftar file...'}
                                </p>
                            </div>
                        ) : browseView === 'months' ? (
                            /* ─── Months View ─── */
                            months.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center">
                                    <HardDrive className="mx-auto size-8 text-muted-foreground/40" />
                                    <p className="mt-2 text-sm text-muted-foreground">
                                        Tidak ada data ditemukan
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                        {months.length} bulan tersedia
                                    </div>
                                    <div className="max-h-[50vh] space-y-0.5 overflow-y-auto">
                                        {months.map((month) => (
                                            <button
                                                key={month}
                                                onClick={() =>
                                                    handleSelectMonth(month)
                                                }
                                                className="flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
                                            >
                                                <div className="flex items-center gap-2.5">
                                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                                                        <Clock className="size-4 text-blue-500" />
                                                    </div>
                                                    <span className="font-medium">
                                                        {formatMonth(month)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {renderSourceBadges(
                                                        monthSources[month],
                                                    )}
                                                    <ChevronRight className="size-4 text-muted-foreground" />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )
                        ) : (
                            /* ─── Files View ─── */
                            <>
                                <button
                                    onClick={handleBackToMonths}
                                    className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    <ArrowLeft className="size-4" />
                                    <span>Kembali ke daftar bulan</span>
                                </button>
                                {visibleFiles.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center">
                                        <HardDrive className="mx-auto size-8 text-muted-foreground/40" />
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            Tidak ada file ditemukan
                                        </p>
                                    </div>
                                ) : latestSource === 'all' ? (
                                    <div className="space-y-2">
                                        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                            Data terbaru sama di FTP dan Logger
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <div className="space-y-1">
                                                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                                                    FTP
                                                </div>
                                                <div className="max-h-[50vh] space-y-0.5 overflow-y-auto">
                                                    {ftpFiles.map((file) =>
                                                        renderFileRow(
                                                            file,
                                                            'ftp',
                                                        ),
                                                    )}
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                                                    Logger
                                                </div>
                                                <div className="max-h-[50vh] space-y-0.5 overflow-y-auto">
                                                    {loggerFiles.map((file) =>
                                                        renderFileRow(
                                                            file,
                                                            'logger',
                                                        ),
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                            {visibleFiles.length} file{' '}
                                            {browserSource === 'all'
                                                ? `terbaru di ${sourceLabel(latestSource)}`
                                                : 'ditemukan'}
                                        </div>
                                        <div className="max-h-[50vh] space-y-0.5 overflow-y-auto">
                                            {visibleFiles.map((file) =>
                                                renderFileRow(file),
                                            )}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setFileBrowserOpen(false)}
                        >
                            Tutup
                        </Button>
                        {!loadingFiles && (
                            <Button
                                variant="outline"
                                onClick={
                                    browseView === 'months'
                                        ? () => handleBrowseFiles()
                                        : () =>
                                              selectedMonth &&
                                              handleSelectMonth(selectedMonth)
                                }
                                className="gap-1.5"
                            >
                                <RefreshCw className="size-4" /> Refresh
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

// =============================================================================
// System Logs Card (FTP black-box recorder — READLOGS list + in-app colored viewer)
// =============================================================================

// Shared matcher for a standard syslog line: "[HH:MM:SS] [LEVEL] [MODULE] message".
const SYSLOG_LINE_RE =
    /^\[(\d{2}:\d{2}:\d{2})\]\s*\[([A-Za-z ]+?)\]\s*\[([^\]]*)\]\s*(.*)$/;

interface LogSummary {
    totalLines: number;
    firstTime: string | null;
    lastTime: string | null;
    errors: number;
    warnings: number;
    cfg: number;
    reboots: number;
    netOffline: number;
    ftpUploads: number;
    topErrorModules: { module: string; count: number }[];
    // Timestamps of notable events so the summary can show "when", not just "how many".
    netOfflineTimes: string[];
    rebootTimes: string[];
    lastFtpUploadTime: string | null;
    firstErrorTime: string | null;
    lastErrorTime: string | null;
}

// Derive an at-a-glance health summary from a syslog file's text (frontend only — no backend).
function summarizeSyslog(content: string): LogSummary {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    let totalLines = 0;
    let errors = 0;
    let warnings = 0;
    let cfg = 0;
    let reboots = 0;
    let netOffline = 0;
    let ftpUploads = 0;
    let firstTime: string | null = null;
    let lastTime: string | null = null;
    let lastFtpUploadTime: string | null = null;
    let firstErrorTime: string | null = null;
    let lastErrorTime: string | null = null;
    const netOfflineTimes: string[] = [];
    const rebootTimes: string[] = [];
    const errorByModule: Record<string, number> = {};

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        totalLines++;
        const m = line.match(SYSLOG_LINE_RE);
        if (!m) continue;
        const [, time, levelRaw, modRaw, msg] = m;
        const level = levelRaw.trim().toUpperCase();
        const mod = modRaw.trim();
        if (firstTime === null) firstTime = time;
        lastTime = time;
        if (level === 'ERROR') {
            errors++;
            errorByModule[mod] = (errorByModule[mod] || 0) + 1;
            if (firstErrorTime === null) firstErrorTime = time;
            lastErrorTime = time;
        } else if (level === 'WARN') {
            warnings++;
        } else if (level === 'CFG') {
            cfg++;
        }
        if (/reboot/i.test(msg)) {
            reboots++;
            rebootTimes.push(time);
        }
        if (mod === 'NET' && /offline/i.test(msg)) {
            netOffline++;
            netOfflineTimes.push(time);
        }
        if (/upload ok/i.test(msg)) {
            ftpUploads++;
            lastFtpUploadTime = time;
        }
    }

    const topErrorModules = Object.entries(errorByModule)
        .map(([module, count]) => ({ module, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

    return {
        totalLines,
        firstTime,
        lastTime,
        errors,
        warnings,
        cfg,
        reboots,
        netOffline,
        ftpUploads,
        topErrorModules,
        netOfflineTimes,
        rebootTimes,
        lastFtpUploadTime,
        firstErrorTime,
        lastErrorTime,
    };
}

function LogStatTile({
    label,
    value,
    tone = 'default',
}: {
    label: string;
    value: string | number;
    tone?: 'default' | 'error' | 'warn' | 'ok';
}) {
    const toneClass =
        tone === 'error'
            ? 'text-red-600 dark:text-red-400'
            : tone === 'warn'
              ? 'text-amber-600 dark:text-amber-400'
              : tone === 'ok'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-foreground';
    return (
        <div className="rounded-lg border bg-background px-3 py-2">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
                {label}
            </p>
            <p
                className={`mt-0.5 truncate font-mono text-sm font-semibold ${toneClass}`}
            >
                {value}
            </p>
        </div>
    );
}

// Join a list of timestamps for display, capping the count so the line stays readable.
function formatTimeList(times: string[], max = 8): string {
    if (times.length <= max) return times.join(', ');
    return `${times.slice(0, max).join(', ')} … (+${times.length - max} lagi)`;
}

// Insight/health panel rendered above the raw log viewer.
function SyslogSummary({ summary }: { summary: LogSummary }) {
    const maxErr = summary.topErrorModules[0]?.count ?? 1;
    const topFault = summary.topErrorModules[0];

    // Plain-language verdict so the user gets the gist without reading every line.
    const status: 'error' | 'warn' | 'ok' =
        summary.errors > 0
            ? 'error'
            : summary.netOffline > 0 ||
                summary.reboots > 0 ||
                summary.warnings > 0
              ? 'warn'
              : 'ok';

    const verdictParts: string[] = [];
    if (summary.errors > 0)
        verdictParts.push(
            `${summary.errors} error${topFault ? ` (mayoritas ${topFault.module}, ${topFault.count}×)` : ''}`,
        );
    if (summary.warnings > 0) verdictParts.push(`${summary.warnings} warning`);
    if (summary.netOffline > 0)
        verdictParts.push(`jaringan terputus ${summary.netOffline}×`);
    if (summary.reboots > 0) verdictParts.push(`reboot ${summary.reboots}×`);

    const verdictText =
        status === 'ok'
            ? 'Tidak ada error terdeteksi — perangkat berjalan normal.'
            : `Terdeteksi ${verdictParts.join(', ')}.`;

    const verdict =
        status === 'error'
            ? {
                  box: 'border-red-500/20 bg-red-500/5',
                  text: 'text-red-600 dark:text-red-400',
                  Icon: ShieldAlert,
              }
            : status === 'warn'
              ? {
                    box: 'border-amber-500/20 bg-amber-500/5',
                    text: 'text-amber-600 dark:text-amber-500',
                    Icon: AlertTriangle,
                }
              : {
                    box: 'border-emerald-500/20 bg-emerald-500/5',
                    text: 'text-emerald-600 dark:text-emerald-400',
                    Icon: ShieldCheck,
                };
    const VerdictIcon = verdict.Icon;

    const hasEvents =
        summary.netOfflineTimes.length > 0 ||
        summary.rebootTimes.length > 0 ||
        summary.lastFtpUploadTime !== null ||
        summary.firstErrorTime !== null;

    return (
        <div className="mb-3 space-y-3">
            {/* Plain-language health verdict */}
            <div
                className={`flex items-start gap-2.5 rounded-lg border p-3 ${verdict.box}`}
            >
                <VerdictIcon
                    className={`mt-0.5 size-4 shrink-0 ${verdict.text}`}
                />
                <div className="min-w-0">
                    <p className={`text-sm font-medium ${verdict.text}`}>
                        {verdictText}
                    </p>
                    {summary.firstTime && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Rentang {summary.firstTime}–{summary.lastTime} ·{' '}
                            {summary.totalLines} baris
                        </p>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <LogStatTile label="Baris" value={summary.totalLines} />
                <LogStatTile
                    label="Rentang"
                    value={`${summary.firstTime ?? '—'}–${summary.lastTime ?? '—'}`}
                />
                <LogStatTile
                    label="Error"
                    value={summary.errors}
                    tone={summary.errors > 0 ? 'error' : 'default'}
                />
                <LogStatTile
                    label="Warning"
                    value={summary.warnings}
                    tone={summary.warnings > 0 ? 'warn' : 'default'}
                />
                <LogStatTile label="Reboot" value={summary.reboots} />
                <LogStatTile
                    label="Putus jaringan"
                    value={summary.netOffline}
                    tone={summary.netOffline > 0 ? 'warn' : 'default'}
                />
                <LogStatTile
                    label="Upload FTP"
                    value={summary.ftpUploads}
                    tone={summary.ftpUploads > 0 ? 'ok' : 'default'}
                />
                <LogStatTile label="Perintah CFG" value={summary.cfg} />
            </div>

            {/* Key events with timestamps — answers "kapan", not just "berapa kali". */}
            {hasEvents && (
                <div className="rounded-lg border bg-background p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Kejadian penting
                    </p>
                    <ul className="space-y-1.5 text-xs">
                        {summary.netOfflineTimes.length > 0 && (
                            <li className="flex items-start gap-2">
                                <WifiOff className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                                <span>
                                    <span className="font-medium">
                                        Jaringan terputus{' '}
                                        {summary.netOfflineTimes.length}×
                                    </span>{' '}
                                    — {formatTimeList(summary.netOfflineTimes)}
                                </span>
                            </li>
                        )}
                        {summary.rebootTimes.length > 0 && (
                            <li className="flex items-start gap-2">
                                <Power className="mt-0.5 size-3.5 shrink-0 text-violet-500" />
                                <span>
                                    <span className="font-medium">
                                        Reboot {summary.rebootTimes.length}×
                                    </span>{' '}
                                    — {formatTimeList(summary.rebootTimes)}
                                </span>
                            </li>
                        )}
                        {summary.firstErrorTime && (
                            <li className="flex items-start gap-2">
                                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-red-500" />
                                <span>
                                    <span className="font-medium">
                                        Error pertama {summary.firstErrorTime}
                                    </span>
                                    , terakhir {summary.lastErrorTime}
                                </span>
                            </li>
                        )}
                        {summary.lastFtpUploadTime && (
                            <li className="flex items-start gap-2">
                                <Upload className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                                <span>
                                    <span className="font-medium">
                                        Upload FTP terakhir{' '}
                                        {summary.lastFtpUploadTime}
                                    </span>{' '}
                                    ({summary.ftpUploads}× total)
                                </span>
                            </li>
                        )}
                    </ul>
                </div>
            )}

            {summary.topErrorModules.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                        <AlertCircle className="size-3.5" /> Fault terbanyak
                    </p>
                    <div className="space-y-1.5">
                        {summary.topErrorModules.map((f) => (
                            <div
                                key={f.module}
                                className="flex items-center gap-2"
                            >
                                <span className="w-28 shrink-0 truncate font-mono text-xs">
                                    {f.module}
                                </span>
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-red-500/10">
                                    <div
                                        className="h-full rounded-full bg-red-500/60"
                                        style={{
                                            width: `${(f.count / maxErr) * 100}%`,
                                        }}
                                    />
                                </div>
                                <span className="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
                                    {f.count}×
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// Render one syslog line: "[HH:MM:SS] [LEVEL] [MODULE] message" with per-level coloring.
// Non-standard lines (e.g. "[SYSLOG] Daily flush summary: …") fall back to plain text.
function SyslogLine({ line }: { line: string }) {
    const m = line.match(SYSLOG_LINE_RE);
    if (!m) {
        return (
            <div className="whitespace-pre-wrap text-muted-foreground">
                {line || ' '}
            </div>
        );
    }
    const [, time, levelRaw, mod, msg] = m;
    const level = levelRaw.trim().toUpperCase();
    const levelColor =
        level === 'ERROR'
            ? 'text-red-500'
            : level === 'WARN'
              ? 'text-amber-500'
              : level === 'CFG'
                ? 'text-violet-500'
                : level === 'INFO'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground';
    return (
        <div className="flex gap-2 whitespace-pre-wrap">
            <span className="shrink-0 text-muted-foreground">[{time}]</span>
            <span className={`shrink-0 font-medium ${levelColor}`}>
                [{level}]
            </span>
            <span className="shrink-0 text-sky-600 dark:text-sky-400">
                [{mod}]
            </span>
            <span
                className={
                    level === 'ERROR' ? 'text-red-500/90' : 'text-foreground'
                }
            >
                {msg}
            </span>
        </div>
    );
}

// SD Card → USB copy. Mirrors the FTP file browser's month → day drill-down: LISTMONTH lists
// months, LISTDAY lists that month's date-files. "Copy semua ke USB" (COPY_ALL) lives in the
// month view; each day-file has its own copy action (COPY src). Both stream live progress over
// EventSource (/api/mqtt/usb/stream) until DONE/ERR.
export function UsbCopyCard({
    deviceIdentifier,
    disabled,
}: {
    deviceIdentifier: string;
    disabled: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [months, setMonths] = useState<string[]>([]);
    const [files, setFiles] = useState<string[]>([]);
    const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
    const [browseView, setBrowseView] = useState<'months' | 'files'>('months');
    const [loading, setLoading] = useState(false);
    const [listError, setListError] = useState<string | null>(null);

    const [copying, setCopying] = useState(false);
    const [copyTarget, setCopyTarget] = useState<string | null>(null); // 'all' or a filename
    const [percent, setPercent] = useState(0);
    const [copied, setCopied] = useState<{ file: string; size?: string }[]>([]);
    const [copyError, setCopyError] = useState<string | null>(null);
    const [doneMsg, setDoneMsg] = useState<string | null>(null);
    const esRef = useRef<EventSource | null>(null);

    function closeStream() {
        if (esRef.current) {
            esRef.current.close();
            esRef.current = null;
        }
    }

    function formatMonth(monthStr: string) {
        const [yearStr, monthNum] = monthStr.split('-');
        const monthNames = [
            'Januari',
            'Februari',
            'Maret',
            'April',
            'Mei',
            'Juni',
            'Juli',
            'Agustus',
            'September',
            'Oktober',
            'November',
            'Desember',
        ];
        return `${monthNames[parseInt(monthNum) - 1]} ${yearStr}`;
    }

    // LISTMONTH — months that have data on the SD card ({"USB":{"months":["2026-06",...]}}).
    async function loadMonths() {
        setLoading(true);
        setListError(null);
        setMonths([]);
        setFiles([]);
        setSelectedMonth(null);
        setBrowseView('months');
        try {
            const res = await apiFetch('/api/mqtt/protocol/command', {
                id_logger: deviceIdentifier,
                module: 'USB',
                payload: { USB: { cmd: 'LISTMONTH' } },
            });
            const data = await res.json();
            if (!data.success) {
                setListError(
                    data.message || 'Perangkat tidak merespons (LISTMONTH).',
                );
                return;
            }
            const raw = data?.data?.USB?.months;
            const list: string[] = Array.isArray(raw)
                ? raw.filter((m: unknown): m is string => typeof m === 'string')
                : [];
            list.sort((a, b) => a.localeCompare(b));
            setMonths(list);
        } catch {
            setListError('Network error — tidak dapat terhubung ke server.');
        } finally {
            setLoading(false);
        }
    }

    // LISTDAY — date-files within one month ({"USB":{"files":["2026-06-17.csv",...]}}).
    async function selectMonth(monthStr: string) {
        setSelectedMonth(monthStr);
        setBrowseView('files');
        setLoading(true);
        setListError(null);
        setFiles([]);
        const [yearStr, monthNum] = monthStr.split('-');
        try {
            const res = await apiFetch('/api/mqtt/protocol/command', {
                id_logger: deviceIdentifier,
                module: 'USB',
                payload: {
                    USB: {
                        cmd: 'LISTDAY',
                        y: parseInt(yearStr),
                        m: parseInt(monthNum),
                    },
                },
            });
            const data = await res.json();
            if (!data.success) {
                setListError(
                    data.message || 'Perangkat tidak merespons (LISTDAY).',
                );
                return;
            }
            const raw = data?.data?.USB?.files;
            const list: string[] = Array.isArray(raw)
                ? raw.filter((f: unknown): f is string => typeof f === 'string')
                : [];
            list.sort((a, b) => a.localeCompare(b));
            setFiles(list);
        } catch {
            setListError('Network error — tidak dapat terhubung ke server.');
        } finally {
            setLoading(false);
        }
    }

    function backToMonths() {
        setBrowseView('months');
        setSelectedMonth(null);
        setFiles([]);
        setListError(null);
    }

    function openBrowser() {
        setOpen(true);
        setCopying(false);
        setCopyTarget(null);
        setPercent(0);
        setCopied([]);
        setCopyError(null);
        setDoneMsg(null);
        closeStream();
        loadMonths();
    }

    // COPY (single date-file via `src`) or COPY_ALL (src omitted) — follow the live progress stream.
    function startCopy(src: string | null, label: string) {
        if (copying) return;
        setCopying(true);
        setCopyTarget(label);
        setPercent(0);
        setCopied([]);
        setCopyError(null);
        setDoneMsg(null);
        closeStream();

        const params = new URLSearchParams({ id_logger: deviceIdentifier });
        if (src) params.set('src', src);
        const es = new EventSource(`/api/mqtt/usb/stream?${params.toString()}`);
        esRef.current = es;
        let finished = false;

        es.addEventListener('progress', (e) => {
            try {
                setPercent(JSON.parse((e as MessageEvent).data).percent ?? 0);
            } catch {
                /* ignore */
            }
        });
        es.addEventListener('file_ok', (e) => {
            try {
                const d = JSON.parse((e as MessageEvent).data);
                if (d.file)
                    setCopied((prev) => [
                        ...prev,
                        { file: d.file, size: d.size },
                    ]);
            } catch {
                /* ignore */
            }
        });
        es.addEventListener('done', (e) => {
            finished = true;
            try {
                const d = JSON.parse((e as MessageEvent).data);
                setDoneMsg(
                    d.file
                        ? `Selesai menyalin ${d.file} ke USB.`
                        : 'Semua file selesai disalin ke USB.',
                );
            } catch {
                setDoneMsg('Copy selesai.');
            }
            setPercent(100);
            setCopying(false);
            closeStream();
        });
        es.addEventListener('failed', (e) => {
            finished = true;
            let msg = 'Copy gagal';
            try {
                msg = JSON.parse((e as MessageEvent).data).message || msg;
            } catch {
                /* ignore */
            }
            setCopyError(msg);
            setCopying(false);
            closeStream();
        });
        es.onerror = () => {
            if (finished) return; // normal close after a terminal event
            finished = true;
            setCopyError('Koneksi ke server terputus saat copy.');
            setCopying(false);
            closeStream();
        };
    }

    // Abort any in-flight copy stream on unmount.
    useEffect(() => () => closeStream(), []);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <HardDrive className="size-5" /> SD Card → USB
                </CardTitle>
                <CardDescription className="mt-1">
                    Salin data harian dari SD card ke USB flashdisk
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
                    <div className="mb-3 flex items-center gap-2">
                        <Copy className="size-4 text-violet-500" />
                        <span className="text-sm font-medium">
                            Copy ke USB Flashdisk
                        </span>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={openBrowser}
                        disabled={disabled}
                        title={
                            disabled
                                ? 'Device offline — tidak bisa mengirim'
                                : ''
                        }
                    >
                        <HardDrive className="size-4" /> Pilih & Copy File
                    </Button>
                </div>
            </CardContent>

            {/* ══════ SD → USB copy dialog (month → day, mirrors the FTP browser) ══════ */}
            <Dialog
                open={open}
                onOpenChange={(o) => {
                    if (!o) closeStream();
                    setOpen(o);
                }}
            >
                <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <HardDrive className="size-5" /> SD Card → USB
                        </DialogTitle>
                        <DialogDescription>
                            {browseView === 'months'
                                ? 'Pilih bulan, atau salin semua data ke USB flashdisk'
                                : `File CSV — ${selectedMonth ? formatMonth(selectedMonth) : ''}`}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-2">
                        {loading ? (
                            <div className="flex flex-col items-center gap-3 py-8">
                                <Loader2 className="size-8 animate-spin text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">
                                    {browseView === 'months'
                                        ? 'Memuat daftar bulan (LISTMONTH)...'
                                        : 'Memuat daftar file (LISTDAY)...'}
                                </p>
                            </div>
                        ) : listError ? (
                            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center">
                                <AlertCircle className="mx-auto size-8 text-red-500/60" />
                                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                                    {listError}
                                </p>
                            </div>
                        ) : browseView === 'months' ? (
                            /* ─── Months View (with Copy semua) ─── */
                            <div className="space-y-1">
                                <button
                                    onClick={() => startCopy(null, 'all')}
                                    disabled={copying}
                                    className="flex w-full items-center justify-between rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-violet-500/10 disabled:opacity-50"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                                            <Copy className="size-4 text-violet-500" />
                                        </div>
                                        <span className="font-medium">
                                            Copy semua ke USB
                                        </span>
                                    </div>
                                    {copying && copyTarget === 'all' ? (
                                        <Loader2 className="size-4 animate-spin text-violet-500" />
                                    ) : (
                                        <span className="text-xs text-muted-foreground">
                                            semua bulan
                                        </span>
                                    )}
                                </button>

                                {months.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center">
                                        <HardDrive className="mx-auto size-8 text-muted-foreground/40" />
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            Tidak ada data ditemukan
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                            {months.length} bulan tersedia
                                        </div>
                                        <div className="max-h-[45vh] space-y-0.5 overflow-y-auto">
                                            {months.map((month) => (
                                                <button
                                                    key={month}
                                                    onClick={() =>
                                                        selectMonth(month)
                                                    }
                                                    disabled={copying}
                                                    className="flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 disabled:opacity-50"
                                                >
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                                                            <Clock className="size-4 text-blue-500" />
                                                        </div>
                                                        <span className="font-medium">
                                                            {formatMonth(month)}
                                                        </span>
                                                    </div>
                                                    <ChevronRight className="size-4 text-muted-foreground" />
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            /* ─── Files View (per-date copy) ─── */
                            <>
                                <button
                                    onClick={backToMonths}
                                    disabled={copying}
                                    className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                                >
                                    <ArrowLeft className="size-4" />
                                    <span>Kembali ke daftar bulan</span>
                                </button>
                                {files.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center">
                                        <FileText className="mx-auto size-8 text-muted-foreground/40" />
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            Tidak ada file ditemukan
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                            {files.length} file ditemukan
                                        </div>
                                        <div className="max-h-[45vh] space-y-0.5 overflow-y-auto">
                                            {files.map((file) => {
                                                const done = copied.some(
                                                    (c) => c.file === file,
                                                );
                                                const busy =
                                                    copying &&
                                                    copyTarget === file;
                                                return (
                                                    <div
                                                        key={file}
                                                        className="flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                                                    >
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <Database className="size-4 shrink-0 text-violet-500" />
                                                            <span className="truncate font-mono text-xs">
                                                                {file.replace(
                                                                    /\.csv$/i,
                                                                    '',
                                                                )}
                                                            </span>
                                                            {done && (
                                                                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                                                            )}
                                                        </div>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="size-7 shrink-0"
                                                            disabled={copying}
                                                            onClick={() =>
                                                                startCopy(
                                                                    file,
                                                                    file,
                                                                )
                                                            }
                                                            title={`Copy ${file} ke USB`}
                                                        >
                                                            {busy ? (
                                                                <Loader2 className="size-3.5 animate-spin" />
                                                            ) : (
                                                                <Copy className="size-3.5" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {(copying || doneMsg || copyError) && (
                            <div className="mt-3 space-y-2 rounded-md border p-3">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">
                                        {copying
                                            ? `Menyalin ${copyTarget === 'all' ? 'semua file' : (copyTarget ?? '')}…`
                                            : copyError
                                              ? 'Gagal'
                                              : 'Selesai'}
                                    </span>
                                    <span className="font-mono">
                                        {percent}%
                                    </span>
                                </div>
                                <Progress
                                    value={percent}
                                    className="h-2 [&>div]:bg-emerald-500 [&>div]:transition-all [&>div]:duration-200"
                                />
                                {copyTarget === 'all' && copied.length > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        {copied.length} file tersalin
                                    </p>
                                )}
                                {doneMsg && (
                                    <p className="text-xs text-emerald-600">
                                        {doneMsg}
                                    </p>
                                )}
                                {copyError && (
                                    <p className="text-xs text-red-600">
                                        {copyError}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                closeStream();
                                setOpen(false);
                            }}
                        >
                            Tutup
                        </Button>
                        {!loading && (
                            <Button
                                variant="outline"
                                disabled={copying}
                                onClick={
                                    browseView === 'months'
                                        ? loadMonths
                                        : () =>
                                              selectedMonth &&
                                              selectMonth(selectedMonth)
                                }
                                className="gap-1.5"
                            >
                                <RefreshCw className="size-4" /> Refresh
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

export function SystemLogsCard({
    deviceIdentifier,
    disabled,
    ftpConfigured,
    variant = 'card',
}: {
    deviceIdentifier: string;
    disabled: boolean;
    ftpConfigured: boolean;
    variant?: 'card' | 'button' | 'icon';
}) {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<'list' | 'viewer'>('list');
    const [files, setFiles] = useState<string[]>([]);
    const [loadingList, setLoadingList] = useState(false);
    const [listError, setListError] = useState<string | null>(null);

    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [content, setContent] = useState<string | null>(null);
    const [loadingContent, setLoadingContent] = useState(false);
    const [contentError, setContentError] = useState<string | null>(null);

    // READLOGS — list device-local syslog files (an MQTT round-trip, no FTP needed).
    async function loadList() {
        setLoadingList(true);
        setListError(null);
        setFiles([]);
        try {
            const res = await apiFetch('/api/mqtt/protocol/command', {
                id_logger: deviceIdentifier,
                module: 'FTP',
                payload: { FTP: { cmd: 'READLOGS' } },
            });
            const data = await res.json();
            if (!data.success) {
                setListError(
                    data.message || 'Perangkat tidak merespons (READLOGS).',
                );
                return;
            }
            const raw = data?.data?.FTP?.files;
            const list: string[] = Array.isArray(raw)
                ? raw.filter((f: unknown): f is string => typeof f === 'string')
                : [];
            // Oldest first (ascending) — filenames are YYYYMMDD.txt so a lexicographic sort works.
            list.sort((a, b) => a.localeCompare(b));
            setFiles(list);
        } catch {
            setListError('Network error — tidak dapat terhubung ke server.');
        } finally {
            setLoadingList(false);
        }
    }

    function openBrowser() {
        setOpen(true);
        setView('list');
        setSelectedFile(null);
        setContent(null);
        setContentError(null);
        loadList();
    }

    // Open one file. The /logview endpoint runs GETLOG (device → FTP upload, waiting for the
    // final OK) then reads the uploaded file's text back from FTP — one round-trip from the UI.
    async function openFile(file: string) {
        setSelectedFile(file);
        setView('viewer');
        setContent(null);
        setContentError(null);
        setLoadingContent(true);
        try {
            const viewRes = await apiFetch('/api/mqtt/ftp/logview', {
                id_logger: deviceIdentifier,
                filename: file,
            });
            const viewData = await viewRes.json();
            if (!viewData.success) {
                setContentError(
                    viewData.message ||
                        'Gagal mengambil isi file dari perangkat/FTP.',
                );
                return;
            }
            setContent(
                typeof viewData.content === 'string' ? viewData.content : '',
            );
        } catch {
            setContentError('Network error — tidak dapat terhubung ke server.');
        } finally {
            setLoadingContent(false);
        }
    }

    function backToList() {
        setView('list');
        setSelectedFile(null);
        setContent(null);
        setContentError(null);
    }

    // Save the already-loaded log text to a local .txt file (no extra round-trip).
    function downloadLog() {
        if (content === null || !selectedFile) return;
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = selectedFile;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    const lines =
        content !== null ? content.replace(/\r\n/g, '\n').split('\n') : [];
        const hasLogText = content !== null && content.trim().length > 0;
    const summary = useMemo(
        () => (content !== null ? summarizeSyslog(content) : null),
        [content],
    );

    const triggerButton =
        variant === 'icon' ? (
            <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={openBrowser}
                disabled={disabled || !ftpConfigured}
                title={
                    disabled
                        ? 'Device offline — tidak bisa mengirim'
                        : !ftpConfigured
                          ? 'Konfigurasi FTP diperlukan terlebih dahulu'
                          : 'Log Sistem Harian'
                }
            >
                <ScrollText className="size-4" />
            </Button>
        ) : (
        <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={openBrowser}
            disabled={disabled || !ftpConfigured}
            title={
                disabled
                    ? 'Device offline â€” tidak bisa mengirim'
                    : !ftpConfigured
                      ? 'Konfigurasi FTP diperlukan terlebih dahulu'
                      : ''
            }
        >
            <ScrollText className="size-4" /> Log Sistem Harian
        </Button>
        );

    return (
        <>
            {variant === 'card' ? (
                <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <ScrollText className="size-5" /> System Logs
                        </CardTitle>
                        <CardDescription className="mt-1">
                            Black-box recorder — log sistem harian dari
                            perangkat
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                    <div className="mb-3 flex items-center gap-2">
                        <ScrollText className="size-4 text-blue-500" />
                        <span className="text-sm font-medium">
                            Log Sistem Harian
                        </span>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={openBrowser}
                        disabled={disabled || !ftpConfigured}
                        title={
                            disabled
                                ? 'Device offline — tidak bisa mengirim'
                                : !ftpConfigured
                                  ? 'Konfigurasi FTP diperlukan terlebih dahulu'
                                  : ''
                        }
                    >
                        <HardDrive className="size-4" /> Lihat Log Sistem
                    </Button>
                </div>
            </CardContent>
                </Card>
            ) : (
                triggerButton
            )}

            {/* ══════ System Logs Browser / Viewer Dialog ══════ */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent
                    className={`flex max-h-[85vh] flex-col overflow-hidden ${view === 'list' ? 'sm:max-w-lg' : 'sm:max-w-3xl'}`}
                >
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ScrollText className="size-5" /> System Logs
                        </DialogTitle>
                        <DialogDescription>
                            {view === 'list'
                                ? 'Daftar file log sistem di perangkat'
                                : `syslog_${selectedFile ?? ''}`}
                        </DialogDescription>
                    </DialogHeader>

                    <div
                        className={`min-h-0 flex-1 py-2 ${view === 'list' ? 'overflow-y-auto' : 'flex flex-col overflow-hidden'}`}
                    >
                        {view === 'list' ? (
                            loadingList ? (
                                <div className="flex flex-col items-center gap-3 py-8">
                                    <Loader2 className="size-8 animate-spin text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">
                                        Memuat daftar log (READLOGS)...
                                    </p>
                                </div>
                            ) : listError ? (
                                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center">
                                    <AlertCircle className="mx-auto size-8 text-red-500/60" />
                                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                                        {listError}
                                    </p>
                                </div>
                            ) : files.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center">
                                    <ScrollText className="mx-auto size-8 text-muted-foreground/40" />
                                    <p className="mt-2 text-sm text-muted-foreground">
                                        Tidak ada file log ditemukan
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                        {files.length} file log tersedia
                                    </div>
                                    <div className="space-y-0.5">
                                        {files.map((file) => (
                                            <button
                                                key={file}
                                                onClick={() => openFile(file)}
                                                className="flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
                                            >
                                                <div className="flex min-w-0 items-center gap-2.5">
                                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                                                        <FileText className="size-4 text-blue-500" />
                                                    </div>
                                                    <span className="truncate font-mono text-xs">
                                                        {file.replace(
                                                            /\.txt$/i,
                                                            '',
                                                        )}
                                                    </span>
                                                </div>
                                                <Download className="size-4 shrink-0 text-muted-foreground" />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )
                        ) : (
                            /* ─── Viewer ─── */
                            <>
                                <button
                                    onClick={backToList}
                                    className="mb-2 flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    <ArrowLeft className="size-4" />
                                    <span>Kembali ke daftar file</span>
                                </button>
                                {loadingContent ? (
                                    <div className="flex flex-col items-center gap-3 py-10">
                                        <Loader2 className="size-8 animate-spin text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground">Mengupload (GETLOG) &amp; membaca isi log... maksimal 5 menit</p>
                                    </div>
                                ) : contentError ? (
                                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center">
                                        <AlertCircle className="mx-auto size-8 text-red-500/60" />
                                        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                                            {contentError}
                                        </p>
                                    </div>
                                ) : !hasLogText ? (
                                    <div className="rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center">
                                        <FileText className="mx-auto size-8 text-muted-foreground/40" />
                                        <p className="mt-2 text-sm font-medium">File log kosong</p>
                                        <p className="mt-1 text-xs text-muted-foreground">Upload berhasil, tapi file dari FTP tidak berisi baris log.</p>
                                    </div>
                                ) : (
                                    <>
                                        {summary && (
                                            <div className="shrink-0">
                                                <SyslogSummary
                                                    summary={summary}
                                                />
                                            </div>
                                        )}
                                        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-muted/30">
                                            <div className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
                                                {lines.map((line, i) => (
                                                    <SyslogLine
                                                        key={i}
                                                        line={line}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setOpen(false)}
                        >
                            Tutup
                        </Button>
                        {view === 'list' && !loadingList && (
                            <Button
                                variant="outline"
                                className="gap-1.5"
                                onClick={loadList}
                            >
                                <RefreshCw className="size-4" /> Refresh
                            </Button>
                        )}
                        {view === 'viewer' &&
                            !loadingContent &&
                            content !== null &&
                            selectedFile && (
                                <Button
                                    variant="outline"
                                    className="gap-1.5"
                                    onClick={downloadLog}
                                >
                                    <Download className="size-4" /> Unduh
                                </Button>
                            )}
                        {view === 'viewer' &&
                            !loadingContent &&
                            selectedFile && (
                                <Button
                                    variant="outline"
                                    className="gap-1.5"
                                    onClick={() => openFile(selectedFile)}
                                >
                                    <RefreshCw className="size-4" /> Muat ulang
                                </Button>
                            )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

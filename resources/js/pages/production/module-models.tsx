import { useForm } from '@inertiajs/react';
import { Boxes, Download, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ModuleFirmware } from './production-modules';

// The module models that take OTA updates (ModuleFirmware::MODELS); EWS and GCM have none.
const MODULE_MODELS = ['Security System'];

function formatBytes(bytes: number | null): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Module models on the Models page, with the same OTA box and "Upload OTA" as a
 * logger model card. The module rows on the Production page download from here.
 */
export function ModuleModelsSection({
    firmwares,
}: {
    firmwares: Record<string, ModuleFirmware>;
}) {
    const [target, setTarget] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const form = useForm<{
        model: string;
        firmware_version: string;
        firmware_file: File | null;
    }>({ model: '', firmware_version: '', firmware_file: null });

    function open(model: string) {
        form.reset();
        form.clearErrors();
        form.setData('model', model);
        setTarget(model);
    }

    function submit(e: FormEvent) {
        e.preventDefault();
        form.post('/production/module-firmware', {
            forceFormData: true,
            preserveScroll: true,
            onSuccess: () => {
                if (fileInput.current) fileInput.current.value = '';
                setTarget(null);
            },
        });
    }

    const current = target ? firmwares[target] : undefined;

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-lg font-semibold tracking-tight">
                    Model Modul
                </h2>
                <p className="text-sm text-muted-foreground">
                    Firmware OTA per model modul, diunduh dari tampilan Modul di
                    halaman Production.
                </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {MODULE_MODELS.map((model) => {
                    const fw = firmwares[model];
                    return (
                        <Card key={model} className="overflow-hidden">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-2">
                                    <Boxes className="size-4 text-muted-foreground" />
                                    <h3 className="font-semibold">{model}</h3>
                                </div>
                                <div className="mt-3 rounded-lg border p-3 text-xs">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">
                                            OTA
                                        </span>
                                        <span className="font-mono font-medium">
                                            {fw?.version || '—'}
                                        </span>
                                    </div>
                                    <div className="mt-1 truncate font-mono text-muted-foreground">
                                        {fw?.fileName || 'No firmware file'}
                                    </div>
                                </div>
                                <div className="mt-3 flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1 gap-1.5"
                                        onClick={() => open(model)}
                                    >
                                        <UploadCloud className="size-3.5" />
                                        Upload OTA
                                    </Button>
                                    {fw && (
                                        <Button
                                            variant="outline"
                                            size="icon-sm"
                                            asChild
                                        >
                                            <a
                                                href={fw.fileUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                aria-label={`Download firmware ${model}`}
                                            >
                                                <Download className="size-3.5" />
                                            </a>
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            <Dialog
                open={target !== null}
                onOpenChange={(o) => {
                    if (!o) setTarget(null);
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Upload OTA Firmware</DialogTitle>
                        <DialogDescription>
                            {target} · current {current?.version || '—'}
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={submit} className="grid gap-4 py-2">
                        <div className="rounded-lg border p-3 text-sm">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-muted-foreground">
                                    Current file
                                </span>
                                <span className="max-w-[220px] truncate font-mono text-xs">
                                    {current?.fileName || '—'}
                                </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-3">
                                <span className="text-muted-foreground">
                                    Size
                                </span>
                                <span className="font-mono text-xs">
                                    {formatBytes(current?.fileSize ?? null)}
                                </span>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="module_ota_version">
                                Firmware Version *
                            </Label>
                            <Input
                                id="module_ota_version"
                                value={form.data.firmware_version}
                                onChange={(e) =>
                                    form.setData(
                                        'firmware_version',
                                        e.target.value,
                                    )
                                }
                                placeholder="e.g. v1.0"
                            />
                            {form.errors.firmware_version && (
                                <p className="text-xs text-red-500">
                                    {form.errors.firmware_version}
                                </p>
                            )}
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="module_ota_file">
                                Firmware File (.bin) *
                            </Label>
                            <Input
                                id="module_ota_file"
                                type="file"
                                accept=".bin,application/octet-stream"
                                ref={fileInput}
                                onChange={(e) =>
                                    form.setData(
                                        'firmware_file',
                                        e.target.files?.[0] ?? null,
                                    )
                                }
                            />
                            {form.errors.firmware_file && (
                                <p className="text-xs text-red-500">
                                    {form.errors.firmware_file}
                                </p>
                            )}
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setTarget(null)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={
                                    form.processing ||
                                    !form.data.firmware_version ||
                                    !form.data.firmware_file
                                }
                            >
                                {form.processing
                                    ? 'Uploading…'
                                    : 'Upload Firmware'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}

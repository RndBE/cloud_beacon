export function getCloudSshDisplayName(name: string): string {
    return name.replace(/\s*\(Orange Pi\)\s*$/i, '').trim();
}

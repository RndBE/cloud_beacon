export interface LoggerAssignment {
    remoteDeviceId: number | null;
}

export function isLoggerSelectionDisabled(
    logger: LoggerAssignment,
    currentDeviceId: number | null,
): boolean {
    return (
        logger.remoteDeviceId !== null &&
        logger.remoteDeviceId !== currentDeviceId
    );
}

export function updateLoggerSelection(
    selectedIds: number[],
    loggerId: number,
    checked: boolean,
): number[] {
    if (!checked) {
        return selectedIds.filter((id) => id !== loggerId);
    }

    return selectedIds.includes(loggerId)
        ? selectedIds
        : [...selectedIds, loggerId];
}

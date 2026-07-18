/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const sidebarSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/components/app-sidebar.tsx'),
    'utf8',
);
const navMainSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/components/nav-main.tsx'),
    'utf8',
);

function groupSource(groupName, nextGroupName) {
    const start = sidebarSource.indexOf(`const ${groupName}NavItems`);
    const end = nextGroupName
        ? sidebarSource.indexOf(`const ${nextGroupName}NavItems`, start)
        : sidebarSource.indexOf('const footerNavItems', start);

    assert.notEqual(start, -1, `${groupName} group must exist`);
    assert.notEqual(end, -1, `${groupName} group must have a boundary`);

    return sidebarSource.slice(start, end);
}

test('sidebar separates platform navigation into approved workflow groups', () => {
    const overview = groupSource('overview', 'monitoring');
    const monitoring = groupSource('monitoring', 'production');
    const production = groupSource('production', 'operations');
    const operations = groupSource('operations', 'management');
    const management = groupSource('management', null);

    assert.match(overview, /nav\.dashboard/);
    assert.match(overview, /nav\.topology/);

    assert.match(monitoring, /nav\.loggers/);
    assert.match(monitoring, /Projects/);
    assert.match(monitoring, /Forwarding Logs/);
    assert.match(monitoring, /Data Audit/);

    assert.match(production, /nav\.production/);
    assert.match(production, /nav\.models/);
    assert.match(production, /Setup Logger \(USB\)/);

    assert.match(operations, /Maintenance/);
    assert.match(operations, /Cloud SSH/);

    assert.match(management, /nav\.roles/);
    assert.match(management, /nav\.users/);
});

test('sidebar renders the approved labels in order without a Platform group', () => {
    const labels = [...sidebarSource.matchAll(/<NavMain[^>]+label="([^"]+)"/g)].map(
        (match) => match[1],
    );

    assert.deepEqual(labels, [
        'Overview',
        'Monitoring',
        'Production',
        'Operations',
        'Management',
    ]);
    assert.doesNotMatch(sidebarSource, /items=\{mainNavItems\}/);
});

test('navigation group does not render when permission filtering removes every item', () => {
    assert.match(navMainSource, /if \(items\.length === 0\) return null;/);
});

test('sidebar groups are controlled collapsibles with persisted open state', () => {
    assert.match(sidebarSource, /readStoredSidebarGroups/);
    assert.match(sidebarSource, /storeSidebarGroups/);
    assert.match(sidebarSource, /open=\{openGroups\.overview\}/);
    assert.match(sidebarSource, /onOpenChange=/);

    assert.match(navMainSource, /<Collapsible/);
    assert.match(navMainSource, /<CollapsibleTrigger/);
    assert.match(navMainSource, /<CollapsibleContent/);
    assert.match(navMainSource, /forceMount/);
    assert.match(navMainSource, /group-data-\[collapsible=icon\]:!block/);
    assert.match(navMainSource, /items\.some\(\(item\) => isCurrentUrl\(item\.href\)\)/);
});

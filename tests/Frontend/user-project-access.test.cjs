/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/users/index.tsx'),
    'utf8',
);

test('user form supports dynamic project access with all or selected logger scope', () => {
    assert.match(source, /type ProjectLoggerScope = 'all' \| 'selected'/);
    assert.match(source, /interface ProjectItem/);
    assert.match(source, /assignedProjects: AssignedProjectItem\[\]/);
    assert.match(source, /allProjects: ProjectItem\[\]/);
    assert.match(source, /project_access: \{\} as ProjectAccessValue/);
    assert.match(source, /function ProjectAccessPicker/);
    assert.match(source, /logger_scope: 'all'/);
    assert.match(source, /logger_ids: \[\]/);
    assert.match(source, /toggleProjectLogger/);
    assert.match(source, /Project & Logger Access/);
});

test('project access picker uses compact rows that do not stretch vertically', () => {
    assert.match(source, /className="grid max-h-\[420px\] content-start gap-2/);
    assert.match(source, /className="rounded-md border px-3 py-2/);
    assert.match(source, /className="flex items-center gap-3"/);
    assert.match(
        source,
        /className="grid content-start gap-2 self-start rounded-lg/,
    );
});

test('project access picker uses themed select components for access controls', () => {
    assert.match(source, /@\/components\/ui\/select/);
    assert.match(source, /<SelectTrigger className="h-10/);
    assert.match(source, /<SelectContent position="popper"/);
    assert.match(source, /<SelectItem value="manage">/);
    assert.match(source, /projectAccessLevelMeta\s*\.manage\.label/);
    assert.match(
        source,
        /<SelectItem value="selected">\s*Pilih logger tertentu\s*<\/SelectItem>/,
    );

    const selectTriggerUsages = source.match(/<SelectTrigger className=/g);

    assert.equal(selectTriggerUsages?.length, 2);
});

test('project access picker explains access and logger scope choices', () => {
    assert.match(source, /const projectAccessLevelMeta/);
    assert.match(source, /Hak akses/);
    assert.match(source, /Cakupan logger/);
    assert.match(source, /User hanya dapat melihat data logger/);
    assert.match(source, /User dapat mengelola data dan akses logger/);
    assert.match(source, /Semua logger di project ini otomatis tercakup/);
    assert.match(
        source,
        /\$\{selectedLoggerIds\.length\} dari \$\{project\.loggers\.length\} logger dipilih/,
    );
    assert.match(source, /Pilih logger yang boleh diakses/);
});

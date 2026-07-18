/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const mapSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/components/logger-map.tsx'),
    'utf8',
);
const cssSource = readFileSync(
    path.resolve(__dirname, '../../resources/css/app.css'),
    'utf8',
);

test('logger map uses OSM tiles in light mode and CARTO Dark Matter in dark mode', () => {
    assert.match(mapSource, /className="logger-map"/);
    assert.match(mapSource, /useAppearance/);
    assert.match(mapSource, /resolvedAppearance === 'dark'/);
    assert.match(
        mapSource,
        /url: 'https:\/\/\{s\}\.tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png'/,
    );
    assert.match(
        mapSource,
        /url: 'https:\/\/\{s\}\.basemaps\.cartocdn\.com\/dark_all\/\{z\}\/\{x\}\/\{y\}\{r\}\.png'/,
    );
    assert.match(mapSource, /subdomains=\{activeTileLayer\.subdomains\}/);
    assert.match(mapSource, /maxZoom=\{activeTileLayer\.maxZoom\}/);
    assert.match(mapSource, /url=\{activeTileLayer\.url\}/);
    assert.match(mapSource, /carto\.com\/attributions/);
    assert.doesNotMatch(cssSource, /\.dark \.logger-map \.leaflet-tile-pane/);
    assert.match(cssSource, /\.dark \.logger-map \.leaflet-control-zoom a/);
    assert.match(
        cssSource,
        /\.dark \.logger-map \.leaflet-popup-content-wrapper/,
    );
});

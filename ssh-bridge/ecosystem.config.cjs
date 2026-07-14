// pm2 config — jalankan dari direktori ssh-bridge:
//   pm2 start ecosystem.config.cjs
// Env diambil dari file .env di direktori ini (lihat .env.example).
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '.env');
const env = {};
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) env[m[1]] = m[2];
    }
}

module.exports = {
    apps: [
        {
            name: 'cloud-beacon-ssh-bridge',
            script: 'server.js',
            cwd: __dirname,
            env,
            max_restarts: 10,
            restart_delay: 5000,
        },
    ],
};

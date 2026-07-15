module.exports = {
    apps: [
        {
            name: 'cloud-beacon-web-gateway',
            cwd: __dirname,
            script: 'src/server.js',
            interpreter: '/opt/plesk/node/24/bin/node',
            node_args: '--env-file=.env',
            autorestart: true,
            restart_delay: 5000,
        },
    ],
};

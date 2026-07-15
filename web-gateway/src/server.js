import { loadConfig } from './config.js';
import { createGateway } from './gateway.js';

const config = loadConfig();
const gateway = createGateway({ config, logger: console });

gateway.server.listen(config.port, config.bindHost, () => {
    console.info(
        `Cloud Web gateway listening on ${config.bindHost}:${config.port}`,
    );
});

let stopping = false;

async function stop(signal) {
    if (stopping) {
        return;
    }

    stopping = true;
    console.info(`Cloud Web gateway stopping after ${signal}.`);

    try {
        await gateway.close();
        process.exitCode = 0;
    } catch {
        process.exitCode = 1;
    }
}

process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

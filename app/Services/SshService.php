<?php

namespace App\Services;

use Spatie\Ssh\Ssh;
use Throwable;

/**
 * Handles SSH-based remote service management.
 */
class SshService
{
    private string $host;
    private string $user;
    private int $port;
    private ?string $privateKeyPath;
    private ?string $password;

    public function __construct()
    {
        $this->host           = config('ssh.host', '');
        $this->user           = config('ssh.user', 'root');
        $this->port           = (int) config('ssh.port', 22);
        $this->privateKeyPath = config('ssh.private_key_path');
        $this->password       = config('ssh.password');
    }

    /**
     * Restart a systemd service on the remote server.
     *
     * @param  string  $service  e.g. "mqtt-broker" or "your-service-name"
     * @return array{success: bool, output: string}
     */
    public function restartService(string $service): array
    {
        if (empty($this->host)) {
            \Log::warning('[SSH] HOST is not configured. Skipping service restart.');
            return ['success' => false, 'output' => 'SSH host not configured.'];
        }

        try {
            $ssh = Ssh::create($this->user, $this->host)
                ->usePort($this->port)
                ->disableStrictHostKeyChecking()
                ->setTimeout(30);

            if ($this->privateKeyPath && file_exists($this->privateKeyPath)) {
                $ssh = $ssh->usePrivateKey($this->privateKeyPath);
            }

            $command = "sudo systemctl restart {$service} 2>&1 && echo 'RESTART_OK'";
            $process = $ssh->execute($command);

            $output  = $process->getOutput() . $process->getErrorOutput();
            $success = $process->isSuccessful() || str_contains($output, 'RESTART_OK');

            \Log::info('[SSH] systemctl restart ' . $service . ' → ' . ($success ? 'OK' : 'FAILED') . ' | ' . trim($output));

            return ['success' => $success, 'output' => trim($output)];

        } catch (Throwable $e) {
            \Log::error('[SSH] Exception restarting service "' . $service . '": ' . $e->getMessage());
            return ['success' => false, 'output' => $e->getMessage()];
        }
    }
}

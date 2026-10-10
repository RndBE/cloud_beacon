<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * AI assistant chat: streams one model turn from an OpenAI-compatible API
 * (9router combo on Server 3 by default, same as go-hidro Copilot).
 *
 * The browser owns the conversation and the tool loop: it sends the history
 * plus the tool list (resources/js/lib/assistant-commands.ts), runs any tool
 * calls itself under the user's own session, then posts again with the
 * results. This endpoint only adds the system prompt and the API key.
 *
 * SSE events: {"token": "..."} answer text, {"assistant": {...}} the finished
 * assistant message to append to the history (may carry tool_calls),
 * {"error": {"message": "..."}}, then [DONE].
 */
class AssistantController extends Controller
{
    public function chat(Request $request): StreamedResponse|JsonResponse
    {
        $data = $request->validate([
            'messages' => 'required|array|min:1|max:80',
            'messages.*.role' => 'required|in:user,assistant,tool',
            'messages.*.content' => 'nullable|string|max:30000',
            'messages.*.tool_calls' => 'nullable|array|max:20',
            'messages.*.tool_call_id' => 'nullable|string|max:200',
            'messages.*.reasoning_content' => 'nullable|string|max:100000',
            'tools' => 'nullable|array|max:100',
            'tools.*.type' => 'required|in:function',
            'tools.*.function.name' => 'required|string|max:64',
            'page.url' => 'nullable|string|max:500',
            'page.title' => 'nullable|string|max:200',
        ]);

        $config = config('services.assistant');
        if (empty($config['api_key'])) {
            return response()->json(['message' => 'Asisten belum dikonfigurasi (ASSISTANT_API_KEY kosong).'], 503);
        }

        $messages = [['role' => 'system', 'content' => $this->systemPrompt($request->user(), $data['page'] ?? [])]];
        foreach ($data['messages'] as $message) {
            $messages[] = array_filter([
                'role' => $message['role'],
                'content' => $message['content'] ?? '',
                'tool_calls' => $message['tool_calls'] ?? null,
                'tool_call_id' => $message['tool_call_id'] ?? null,
                // DeepSeek rejects a follow-up turn whose tool-call message lost its reasoning.
                'reasoning_content' => $message['reasoning_content'] ?? null,
            ], fn ($value) => $value !== null);
        }

        $payload = array_filter([
            'model' => $config['model'],
            'messages' => $messages,
            'stream' => true,
            'max_completion_tokens' => $config['max_tokens'],
            'tools' => $data['tools'] ?? null,
        ], fn ($value) => $value !== null && $value !== []);

        return response()->stream(function () use ($config, $payload) {
            @set_time_limit(0);
            // Web SAPIs open a buffer from the output_buffering ini; drop it so each
            // token goes out immediately. CLI (tests) has none of its own.
            if (PHP_SAPI !== 'cli') {
                while (ob_get_level() > 0) {
                    @ob_end_flush();
                }
            }
            $emit = function ($data) {
                echo 'data: '.(is_string($data) ? $data : json_encode($data, JSON_UNESCAPED_UNICODE))."\n\n";
                flush();
            };

            $result = $this->streamTurn($config, $payload, fn (string $token) => $emit(['token' => $token]));

            // A combo alias can land on a provider that wants the other token-limit
            // field; swap once if it was refused before any text was streamed.
            if ($result['status'] === 400 && $result['content'] === '' && str_contains($result['error'], 'max_tokens')) {
                $payload['max_tokens'] = $payload['max_completion_tokens'];
                unset($payload['max_completion_tokens']);
                $result = $this->streamTurn($config, $payload, fn (string $token) => $emit(['token' => $token]));
            }

            if ($result['error'] !== '') {
                Log::warning('Assistant LLM error', ['status' => $result['status'], 'error' => mb_substr($result['error'], 0, 500)]);
                $emit(['error' => [
                    'status' => $result['status'],
                    'message' => $result['status'] === 429
                        ? 'Layanan AI sedang sibuk. Coba lagi sebentar.'
                        : 'Asisten tidak dapat menjawab saat ini. Coba lagi.',
                ]]);
            } else {
                $emit(['assistant' => array_filter([
                    'role' => 'assistant',
                    'content' => $result['content'],
                    'tool_calls' => $result['tool_calls'] ?: null,
                    'reasoning_content' => $result['reasoning'] !== '' ? $result['reasoning'] : null,
                ], fn ($value) => $value !== null)]);
            }
            $emit('[DONE]');
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * One streaming /chat/completions request; text goes to $onToken as it arrives,
     * reasoning and tool-call fragments are collected.
     *
     * @return array{content: string, reasoning: string, tool_calls: array, status: int, error: string}
     */
    private function streamTurn(array $config, array $payload, callable $onToken): array
    {
        $result = ['content' => '', 'reasoning' => '', 'tool_calls' => [], 'status' => 0, 'error' => ''];

        try {
            $response = Http::withToken($config['api_key'])
                ->accept('text/event-stream')
                ->connectTimeout(10)
                ->timeout(180)
                ->withOptions(['stream' => true])
                ->post(rtrim($config['base_url'], '/').'/chat/completions', $payload);
        } catch (\Throwable $e) {
            return [...$result, 'error' => $e->getMessage()];
        }

        $result['status'] = $response->status();
        if ($response->failed()) {
            return [...$result, 'error' => (string) ($response->json('error.message') ?? $response->body())];
        }

        $body = $response->toPsrResponse()->getBody();
        $buffer = '';
        while (! $body->eof()) {
            $buffer .= $body->read(8192);
            while (($pos = strpos($buffer, "\n")) !== false) {
                $line = trim(substr($buffer, 0, $pos));
                $buffer = substr($buffer, $pos + 1);
                if (! str_starts_with($line, 'data:')) {
                    continue;
                }
                $chunk = json_decode(trim(substr($line, 5)), true);
                if (! is_array($chunk)) {
                    continue; // [DONE] or a broken line
                }
                if (isset($chunk['error'])) {
                    $result['error'] = $chunk['error']['message'] ?? json_encode($chunk['error']);

                    continue;
                }

                $delta = $chunk['choices'][0]['delta'] ?? [];
                if (($delta['reasoning_content'] ?? null) !== null) {
                    $result['reasoning'] .= $delta['reasoning_content'];
                }
                if (($delta['content'] ?? '') !== '') {
                    $result['content'] .= $delta['content'];
                    $onToken($delta['content']);
                }
                // Tool calls arrive in fragments keyed by index.
                foreach ($delta['tool_calls'] ?? [] as $fragment) {
                    $i = $fragment['index'] ?? 0;
                    $call = $result['tool_calls'][$i] ?? ['id' => '', 'type' => 'function', 'function' => ['name' => '', 'arguments' => '']];
                    if (! empty($fragment['id'])) {
                        $call['id'] = $fragment['id'];
                    }
                    $call['function']['name'] .= $fragment['function']['name'] ?? '';
                    $call['function']['arguments'] .= $fragment['function']['arguments'] ?? '';
                    $result['tool_calls'][$i] = $call;
                }
            }
        }

        ksort($result['tool_calls']);
        $result['tool_calls'] = array_values($result['tool_calls']);

        return $result;
    }

    private function systemPrompt(User $user, array $page): string
    {
        $now = now('Asia/Jakarta')->locale('id')->translatedFormat('l, d F Y H:i');
        $roles = $user->isSuperAdmin() ? 'superadmin' : ($user->roles->pluck('name')->join(', ') ?: '-');
        $pageUrl = $page['url'] ?? '-';
        $pageTitle = $page['title'] ?? '-';

        return <<<PROMPT
        Kamu adalah asisten Beacon Logger Cloud, aplikasi web untuk memantau dan mengonfigurasi data logger hidrologi (AWLR, ARR, AWR, GNSS, APMS) milik Beacon Engineering.
        Kamu bisa mengoperasikan website atas nama pengguna lewat tools: membaca data logger, mengubah konfigurasi, dan mengirim perintah ke perangkat.

        Pengguna: {$user->name} (peran: {$roles}). Waktu sekarang: {$now} WIB.
        Halaman yang sedang dibuka pengguna: {$pageTitle} ({$pageUrl}). Kalau URL-nya /loggers/<id>, "logger ini" berarti logger_id <id> itu.

        Aturan:
        - Jangan menebak id. Cari logger_id dengan list_loggers, dan id sensor/integrasi dengan get_logger. Id itu untuk tools saja; sebut logger dengan namanya ke pengguna.
        - Baca dulu kondisi sekarang sebelum mengubah (get_logger, read_device_module, read_sensor_names).
        - Setiap tool yang mengubah sesuatu akan dimintakan persetujuan ke pengguna oleh aplikasi. Sebelum memanggilnya, jelaskan singkat apa yang akan diubah dan akibatnya. Jangan bertanya "yakin?" lagi; tombol persetujuan sudah ada.
        - Kalau pengguna membatalkan sebuah tool, jangan ulangi tanpa diminta.
        - Untuk aksi berisiko (hapus, jaringan, firmware, mode profile, pintu air, sirine) sebutkan risikonya dengan jelas.
        - Logger offline tidak akan merespons perintah perangkat. Logger LEO (satelit) hanya bisa dikonfigurasi lewat USB di halaman logger.
        - Gunakan open_page supaya pengguna melihat halaman yang sedang kamu kerjakan, kalau relevan.
        - Laporkan hasil apa adanya, termasuk kalau gagal, beserta pesan errornya.
        - Jawab dalam bahasa pengguna (default Bahasa Indonesia), singkat dan jelas. Tulis teks biasa tanpa markdown (tanpa **, #, atau tabel); daftar boleh pakai "- ".
        PROMPT;
    }
}

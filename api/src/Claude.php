<?php

declare(strict_types=1);

namespace Dnd;

/**
 * Volání Claude API (Messages) přímo přes HTTP a cURL. Oficiální PHP SDK potřebuje Composer, který na Endoře nejde spustit
 * (a novější PHP), proto se volá podle dokumentace API bez knihovny. Klíč je jen v konfiguraci serveru, do prohlížeče se nikdy nedostane.
 */
final class Claude
{
    private const API_VERSION = '2023-06-01';
    private const DEFAULT_BASE = 'https://api.anthropic.com';

    public static function configured(): bool
    {
        return self::key() !== '';
    }

    /**
     * POST /v1/messages (bez streamování). Odpověď vrací dvakrát: `raw` dekódovanou jako objekty, aby se při zpětném odeslání
     * zachovaly prázdné objekty (`"input": {}` u nástroje bez parametrů; jako pole by z nich bylo `[]` a API by historii odmítlo), a `data` jako pole pro čtení.
     * Přetížení a výpadek sítě se jednou zopakuje, ale jen když první pokus selhal rychle (jinak by se přetáhl časový limit PHP).
     * @param array<string, mixed> $body
     * @param list<string> $betas
     * @return array{raw: object, data: array<string, mixed>}
     */
    public static function messages(array $body, array $betas = [], int $timeout = 110): array
    {
        $started = microtime(true);
        try {
            return self::decode(...self::request('POST', '/v1/messages', $body, $betas, $timeout));
        } catch (ClaudeError $e) {
            if (!$e->retryable() || microtime(true) - $started > 15) {
                throw $e;
            }
            usleep(1_500_000);
            return self::decode(...self::request('POST', '/v1/messages', $body, $betas, $timeout));
        }
    }

    /**
     * Ověří ze serveru, že API je dosažitelné a klíč platí (GET /v1/models nic nestojí). Pro diagnostiku nasazení.
     * @return array{reachable: bool, status: int, error: string|null}
     */
    public static function ping(): array
    {
        try {
            [$status, $text] = self::request('GET', '/v1/models?limit=1', null, [], 15);
        } catch (ClaudeError $e) {
            return ['reachable' => false, 'status' => $e->status, 'error' => $e->getMessage()];
        }
        $body = json_decode($text, true);
        return ['reachable' => true, 'status' => $status, 'error' => $status === 200 ? null : ClaudeError::fromResponse($status, is_array($body) ? $body : null)->getMessage()];
    }

    private static function key(): string
    {
        return trim((string) Config::get('claude_api_key', ''));
    }

    /** Adresu API mění jen testy (napodobený server); deploy jiné hodnoty na ostrém serveru odmítne. */
    private static function base(): string
    {
        $base = (string) (Config::get('claude_base_url') ?? '');
        return rtrim($base !== '' ? $base : self::DEFAULT_BASE, '/');
    }

    /** @return array{raw: object, data: array<string, mixed>} */
    private static function decode(int $status, string $text): array
    {
        $data = json_decode($text, true);
        if ($status !== 200 || !is_array($data)) {
            throw ClaudeError::fromResponse($status, is_array($data) ? $data : null);
        }
        $raw = json_decode($text);
        if (!is_object($raw)) {
            throw new ClaudeError($status, 'bad_response', 'Neočekávaná odpověď API.');
        }
        return ['raw' => $raw, 'data' => $data];
    }

    /**
     * @param array<string, mixed>|null $body
     * @param list<string> $betas
     * @return array{0: int, 1: string}
     */
    private static function request(string $method, string $path, ?array $body, array $betas, int $timeout): array
    {
        if (!function_exists('curl_init')) {
            throw new ClaudeError(0, 'no_curl', 'Na serveru chybí rozšíření PHP cURL.');
        }
        if (!self::configured()) {
            throw new ClaudeError(0, 'not_configured', 'Chybí claude_api_key v konfiguraci serveru.');
        }
        $headers = ['x-api-key: ' . self::key(), 'anthropic-version: ' . self::API_VERSION, 'content-type: application/json', 'accept: application/json'];
        if ($betas !== []) {
            $headers[] = 'anthropic-beta: ' . implode(',', $betas);
        }
        $ch = curl_init(self::base() . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_ENCODING => '',
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR));
        }
        $text = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if (!is_string($text)) {
            throw new ClaudeError(0, 'network', $error !== '' ? $error : 'Spojení s API selhalo.');
        }
        return [$status, $text];
    }
}

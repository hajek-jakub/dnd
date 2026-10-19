<?php

declare(strict_types=1);

namespace Dnd;

use RuntimeException;

/** Chyba při volání Claude API (síť, přetížení, neplatný klíč, odmítnutý požadavek). */
final class ClaudeError extends RuntimeException
{
    public function __construct(
        /** HTTP stav odpovědi API; 0 = požadavek vůbec neprošel (síť, chybí cURL). */
        public int $status,
        /** Typ chyby z API (`overloaded_error`, `invalid_request_error`, ...) nebo vlastní (`network`, `no_curl`). */
        public string $type,
        string $message,
    ) {
        parent::__construct($message);
    }

    /** @param array<string, mixed>|null $body */
    public static function fromResponse(int $status, ?array $body): self
    {
        $error = is_array($body['error'] ?? null) ? $body['error'] : [];
        return new self($status, (string) ($error['type'] ?? 'http_' . $status), (string) ($error['message'] ?? 'Neočekávaná odpověď API.'));
    }

    /** Má smysl to zkusit znovu (přetížení, výpadek, síť)? */
    public function retryable(): bool
    {
        return ($this->status === 0 && $this->type === 'network') || $this->status === 429 || $this->status >= 500;
    }
}

<?php

declare(strict_types=1);

namespace Dnd;

use RuntimeException;

/** Seed narazil na něco, co datový model neumí uložit nebo nejde jednoznačně namapovat. Nic se nezapsalo. */
final class SeedStop extends RuntimeException
{
    /** @param list<string> $problems */
    public function __construct(public array $problems)
    {
        parent::__construct("Seed se zastavil, nic se nezapsalo:\n - " . implode("\n - ", $problems));
    }
}

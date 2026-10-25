<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\Languages;
use Dnd\Push;
use Dnd\RateLimiter;
use Dnd\Request;
use Dnd\Response;

/**
 * Zprávy v kampani.
 *  - skupinový chat (thread 'group'): píše i čte každý člen kampaně,
 *  - soukromá konverzace DM a hráče (thread 'dm:<id hráče>'): hráč smí psát jen DM, DM smí psát hráči,
 *  - tajná zpráva od DM více hráčům (thread 'secret'): vidí ji jen DM a příjemci,
 *  - zpráva v jazyce (thread 'lang:<jazyk>'): píše hráč, který jazyk umí, a čtou ji ostatní hráči, kteří ho umí (v okamžiku odeslání), a DM.
 *    DM je mezi příjemci, takže ji vidí podle obecného pravidla níže; zprávy z doby, kdy se DM nepřidával, mu zůstanou skryté.
 * Připravené zprávy (koncepty, jen DM): text a příjemci se nachystají předem a odešlou se jako běžná zpráva (deliver); koncept vidí jen jeho autor.
 * Na každou zprávu jde reagovat jedním emoji (libovolným, jako na Messengeru; jiné emoji předchozí reakci nahradí), odpovědět na ni (reply_to_id, jen ve stejném vlákně a jen na zprávu, kterou odesílatel vidí),
 * autor ji smí upravit a smazat, DM smí smazat kteroukoli zprávu, kterou vidí (moderace). Smazaná zpráva ztratí text, ale zůstane v chatu.
 * Viditelnost drží jediné pravidlo (visibleSql): skupinové vidí každý člen, ostatní jen odesílatel a příjemci.
 * DM tedy nečte nic, co mu nebylo adresováno ani sám neodeslal. Hráči si mezi sebou píšou jen přes jazyky, které sdílejí (a DM to čte).
 */
final class MessageController
{
    private const MAX_BODY = 4000;
    private const PAGE = 200;

    /** SQL podmínka "tuto zprávu smí uživatel vidět"; parametry viz visibleArgs. */
    private static function visibleSql(): string
    {
        return "(m.thread = 'group' OR m.sender_id = ? OR EXISTS (SELECT 1 FROM message_recipients r WHERE r.message_id = m.id AND r.user_id = ?))";
    }

    /** @return list<string> */
    private static function visibleArgs(string $userId): array
    {
        return [$userId, $userId];
    }

    /**
     * Zprávy, které uživatel vidí. Bez `after` posledních 200, s `after` jen novější (průběžné dotazování), plus počty nepřečtených po vláknech.
     * @param array{id:string} $user
     */
    public static function index(Request $req, array $params, array $user): array
    {
        Access::requireMember($user, $params['id']);
        $after = max(0, (int) ($req->query['after'] ?? 0));
        $from = max(0, (int) ($req->query['from'] ?? 0));
        $base = 'SELECT m.id, m.sender_id, m.thread, m.body, m.created_at, m.reply_to_id, m.edited_at, m.deleted_at, u.display_name AS sender_name
                 FROM messages m JOIN users u ON u.id = m.sender_id
                 WHERE m.campaign_id = ? AND ' . self::visibleSql();
        $args = [$params['id'], ...self::visibleArgs($user['id'])];
        if ($after > 0) {
            $rows = Db::all($base . ' AND m.id > ? ORDER BY m.id LIMIT 500', [...$args, $after]);
        } else {
            $rows = array_reverse(Db::all($base . ' ORDER BY m.id DESC LIMIT ' . self::PAGE, $args));
        }

        $out = [
            'messages' => self::payloads($rows, $params['id'], $user['id']),
            'unread' => self::unreadByThread($params['id'], $user['id']),
            'languages' => self::myLanguages($params['id'], $user['id']),
        ];
        // Při průběžném dotazování klient pošle nejstarší načtenou zprávu (`from`) a dostane aktuální stav zpráv, které se mohly změnit
        // (reakce, úprava, smazání), i když už je má. Zpráva, která tu chybí, nemá reakce a nebyla upravena ani smazána.
        if ($from > 0) {
            $out['marks'] = self::marks($params['id'], $user['id'], $from);
        }
        return $out;
    }

    /**
     * Stav zpráv od `$from`, které mají reakce nebo byly upraveny či smazány (text jen u upravených, ať se klient dozví novou verzi).
     * @return list<array<string, mixed>>
     */
    private static function marks(string $campaignId, string $userId, int $from): array
    {
        $rows = Db::all(
            'SELECT m.id, m.body, m.edited_at, m.deleted_at FROM messages m
             WHERE m.campaign_id = ? AND m.id >= ? AND ' . self::visibleSql() . '
               AND (m.edited_at IS NOT NULL OR m.deleted_at IS NOT NULL OR EXISTS (SELECT 1 FROM message_reactions x WHERE x.message_id = m.id))
             ORDER BY m.id LIMIT 500',
            [$campaignId, $from, ...self::visibleArgs($userId)],
        );
        $reactions = self::reactionsOf(array_map(static fn (array $r): int => (int) $r['id'], $rows));
        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'body' => $r['body'],
            'editedAt' => $r['edited_at'] === null ? null : Ids::iso((string) $r['edited_at']),
            'deletedAt' => $r['deleted_at'] === null ? null : Ids::iso((string) $r['deleted_at']),
            'reactions' => $reactions[(int) $r['id']] ?? [],
        ], $rows);
    }

    /** @param array{id:string} $user */
    public static function send(Request $req, array $params, array $user): Response
    {
        $role = Access::requireMember($user, $params['id']);
        RateLimiter::hit('message:' . $user['id'], 40, 60);
        $data = $req->json();
        $body = Input::string($data, 'body', 1, self::MAX_BODY, 'Zpráva');

        $to = $data['to'] ?? null;
        if (is_array($to) && array_key_exists('language', $to)) {
            [$thread, $recipientIds] = self::languageTarget($role, $user['id'], $params['id'], $to['language']);
        } else {
            [$thread, $recipientIds] = self::resolveTarget($role, $user['id'], $params['id'], $to);
        }

        $replyTo = self::replyTarget($data['replyToId'] ?? null, $params['id'], $thread, $user['id']);

        return Response::json(['message' => self::deliver($params['id'], $user['id'], $thread, $body, $recipientIds, $replyTo)], 201);
    }

    /**
     * Zpráva, na kterou se odpovídá: musí být z téže kampaně a téhož vlákna, odesílatel ji musí vidět a nesmí být smazaná.
     * (Vlákno se shoduje, takže odpověď nikdy neposílá text zprávy do jiného vlákna, kde by ho nikdo neměl vidět.)
     */
    private static function replyTarget(mixed $id, string $campaignId, string $thread, string $userId): ?int
    {
        if ($id === null) {
            return null;
        }
        if (!is_int($id) || $id < 1) {
            throw HttpError::validation('Neplatná zpráva, na kterou odpovídáš.', 'replyToId');
        }
        $row = Db::one(
            'SELECT m.id, m.thread, m.deleted_at FROM messages m WHERE m.id = ? AND m.campaign_id = ? AND ' . self::visibleSql(),
            [$id, $campaignId, ...self::visibleArgs($userId)],
        );
        if ($row === null || $row['thread'] !== $thread) {
            throw HttpError::validation('Zpráva, na kterou odpovídáš, ve vlákně není.', 'replyToId');
        }
        if ($row['deleted_at'] !== null) {
            throw HttpError::validation('Na smazanou zprávu odpovědět nejde.', 'replyToId');
        }
        return $id;
    }

    // ------------------------------------------------------------------ reakce, úprava a smazání zprávy

    /**
     * Reakce smí být libovolné jedno emoji (jako na Messengeru), ne text: jeden grafém složený jen ze znaků emoji
     * (včetně barvy pleti, vlajek, sekvencí se ZWJ a klávesových čísel). Do databáze se tak nedostane nic jiného.
     */
    public static function isEmoji(mixed $value): bool
    {
        if (!is_string($value) || $value === '' || strlen($value) > 64 || mb_strlen($value) > 16) {
            return false;
        }
        if (preg_match('/^\X$/u', $value) !== 1) {
            return false;
        }
        $part = '\x{00A9}\x{00AE}\x{203C}\x{2049}\x{2122}\x{2139}\x{2194}-\x{21AA}\x{231A}-\x{23FF}\x{24C2}\x{25AA}-\x{25FE}\x{2600}-\x{27BF}\x{2934}\x{2935}'
            . '\x{2B00}-\x{2BFF}\x{3030}\x{303D}\x{3297}\x{3299}\x{1F000}-\x{1FAFF}';
        $extra = '\x{200D}\x{FE0F}\x{20E3}\x{1F3FB}-\x{1F3FF}\x{E0020}-\x{E007F}#*0-9';
        return preg_match('/^[' . $part . $extra . ']+$/u', $value) === 1 && preg_match('/[' . $part . '\x{20E3}]/u', $value) === 1;
    }

    /**
     * Zpráva, kterou uživatel smí vidět (jinak 404, ani cizí kampaň nepozná, že zpráva existuje).
     * @param array{id:string} $user
     * @return array{0: array<string, mixed>, 1: string}
     */
    private static function loadMessage(string $id, array $user): array
    {
        $row = ctype_digit($id) && strlen($id) < 19 ? Db::one('SELECT m.* FROM messages m WHERE m.id = ?', [(int) $id]) : null;
        $role = $row === null ? null : Access::role($user['id'], (string) $row['campaign_id']);
        if ($row === null || $role === null || Db::value('SELECT 1 FROM messages m WHERE m.id = ? AND ' . self::visibleSql(), [(int) $row['id'], ...self::visibleArgs($user['id'])]) === null) {
            throw HttpError::notFound('Zpráva nenalezena.');
        }
        return [$row, $role];
    }

    /** @return array<string, mixed> */
    private static function oneMessage(int $id, string $campaignId, string $userId): array
    {
        $row = Db::one(
            'SELECT m.id, m.sender_id, m.thread, m.body, m.created_at, m.reply_to_id, m.edited_at, m.deleted_at, u.display_name AS sender_name
             FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?',
            [$id],
        ) ?? [];
        return self::payloads([$row], $campaignId, $userId)[0];
    }

    /**
     * Reakce na zprávu jako na Messengeru: každý má u zprávy nejvýš jednu. Jiné emoji tu předchozí nahradí, stejné ji zruší.
     * Vrací aktuální reakce zprávy. @param array{id:string} $user
     */
    public static function react(Request $req, array $params, array $user): array
    {
        [$msg] = self::loadMessage($params['id'], $user);
        RateLimiter::hit('reaction:' . $user['id'], 120, 60);
        $emoji = $req->json()['emoji'] ?? null;
        if (!self::isEmoji($emoji)) {
            throw HttpError::validation('Reagovat jde jen jedním emoji.', 'emoji');
        }
        if ($msg['deleted_at'] !== null) {
            throw HttpError::validation('Na smazanou zprávu reagovat nejde.', 'emoji');
        }
        Db::transaction(static function () use ($msg, $user, $emoji): void {
            // Porovnání po bajtech: v řazení utf8mb4_unicode_ci jsou si různá emoji rovna (👍🏽 = 🇨🇿).
            $had = Db::value('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND BINARY emoji = BINARY ?', [$msg['id'], $user['id'], $emoji]) !== null;
            Db::exec('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?', [$msg['id'], $user['id']]);
            if (!$had) {
                Db::exec('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())', [$msg['id'], $user['id'], $emoji]);
            }
        });
        return ['id' => (int) $msg['id'], 'reactions' => self::reactionsOf([(int) $msg['id']])[(int) $msg['id']] ?? []];
    }

    /** Autor upraví text své zprávy (zpráva pak nese „upraveno“). @param array{id:string} $user */
    public static function edit(Request $req, array $params, array $user): array
    {
        [$msg] = self::loadMessage($params['id'], $user);
        if ($msg['sender_id'] !== $user['id']) {
            throw HttpError::forbidden('Cizí zprávu nemůžeš upravit.');
        }
        if ($msg['deleted_at'] !== null) {
            throw HttpError::validation('Smazanou zprávu upravit nejde.', 'body');
        }
        RateLimiter::hit('message:' . $user['id'], 40, 60);
        $body = Input::string($req->json(), 'body', 1, self::MAX_BODY, 'Zpráva');
        if ($body !== $msg['body']) {
            Db::exec('UPDATE messages SET body = ?, edited_at = UTC_TIMESTAMP() WHERE id = ?', [$body, $msg['id']]);
        }
        return ['message' => self::oneMessage((int) $msg['id'], (string) $msg['campaign_id'], $user['id'])];
    }

    /**
     * Smaže zprávu: vymaže text a reakce, zpráva zůstane v chatu jako smazaná. Smí autor, DM kteroukoli zprávu, kterou vidí (moderace).
     * @param array{id:string} $user
     */
    public static function remove(Request $req, array $params, array $user): array
    {
        [$msg, $role] = self::loadMessage($params['id'], $user);
        if ($msg['sender_id'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizí zprávu nemůžeš smazat.');
        }
        if ($msg['deleted_at'] === null) {
            Db::transaction(static function () use ($msg): void {
                Db::exec("UPDATE messages SET body = '', deleted_at = UTC_TIMESTAMP() WHERE id = ?", [$msg['id']]);
                Db::exec('DELETE FROM message_reactions WHERE message_id = ?', [$msg['id']]);
            });
        }
        return ['message' => self::oneMessage((int) $msg['id'], (string) $msg['campaign_id'], $user['id'])];
    }

    /**
     * Vlákno a příjemci pro 'all' nebo seznam členů (bez jazyků). Hráč smí soukromě psát jen DM, DM jednomu hráči (dm:<id>) nebo víc hráčům (secret).
     * @return array{0: string, 1: list<string>}
     */
    private static function resolveTarget(string $role, string $userId, string $campaignId, mixed $to): array
    {
        if ($to === 'all') {
            return ['group', []];
        }
        if (!is_array($to) || $to === [] || count($to) > 50) {
            throw HttpError::validation("Zadej příjemce: 'all' nebo seznam členů kampaně.", 'to');
        }
        $recipientIds = [];
        foreach ($to as $id) {
            if (!is_string($id) || !Ids::isUuid($id)) {
                throw HttpError::validation('Neplatný příjemce.', 'to');
            }
            $recipientIds[] = $id;
        }
        $recipientIds = array_values(array_unique($recipientIds));

        if ($role !== 'dm') {
            // Hráč smí soukromě psát jen DM (a jen jednomu).
            if (count($recipientIds) !== 1 || Access::role($recipientIds[0], $campaignId) !== 'dm') {
                throw HttpError::forbidden('Hráč může soukromě psát jen DM.');
            }
            return ['dm:' . $userId, $recipientIds];
        }
        foreach ($recipientIds as $id) {
            if ($id === $userId) {
                throw HttpError::validation('Sám sobě psát nemusíš.', 'to');
            }
            if (Access::role($id, $campaignId) !== 'player') {
                throw HttpError::validation('Příjemce musí být hráč z této kampaně.', 'to');
            }
        }
        return [count($recipientIds) === 1 ? 'dm:' . $recipientIds[0] : 'secret', $recipientIds];
    }

    /**
     * Uloží zprávu a příjemce (v transakci) a vrátí ji ve tvaru API. Jediné místo, kde zpráva vzniká (běžné odeslání i odeslání konceptu).
     * @param list<string> $recipientIds
     * @return array<string, mixed>
     */
    private static function deliver(string $campaignId, string $senderId, string $thread, string $body, array $recipientIds, ?int $replyTo = null): array
    {
        $id = Db::transaction(static function () use ($campaignId, $senderId, $thread, $body, $recipientIds, $replyTo): int {
            Db::exec(
                'INSERT INTO messages (campaign_id, sender_id, thread, body, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())',
                [$campaignId, $senderId, $thread, $body, $replyTo],
            );
            $id = (int) Db::pdo()->lastInsertId();
            foreach ($recipientIds as $rid) {
                Db::exec('INSERT INTO message_recipients (message_id, user_id) VALUES (?, ?)', [$id, $rid]);
            }
            return $id;
        });

        $row = Db::one(
            'SELECT m.id, m.sender_id, m.thread, m.body, m.created_at, m.reply_to_id, m.edited_at, m.deleted_at, u.display_name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?',
            [$id],
        ) ?? [];
        self::pushNew($campaignId, $senderId, $thread, $body, (string) ($row['sender_name'] ?? ''), $recipientIds);
        return self::payloads([$row], $campaignId, $senderId)[0];
    }

    /**
     * Push o nové zprávě těm, kdo ji vidí (skupina: všichni členové kromě odesílatele; jinak adresáti).
     * Text se na zamčené obrazovce ukáže jen u běžných vláken; tajné zprávy a zprávy v jazyce jen oznámí, že přišly.
     * @param list<string> $recipientIds
     */
    private static function pushNew(string $campaignId, string $senderId, string $thread, string $body, string $senderName, array $recipientIds): void
    {
        if ($thread === 'group') {
            $to = array_map(static fn (array $r): string => (string) $r['user_id'], Db::all('SELECT user_id FROM campaign_members WHERE campaign_id = ? AND user_id <> ?', [$campaignId, $senderId]));
        } else {
            $to = array_values(array_filter($recipientIds, static fn (string $id): bool => $id !== $senderId));
        }
        if ($thread === 'secret') {
            $text = 'Nová tajná zpráva od ' . $senderName;
        } elseif (str_starts_with($thread, 'lang:')) {
            $text = 'Nová zpráva v cizím jazyce od ' . $senderName;
        } else {
            $text = $senderName . ': ' . $body;
        }
        Push::queue($to, 'messages', $campaignId, $text, 'campaigns/' . $campaignId . '/messages', 'msg-' . $campaignId . '-' . $thread);
    }

    // ------------------------------------------------------------------ připravené zprávy DM (koncepty)

    private const MAX_DRAFTS = 100;

    /** Koncepty, které si DM nachystal (vidí je jen jejich autor). @param array{id:string} $user */
    public static function drafts(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $rows = Db::all(
            'SELECT * FROM message_drafts WHERE campaign_id = ? AND author_id = ? ORDER BY (sent_at IS NOT NULL), updated_at DESC, created_at DESC',
            [$params['id'], $user['id']],
        );
        return ['drafts' => self::draftPayloads($rows, $params['id'])];
    }

    /** @param array{id:string} $user */
    public static function createDraft(Request $req, array $params, array $user): Response
    {
        Access::requireDm($user, $params['id']);
        $data = $req->json();
        $body = Input::string($data, 'body', 1, self::MAX_BODY, 'Zpráva');
        $title = Input::optionalString($data, 'title', 80, 'Název') ?? '';
        [$thread, $recipientIds] = self::resolveTarget('dm', $user['id'], $params['id'], $data['to'] ?? null);
        if ((int) Db::value('SELECT COUNT(*) FROM message_drafts WHERE campaign_id = ? AND author_id = ?', [$params['id'], $user['id']]) >= self::MAX_DRAFTS) {
            throw HttpError::validation('Připravených zpráv je moc (nejvýš ' . self::MAX_DRAFTS . '). Smaž nějakou.');
        }

        $id = Ids::uuid();
        Db::transaction(static function () use ($id, $params, $user, $title, $body, $thread, $recipientIds): void {
            Db::exec(
                'INSERT INTO message_drafts (id, campaign_id, author_id, title, body, to_all, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                [$id, $params['id'], $user['id'], $title, $body, $thread === 'group' ? 1 : 0],
            );
            foreach ($recipientIds as $rid) {
                Db::exec('INSERT INTO message_draft_recipients (draft_id, user_id) VALUES (?, ?)', [$id, $rid]);
            }
        });
        return Response::json(['draft' => self::draftPayloads([self::loadDraft($id, $user)], $params['id'])[0]], 201);
    }

    /** Změna textu, názvu nebo příjemců; po změně je koncept zase „neodeslaný“. @param array{id:string} $user */
    public static function updateDraft(Request $req, array $params, array $user): array
    {
        $draft = self::loadDraft($params['id'], $user);
        $cid = (string) $draft['campaign_id'];
        $data = $req->json();
        $sets = [];
        $args = [];
        if (array_key_exists('body', $data)) {
            $sets[] = 'body = ?';
            $args[] = Input::string($data, 'body', 1, self::MAX_BODY, 'Zpráva');
        }
        if (array_key_exists('title', $data)) {
            $sets[] = 'title = ?';
            $args[] = Input::optionalString($data, 'title', 80, 'Název') ?? '';
        }
        $recipientIds = null;
        if (array_key_exists('to', $data)) {
            [$thread, $recipientIds] = self::resolveTarget('dm', $user['id'], $cid, $data['to']);
            $sets[] = 'to_all = ?';
            $args[] = $thread === 'group' ? 1 : 0;
        }
        if ($sets === []) {
            throw HttpError::validation('Není co změnit.');
        }
        $id = $params['id'];
        Db::transaction(static function () use ($id, $sets, $args, $recipientIds): void {
            Db::exec('UPDATE message_drafts SET ' . implode(', ', $sets) . ', sent_at = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?', [...$args, $id]);
            if ($recipientIds !== null) {
                Db::exec('DELETE FROM message_draft_recipients WHERE draft_id = ?', [$id]);
                foreach ($recipientIds as $rid) {
                    Db::exec('INSERT INTO message_draft_recipients (draft_id, user_id) VALUES (?, ?)', [$id, $rid]);
                }
            }
        });
        return ['draft' => self::draftPayloads([self::loadDraft($id, $user)], $cid)[0]];
    }

    /** @param array{id:string} $user */
    public static function deleteDraft(Request $req, array $params, array $user): Response
    {
        self::loadDraft($params['id'], $user);
        Db::exec('DELETE FROM message_drafts WHERE id = ?', [$params['id']]);
        return Response::noContent();
    }

    /**
     * Odešle koncept jako běžnou zprávu (skupině, jednomu hráči nebo víc hráčům naráz). Příjemci se ověřují znovu až teď:
     * kdo mezitím z kampaně odešel, zprávu nedostane, a když nezbyde nikdo, odeslání se odmítne.
     * @param array{id:string} $user
     */
    public static function sendDraft(Request $req, array $params, array $user): Response
    {
        $draft = self::loadDraft($params['id'], $user);
        $cid = (string) $draft['campaign_id'];
        RateLimiter::hit('message:' . $user['id'], 40, 60);

        if ((int) $draft['to_all'] === 1) {
            $thread = 'group';
            $recipientIds = [];
        } else {
            $recipientIds = array_values(array_map(
                static fn (array $r): string => (string) $r['user_id'],
                Db::all(
                    "SELECT dr.user_id FROM message_draft_recipients dr JOIN campaign_members cm ON cm.user_id = dr.user_id AND cm.campaign_id = ? AND cm.role = 'player' WHERE dr.draft_id = ?",
                    [$cid, $draft['id']],
                ),
            ));
            if ($recipientIds === []) {
                throw HttpError::validation('Příjemci už nejsou v kampani. Vyber nové.', 'to');
            }
            $thread = count($recipientIds) === 1 ? 'dm:' . $recipientIds[0] : 'secret';
        }

        $message = self::deliver($cid, $user['id'], $thread, (string) $draft['body'], $recipientIds);
        Db::exec('UPDATE message_drafts SET sent_at = UTC_TIMESTAMP() WHERE id = ?', [$draft['id']]);
        return Response::json(['message' => $message, 'draft' => self::draftPayloads([self::loadDraft((string) $draft['id'], $user)], $cid)[0]], 201);
    }

    /**
     * Koncept smí vidět a měnit jen jeho autor, který je v kampani pořád DM; ostatním (i jinému DM téže kampaně) je 404.
     * @param array{id:string} $user
     * @return array<string, mixed>
     */
    private static function loadDraft(string $id, array $user): array
    {
        $draft = Ids::isUuid($id) ? Db::one('SELECT * FROM message_drafts WHERE id = ?', [$id]) : null;
        if ($draft === null || $draft['author_id'] !== $user['id'] || Access::role($user['id'], (string) $draft['campaign_id']) !== 'dm') {
            throw HttpError::notFound('Připravená zpráva nenalezena.');
        }
        return $draft;
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function draftPayloads(array $rows, string $campaignId): array
    {
        $recipients = [];
        if ($rows !== []) {
            $ids = array_map(static fn (array $r): string => (string) $r['id'], $rows);
            $in = implode(',', array_fill(0, count($ids), '?'));
            // jen hráči, kteří v kampani pořád jsou
            foreach (Db::all(
                "SELECT dr.draft_id, u.id, u.display_name FROM message_draft_recipients dr
                 JOIN campaign_members cm ON cm.user_id = dr.user_id AND cm.campaign_id = ? AND cm.role = 'player'
                 JOIN users u ON u.id = dr.user_id WHERE dr.draft_id IN ($in) ORDER BY u.display_name",
                [$campaignId, ...$ids],
            ) as $r) {
                $recipients[(string) $r['draft_id']][] = ['id' => $r['id'], 'name' => $r['display_name']];
            }
        }
        return array_map(static fn (array $r): array => [
            'id' => $r['id'],
            'title' => $r['title'],
            'body' => $r['body'],
            'toAll' => (int) $r['to_all'] === 1,
            'recipients' => $recipients[(string) $r['id']] ?? [],
            'sentAt' => $r['sent_at'] === null ? null : Ids::iso((string) $r['sent_at']),
            'createdAt' => Ids::iso((string) $r['created_at']),
            'updatedAt' => Ids::iso((string) $r['updated_at']),
        ], $rows);
    }

    /** Označí vlákno jako přečtené po poslední zprávu, kterou uživatel vidí (klient číslo neposílá, server si ho spočítá sám). @param array{id:string} $user */
    public static function markRead(Request $req, array $params, array $user): array
    {
        Access::requireMember($user, $params['id']);
        $thread = $req->json()['thread'] ?? null;
        if (!is_string($thread) || preg_match('/^(group|secret|dm:[0-9a-f-]{36}|lang:[\p{L}\p{N}-]{1,40})$/u', $thread) !== 1) {
            throw HttpError::validation('Neplatné vlákno.', 'thread');
        }
        $max = Db::value(
            'SELECT MAX(m.id) FROM messages m WHERE m.campaign_id = ? AND m.thread = ? AND ' . self::visibleSql(),
            [$params['id'], $thread, ...self::visibleArgs($user['id'])],
        );
        if ($max !== null) {
            Db::exec(
                'INSERT INTO message_reads (campaign_id, user_id, thread, last_read_id) VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE last_read_id = GREATEST(last_read_id, VALUES(last_read_id))',
                [$params['id'], $user['id'], $thread, (int) $max],
            );
        }
        return ['unread' => self::unreadByThread($params['id'], $user['id'])];
    }

    /** Nepřečtené zprávy napříč všemi kampaněmi uživatele (pro odznak v hlavičce). @param array{id:string} $user */
    public static function unreadOverview(Request $req, array $params, array $user): array
    {
        $rows = Db::all(
            'SELECT m.campaign_id, c.name, COUNT(*) AS n
             FROM messages m
             JOIN campaign_members cm ON cm.campaign_id = m.campaign_id AND cm.user_id = ?
             JOIN campaigns c ON c.id = m.campaign_id
             LEFT JOIN message_reads rd ON rd.campaign_id = m.campaign_id AND rd.user_id = ? AND rd.thread = m.thread
             WHERE m.sender_id <> ? AND m.deleted_at IS NULL AND m.id > COALESCE(rd.last_read_id, 0) AND ' . self::visibleSql() . '
             GROUP BY m.campaign_id, c.name ORDER BY c.name',
            [$user['id'], $user['id'], $user['id'], ...self::visibleArgs($user['id'])],
        );
        $campaigns = array_map(static fn (array $r): array => ['campaignId' => $r['campaign_id'], 'name' => $r['name'], 'unread' => (int) $r['n']], $rows);
        return ['total' => array_sum(array_column($campaigns, 'unread')), 'campaigns' => $campaigns];
    }

    // ------------------------------------------------------------------ pomocné

    /**
     * Cíl zprávy v jazyce: vlákno a příjemci (ostatní hráči, kteří jazyk umí, a DM). Píše jen hráč, který jazyk sám umí.
     * @return array{0: string, 1: list<string>}
     */
    private static function languageTarget(string $role, string $userId, string $campaignId, mixed $language): array
    {
        if ($role !== 'player') {
            throw HttpError::forbidden('Zprávy v jazyce píšou jen hráči.');
        }
        // Jazyk se bere přes číselník: „Skřetština“, „skretstina“ i „Orc“ je totéž.
        $slug = is_string($language) ? Languages::slug(Languages::canonical($language) ?? $language) : '';
        if ($slug === '') {
            throw HttpError::validation('Zadej jazyk.', 'to');
        }
        $all = Languages::byPlayer($campaignId);
        if (!isset($all[$userId][$slug])) {
            throw HttpError::forbidden('Tento jazyk tvoje postava neumí.');
        }
        $recipients = [];
        foreach ($all as $uid => $langs) {
            if ($uid !== $userId && isset($langs[$slug])) {
                $recipients[] = (string) $uid;
            }
        }
        if ($recipients === []) {
            throw HttpError::validation('Tento jazyk neumí žádný další hráč.', 'to');
        }
        // DM zprávu čte (jako příjemce), i když jazyk nezná; psát v jazyce nemůže. Starší zprávy bez DM v příjemcích mu zůstanou skryté.
        foreach (Db::all("SELECT user_id FROM campaign_members WHERE campaign_id = ? AND role = 'dm'", [$campaignId]) as $r) {
            $recipients[] = (string) $r['user_id'];
        }
        return ['lang:' . $slug, $recipients];
    }

    /**
     * Jazyky, které uživatel umí, a ostatní hráči, se kterými je sdílí (jen takové jazyky jde použít k psaní).
     * @return list<array{slug: string, name: string, speakers: list<array{id: string, name: string}>}>
     */
    private static function myLanguages(string $campaignId, string $userId): array
    {
        $all = Languages::byPlayer($campaignId);
        $mine = $all[$userId] ?? [];
        if ($mine === []) {
            return [];
        }
        $names = [];
        foreach (Db::all('SELECT user_id, display_name FROM campaign_members m JOIN users u ON u.id = m.user_id WHERE m.campaign_id = ?', [$campaignId]) as $r) {
            $names[(string) $r['user_id']] = (string) $r['display_name'];
        }
        $out = [];
        foreach ($mine as $slug => $name) {
            $speakers = [];
            foreach ($all as $uid => $langs) {
                if ($uid !== $userId && isset($langs[$slug])) {
                    $speakers[] = ['id' => (string) $uid, 'name' => $names[(string) $uid] ?? '?'];
                }
            }
            $out[] = ['slug' => (string) $slug, 'name' => $name, 'speakers' => $speakers];
        }
        return $out;
    }

    /** @return array<string, int> počet nepřečtených zpráv (cizích) po vláknech */
    private static function unreadByThread(string $campaignId, string $userId): array
    {
        $rows = Db::all(
            'SELECT m.thread, COUNT(*) AS n
             FROM messages m
             LEFT JOIN message_reads rd ON rd.campaign_id = m.campaign_id AND rd.user_id = ? AND rd.thread = m.thread
             WHERE m.campaign_id = ? AND m.sender_id <> ? AND m.deleted_at IS NULL AND m.id > COALESCE(rd.last_read_id, 0) AND ' . self::visibleSql() . '
             GROUP BY m.thread',
            [$userId, $campaignId, $userId, ...self::visibleArgs($userId)],
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r['thread']] = (int) $r['n'];
        }
        return $out;
    }

    /**
     * Zprávy ve tvaru API: příjemci, reakce a odkaz na zprávu, na kterou navazují. Odkaz ukáže text původní zprávy jen tomu,
     * kdo ji sám vidí (v tajném vlákně nebo v jazyce se příjemci mezi zprávami liší, text se tím nesmí prozradit).
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function payloads(array $rows, string $campaignId, string $userId): array
    {
        if ($rows === []) {
            return [];
        }
        $ids = array_map(static fn (array $r): int => (int) $r['id'], $rows);
        $in = implode(',', array_fill(0, count($ids), '?'));
        $recipients = [];
        foreach (Db::all("SELECT r.message_id, u.id, u.display_name FROM message_recipients r JOIN users u ON u.id = r.user_id WHERE r.message_id IN ($in) ORDER BY u.display_name", $ids) as $r) {
            $recipients[(int) $r['message_id']][] = ['id' => $r['id'], 'name' => $r['display_name']];
        }
        $reactions = self::reactionsOf($ids);

        $replyIds = array_values(array_unique(array_map(static fn (array $r): int => (int) $r['reply_to_id'], array_filter($rows, static fn (array $r): bool => $r['reply_to_id'] !== null))));
        $originals = [];
        if ($replyIds !== []) {
            $rin = implode(',', array_fill(0, count($replyIds), '?'));
            foreach (Db::all(
                "SELECT m.id, m.body, m.deleted_at, u.display_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id IN ($rin) AND m.campaign_id = ? AND " . self::visibleSql(),
                [...$replyIds, $campaignId, ...self::visibleArgs($userId)],
            ) as $o) {
                $originals[(int) $o['id']] = $o;
            }
        }

        return array_map(static function (array $r) use ($recipients, $reactions, $originals): array {
            $id = (int) $r['id'];
            $replyTo = null;
            if ($r['reply_to_id'] !== null) {
                $o = $originals[(int) $r['reply_to_id']] ?? null;
                $replyTo = $o === null
                    ? ['id' => (int) $r['reply_to_id'], 'senderName' => '', 'snippet' => '', 'deleted' => false, 'hidden' => true]
                    : [
                        'id' => (int) $o['id'],
                        'senderName' => $o['display_name'],
                        'snippet' => $o['deleted_at'] === null ? mb_substr(trim((string) preg_replace('/\s+/u', ' ', (string) $o['body'])), 0, 140) : '',
                        'deleted' => $o['deleted_at'] !== null,
                        'hidden' => false,
                    ];
            }
            return [
                'id' => $id,
                'senderId' => $r['sender_id'],
                'senderName' => $r['sender_name'],
                'thread' => $r['thread'],
                'recipients' => $recipients[$id] ?? [],
                'body' => $r['body'],
                'createdAt' => Ids::iso((string) $r['created_at']),
                'editedAt' => $r['edited_at'] === null ? null : Ids::iso((string) $r['edited_at']),
                'deletedAt' => $r['deleted_at'] === null ? null : Ids::iso((string) $r['deleted_at']),
                'replyTo' => $replyTo,
                'reactions' => $reactions[$id] ?? [],
            ];
        }, $rows);
    }

    /**
     * Reakce zpráv: u každého emoji kdo reagoval (v pořadí, jak se emoji objevila).
     * @param list<int> $ids
     * @return array<int, list<array{emoji: string, users: list<array{id: string, name: string}>}>>
     */
    private static function reactionsOf(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $by = [];
        foreach (Db::all(
            "SELECT x.message_id, x.emoji, u.id, u.display_name FROM message_reactions x JOIN users u ON u.id = x.user_id WHERE x.message_id IN ($in) ORDER BY x.created_at, u.display_name",
            $ids,
        ) as $r) {
            $by[(int) $r['message_id']][(string) $r['emoji']][] = ['id' => $r['id'], 'name' => $r['display_name']];
        }
        $out = [];
        foreach ($by as $mid => $emojis) {
            foreach ($emojis as $emoji => $users) {
                $out[$mid][] = ['emoji' => (string) $emoji, 'users' => $users];
            }
        }
        return $out;
    }
}

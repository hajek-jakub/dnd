<?php

declare(strict_types=1);

namespace Dnd;

final class Router
{
    /** @var list<array{method:string,regex:string,keys:list<string>,handler:callable,auth:bool}> */
    private array $routes = [];

    /** @param callable $handler function (Request $req, array $params, ?array $user): Response|array|null */
    public function add(string $method, string $pattern, callable $handler, bool $auth = true): void
    {
        $keys = [];
        $regex = preg_replace_callback(
            '#\{([a-zA-Z]+)\}#',
            static function (array $m) use (&$keys): string {
                $keys[] = $m[1];
                return '([^/]+)';
            },
            $pattern,
        );
        $this->routes[] = [
            'method' => $method,
            'regex' => '#^' . $regex . '$#',
            'keys' => $keys,
            'handler' => $handler,
            'auth' => $auth,
        ];
    }

    public function dispatch(Request $request): Response
    {
        $pathMatched = false;
        foreach ($this->routes as $route) {
            if (preg_match($route['regex'], $request->path, $m) !== 1) {
                continue;
            }
            $pathMatched = true;
            if ($route['method'] !== $request->method) {
                continue;
            }

            $params = [];
            foreach ($route['keys'] as $i => $key) {
                $params[$key] = $m[$i + 1];
            }

            self::checkOrigin($request);

            $user = $route['auth'] ? Auth::requireUser($request) : null;
            $result = ($route['handler'])($request, $params, $user);

            if ($result instanceof Response) {
                return $result;
            }
            return $result === null ? Response::noContent() : Response::json($result);
        }

        if ($pathMatched) {
            throw new HttpError(405, 'method_not_allowed', 'Metoda není povolená.');
        }
        throw HttpError::notFound('Tato adresa API neexistuje.');
    }

    /**
     * Ochrana proti CSRF: požadavky měnící data musí přijít ze stejného originu jako API.
     * (Spolu s cookie SameSite=Lax. Požadavky bez hlavičky Origin nejsou z prohlížeče.)
     */
    private static function checkOrigin(Request $request): void
    {
        if (in_array($request->method, ['GET', 'HEAD', 'OPTIONS'], true)) {
            return;
        }
        $origin = $request->header('origin');
        if ($origin === null || $origin === '') {
            return;
        }
        $originHost = parse_url($origin, PHP_URL_HOST);
        $originPort = parse_url($origin, PHP_URL_PORT);
        $host = (string) $request->header('host');
        $expected = $originPort !== null && $originPort !== false ? $originHost . ':' . $originPort : (string) $originHost;
        if (!is_string($originHost) || strcasecmp($expected, $host) !== 0) {
            throw HttpError::forbidden('Požadavek z cizího webu byl zamítnut.');
        }
    }
}

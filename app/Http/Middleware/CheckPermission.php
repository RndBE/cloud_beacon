<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckPermission
{
    public function handle(Request $request, Closure $next, string ...$permissions): Response
    {
        $user = $request->user();

        if (!$user) {
            abort(403, 'Unauthorized.');
        }

        // Superadmin bypasses all permission checks
        if ($user->isSuperAdmin()) {
            return $next($request);
        }

        // Load roles with permissions if not already loaded
        if (!$user->relationLoaded('roles')) {
            $user->load('roles.permissions');
        }

        foreach ($permissions as $permission) {
            if ($user->hasPermission($permission)) {
                return $next($request);
            }
        }

        abort(403, 'You do not have permission to perform this action.');
    }
}

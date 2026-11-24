<?php

namespace App\Providers;

use App\Services\ModeProfiles\DbModeProfileCatalog;
use App\Services\ModeProfiles\ModeProfileCatalog;
use Carbon\CarbonImmutable;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Profiles are editable from Production now. HardcodedModeProfileCatalog stays as the seed
        // source for the mode_profiles migration and as the baseline the parity test checks against.
        $this->app->bind(ModeProfileCatalog::class, DbModeProfileCatalog::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureDefaults();

        // Satu gateway (gomqtt) mendorong semua logger dari satu IP, jadi kuota per-IP membuat
        // logger berebut dan yang kalah kena 429 (gomqtt tak retry → data hilang).
        // Kuota utama per id_alat; batas per-IP hanya jaring pengaman untuk banjir id acak.
        RateLimiter::for('device-push', fn (Request $request) => [
            Limit::perMinute(300)->by('push-id|'.$request->input('id_alat', $request->ip())),
            Limit::perMinute(2000)->by('push-ip|'.$request->ip()),
        ]);
    }

    /**
     * Configure default behaviors for production-ready applications.
     */
    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        Password::defaults(fn (): ?Password => app()->isProduction()
            ? Password::min(8)
                ->mixedCase()
                ->letters()
                ->numbers()
                ->symbols()
                ->uncompromised()
            : null,
        );
    }
}

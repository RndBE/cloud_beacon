<?php

namespace App\Services\Mobile;

use App\Models\ActivityLog;
use App\Models\Logger;
use App\Models\Project;
use App\Models\Sensor;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class MobileLoggerQueryService
{
    public function scopedLoggers(User $user): Builder
    {
        $query = Logger::query();

        if (! $user->isSuperAdmin()) {
            $query->where('user_id', $user->id);
        }

        return $query;
    }

    public function home(User $user): array
    {
        $loggers = $this->scopedLoggers($user)
            ->with(['project', 'deviceModel'])
            ->withCount('externalSensors')
            ->get();
        $loggerIds = $loggers->pluck('id');
        $sensorQuery = $this->externalSensorQuery($loggerIds);

        $recentActivity = ActivityLog::with('logger:id,name')
            ->whereIn('logger_id', $loggerIds)
            ->latest('created_at')
            ->limit(10)
            ->get();

        return [
            'stats' => [
                'totalLoggers' => $loggers->count(),
                'onlineLoggers' => $loggers->where('status', 'online')->count(),
                'offlineLoggers' => $loggers->where('status', 'offline')->count(),
                'warningLoggers' => $loggers->where('status', 'warning')->count(),
                'totalSensors' => (clone $sensorQuery)->count(),
                'activeSensors' => (clone $sensorQuery)->where('status', 'active')->count(),
            ],
            'recentActivity' => $recentActivity,
            'issues' => $this->issueList($loggers),
        ];
    }

    public function paginatedLoggers(User $user, array $filters): LengthAwarePaginator
    {
        $query = $this->scopedLoggers($user)
            ->with(['project', 'deviceModel'])
            ->withCount('externalSensors');

        if (! empty($filters['search'])) {
            $search = $filters['search'];
            $query->where(function (Builder $query) use ($search): void {
                $query->where('name', 'like', '%'.$search.'%')
                    ->orWhere('serial_number', 'like', '%'.$search.'%')
                    ->orWhere('device_identifier', 'like', '%'.$search.'%')
                    ->orWhere('location', 'like', '%'.$search.'%');
            });
        }

        if (! empty($filters['status']) && $filters['status'] !== 'all') {
            $query->where('status', $filters['status']);
        }

        if (($filters['project_id'] ?? null) !== null && $filters['project_id'] !== '' && $filters['project_id'] !== 'all') {
            if ($filters['project_id'] === 'none') {
                $query->whereNull('project_id');
            } else {
                $query->where('project_id', $filters['project_id']);
            }
        }

        return $query->orderBy('name')->paginate(15);
    }

    public function loggerDetail(User $user, int $loggerId): Logger
    {
        return $this->scopedLoggers($user)
            ->with([
                'project',
                'deviceModel',
                'externalSensors',
                'integrations',
                'activityLogs' => fn ($query) => $query->latest('created_at')->limit(20),
            ])
            ->withCount('externalSensors')
            ->findOrFail($loggerId);
    }

    public function topology(User $user): Collection
    {
        $loggers = $this->scopedLoggers($user)
            ->with(['project', 'deviceModel', 'externalSensors'])
            ->withCount('externalSensors')
            ->orderBy('name')
            ->get();

        $projectIds = $loggers->pluck('project_id')->filter()->unique()->values();
        $projects = Project::whereIn('id', $projectIds)
            ->orderBy('name')
            ->get()
            ->map(fn (Project $project) => [
                'id' => $project->id,
                'name' => $project->name,
                'color' => $project->color,
                'loggers' => $loggers->where('project_id', $project->id)->values(),
            ]);

        $withoutProject = $loggers->whereNull('project_id')->values();
        if ($withoutProject->isNotEmpty()) {
            $projects->push([
                'id' => 0,
                'name' => 'No Project',
                'color' => '#64748B',
                'loggers' => $withoutProject,
            ]);
        }

        return $projects->values();
    }

    private function externalSensorQuery(Collection $loggerIds): Builder
    {
        return Sensor::whereIn('logger_id', $loggerIds)
            ->where(function (Builder $query): void {
                $query->whereNotNull('connection_type')
                    ->orWhereNotIn('type', Logger::BUILTIN_SENSOR_TYPES);
            });
    }

    private function issueList(Collection $loggers): Collection
    {
        $priority = [
            'offline' => 0,
            'warning' => 1,
        ];

        return $loggers
            ->filter(fn (Logger $logger) => in_array($logger->status, ['offline', 'warning'], true) || $logger->last_sync_status === 'error')
            ->sortBy(fn (Logger $logger) => $priority[$logger->status] ?? 2)
            ->take(10)
            ->map(fn (Logger $logger) => [
                'loggerId' => $logger->id,
                'loggerName' => $logger->name,
                'status' => $logger->status,
                'message' => $logger->last_sync_error ?: $this->defaultIssueMessage($logger),
                'lastSeen' => $logger->last_seen_at?->format('Y-m-d H:i:s'),
            ])
            ->values();
    }

    private function defaultIssueMessage(Logger $logger): string
    {
        return match ($logger->status) {
            'offline' => 'Logger is offline.',
            'warning' => 'Logger requires attention.',
            default => 'Last synchronization failed.',
        };
    }
}

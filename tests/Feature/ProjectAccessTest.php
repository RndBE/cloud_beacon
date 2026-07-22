<?php

use App\Models\Logger;
use App\Models\Project;
use App\Models\User;

function createProjectFor(User $owner, string $name): Project
{
    return Project::create([
        'user_id' => $owner->id,
        'name' => $name,
        'code' => strtolower(str_replace(' ', '-', $name)),
        'description' => null,
        'color' => '#3b82f6',
    ]);
}

test('project access can expose every logger in the project', function () {
    $owner = User::factory()->create();
    $viewer = User::factory()->create();
    $project = createProjectFor($owner, 'Project A');

    $firstLogger = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
    ]);
    $secondLogger = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
    ]);
    $outsideLogger = Logger::factory()->create(['user_id' => $owner->id]);

    $viewer->assignedProjects()->attach($project->id, [
        'access_level' => Logger::ACCESS_VIEW,
        'logger_scope' => Project::LOGGER_SCOPE_ALL,
    ]);

    $visibleIds = Logger::query()
        ->visibleTo($viewer)
        ->pluck('id')
        ->all();

    expect($visibleIds)->toContain($firstLogger->id)
        ->and($visibleIds)->toContain($secondLogger->id)
        ->and($visibleIds)->not->toContain($outsideLogger->id);
});

test('project access can be narrowed to selected loggers', function () {
    $owner = User::factory()->create();
    $viewer = User::factory()->create();
    $project = createProjectFor($owner, 'Project B');

    $allowedLogger = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
    ]);
    $blockedLogger = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
    ]);

    $viewer->assignedProjects()->attach($project->id, [
        'access_level' => Logger::ACCESS_VIEW,
        'logger_scope' => Project::LOGGER_SCOPE_SELECTED,
    ]);
    $viewer->assignedLoggers()->attach($allowedLogger->id, [
        'access_level' => Logger::ACCESS_VIEW,
    ]);

    $visibleIds = Logger::query()
        ->visibleTo($viewer)
        ->pluck('id')
        ->all();

    expect($visibleIds)->toContain($allowedLogger->id)
        ->and($visibleIds)->not->toContain($blockedLogger->id);
});

test('manageable project access exposes all project loggers for management', function () {
    $owner = User::factory()->create();
    $manager = User::factory()->create();
    $project = createProjectFor($owner, 'Project C');

    $logger = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
    ]);

    $manager->assignedProjects()->attach($project->id, [
        'access_level' => Logger::ACCESS_MANAGE,
        'logger_scope' => Project::LOGGER_SCOPE_ALL,
    ]);

    expect(Logger::query()->manageableBy($manager)->pluck('id')->all())
        ->toContain($logger->id);

    expect($logger->isManageableBy($manager))->toBeTrue();
});

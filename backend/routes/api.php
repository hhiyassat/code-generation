<?php

use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\ApplicationController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\GsbController;
use App\Http\Controllers\Api\IntegrationController;
use App\Http\Controllers\Api\ServiceCatalogController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| ESP v2 API Routes
|--------------------------------------------------------------------------
|
| SEC-009: Rate limiting applied at route level.
| SEC-005: CheckRole middleware enforced on all protected routes.
| BUILD CONTRACT: Middleware stack wired before all routes.
|
| All routes versioned under /v1/ (§10.2 API versioning).
|
*/

// ── Nashmi Integration routes (NO Sanctum — validated by X-Integration-Key) ─
// IMPORTANT: registered BEFORE the v1 group so Sanctum never intercepts them.

Route::prefix('integration')
    ->middleware(['integration.key', 'throttle:60,1'])
    ->group(function () {
        // Inbound from Nashmi
        Route::post('receive-requirements',             [IntegrationController::class, 'receiveRequirements']);
        Route::post('receive-feedback',                 [IntegrationController::class, 'receiveFeedback']);

        // Outbound trigger (admin calls this after code is done)
        Route::post('cycles/{id}/notify-done',          [IntegrationController::class, 'notifyCodeDone']);

        // Cycle management (read-only from Nashmi side)
        Route::get('cycles',                            [IntegrationController::class, 'cycles']);
        Route::get('cycles/{id}',                       [IntegrationController::class, 'cycle']);
        Route::get('cycles/{id}/pdf',                   [IntegrationController::class, 'downloadPdf']);
    });

// ── Public routes (no auth) ─────────────────────────────────────────

Route::prefix('v1')->group(function () {

    // SEC-009: Strict rate limit on login
    Route::post('auth/login',    [AuthController::class, 'login'])->middleware('throttle:5,1');
    Route::post('auth/register', [AuthController::class, 'register'])->middleware('throttle:10,1');

    // FR-013: Public certificate verification
    Route::get('certificates/verify/{certNumber}', [ApplicationController::class, 'verifyCertificate']);

});

// ── Authenticated routes ────────────────────────────────────────────

Route::prefix('v1')->middleware(['auth:sanctum', 'token.inactivity', 'password.policy'])->group(function () {

    // Auth
    Route::get('auth/me',                  [AuthController::class, 'me']);
    Route::post('auth/logout',             [AuthController::class, 'logout']);
    Route::post('auth/password/change',    [AuthController::class, 'changePassword']);

    // ── Applicant routes ──────────────────────────────────────────────

    Route::middleware('role:applicant,staff,auditor,admin')->group(function () {
        // FR-001: Service catalog
        Route::get('services',         [ServiceCatalogController::class, 'index']);
        Route::get('services/{code}',  [ServiceCatalogController::class, 'show']);

        // FR-002 to FR-007: Application CRUD
        Route::get('applications',                            [ApplicationController::class, 'index']);
        Route::post('applications',                           [ApplicationController::class, 'store']);
        Route::get('applications/{id}',                       [ApplicationController::class, 'show']);
        Route::put('applications/{id}',                       [ApplicationController::class, 'update']);
        Route::post('applications/{id}/submit',               [ApplicationController::class, 'submit']);
        Route::post('applications/{id}/documents',            [ApplicationController::class, 'uploadDocument']);
    });

    // ── Reviewer routes ───────────────────────────────────────────────

    Route::middleware('role:staff,auditor,admin')->group(function () {
        // FR-008 to FR-010: Review workflow
        Route::get('review/queue',                [ApplicationController::class, 'reviewQueue']);
        Route::post('applications/{id}/claim',    [ApplicationController::class, 'claim']);
        Route::post('applications/{id}/release',  [ApplicationController::class, 'release']);   
        Route::post('applications/{id}/decide',   [ApplicationController::class, 'decide']);
    });

    // ── Staff / Admin routes ──────────────────────────────────────────

    Route::middleware('role:staff,admin')->group(function () {
        // FR-011 to FR-012: Payment + certificate issuance
        Route::post('applications/{id}/confirm-payment',    [ApplicationController::class, 'confirmPayment']);
        Route::post('applications/{id}/issue-certificate',  [ApplicationController::class, 'issueCertificate']);
    });

    // ── Admin-only routes ─────────────────────────────────────────────

    Route::middleware('role:admin')->group(function () {
        // FR-014 to FR-016: Admin dashboard
        Route::get('admin/dashboard',             [AdminController::class, 'dashboard']);
        Route::get('admin/users',                 [AdminController::class, 'listUsers']);
        Route::post('admin/users',                [AdminController::class, 'createUser']);
        Route::put('admin/users/{id}',            [AdminController::class, 'updateUser']);
        Route::get('admin/applications',          [AdminController::class, 'allApplications']);
        Route::get('admin/audit-logs',            [AdminController::class, 'auditLogs']);

        // FR-017: Service management (all statuses for admin)
        Route::get('admin/services',                       [ServiceCatalogController::class, 'adminIndex']);
        Route::get('admin/services/{id}',                  [ServiceCatalogController::class, 'adminShow']);
        Route::post('services',                            [ServiceCatalogController::class, 'store']);
        Route::put('services/{id}',                        [ServiceCatalogController::class, 'update']);
        Route::patch('services/{id}/status',               [ServiceCatalogController::class, 'updateStatus']);

        // FR-018: AI schema generation (calls Claude API server-side)
        Route::post('admin/services/generate-schema',           [AdminController::class, 'generateSchema']);
        Route::post('admin/services/generate-schema-from-file', [AdminController::class, 'generateSchemaFromFile']);

        // FR-019: AI schema chat update — natural language edits to existing schema
        Route::post('admin/services/chat-schema',          [AdminController::class, 'chatUpdateSchema']);
    });

    // ── GSB (Government Service Bus) routes — MODEE Annex 4.15 ──────────
    //
    // gsb.ip_whitelist : §4.5 rule 11 — only authorized IPs may reach GSB routes
    // auth:sanctum     : §4.4.1 — authenticated session required
    // throttle         : §4.7  — rate limiting (100 req/min per IP)
    //
    // Note: gsb.ip_whitelist is applied INSIDE the outer auth:sanctum group so that
    // the Sanctum middleware still runs first; unauthenticated requests never reach
    // the IP check and get the standard 401 response instead of the GSB 403.

    Route::prefix('v1/gsb')
        ->middleware('gsb.ip_whitelist')
        ->group(function () {

            // §4.5.7 — Step 1: request OTP for citizen-data access
            Route::post('otp/request', [GsbController::class, 'requestOtp']);

            // §4.5.7 — Step 2: verify OTP; returns short-lived otp_token
            Route::post('otp/verify',  [GsbController::class, 'verifyOtp']);

            // §4.5.7 — Citizen data lookup (requires otp_token from step 2)
            Route::get('citizen',      [GsbController::class, 'citizenLookup']);

            // §4.9 — GSB call audit log viewer (admin-only enforcement inside controller)
            Route::get('audit-logs',   [GsbController::class, 'auditLogs']);
        });

});

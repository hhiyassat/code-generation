<?php

namespace App\Engine;

use App\Models\Application;
use App\Models\ApplicationReview;
use App\Models\AuditLog;
use App\Models\Certificate;
use App\Models\ServiceDefinition;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * WorkflowEngine — EDA-Compliant Generic State Machine
 *
 * ═══════════════════════════════════════════════════════════════════
 * METHODOLOGY: Eqratech Decision Assurance Methodology v1.1, Appendix B
 * ═══════════════════════════════════════════════════════════════════
 *
 * This engine is designed around the EDA decision chain from the beginning.
 * Every public method satisfies all 10 B-elements before mutating state.
 * The ALLOWED_TRANSITIONS constant is the single authority for the state machine.
 *
 * BUILD CONTRACT compliance:
 *   ✅ B-5: ALLOWED_TRANSITIONS is the single enforcement point
 *   ✅ B-9: AuditLog::record() called inside DB::transaction()
 *   ✅ WF-001: transitionTo() is the only status mutation point
 *   ✅ WF-002: Every mutation wrapped in DB::transaction()
 *   ✅ WF-003: Every mutation writes AuditLog with rule_id
 *   ✅ WF-004: claim() uses lockForUpdate()
 *   ✅ P-7: No auto-approvals — all decisions require human action
 */
class WorkflowEngine
{
    /**
     * WF-001 / B-5: Single authority for valid state transitions.
     *
     * This constant is the ONLY place where valid transitions are defined.
     * transitionTo() checks against this constant — nowhere else.
     */
    public const ALLOWED_TRANSITIONS = [
        Application::STATUS_DRAFT                   => [Application::STATUS_SUBMITTED],
        Application::STATUS_SUBMITTED               => [Application::STATUS_UNDER_REVIEW],
        Application::STATUS_UNDER_REVIEW            => [
            Application::STATUS_APPROVED,
            Application::STATUS_REJECTED,
            Application::STATUS_MODIFICATIONS_REQUESTED,
            Application::STATUS_SUBMITTED, // WF-011: reviewer releasing their claim
        ],
        Application::STATUS_MODIFICATIONS_REQUESTED => [Application::STATUS_SUBMITTED],
        Application::STATUS_APPROVED                => [Application::STATUS_CERTIFICATE_ISSUED],
        Application::STATUS_REJECTED                => [],
        Application::STATUS_CERTIFICATE_ISSUED      => [],
    ];

    public function __construct(private readonly ServiceDefinition $service) {}

    // ─────────────────────────────────────────────────────────────────
    // submit() — EDA Decision Chain: draft → submitted
    // ─────────────────────────────────────────────────────────────────

    /**
     * Submit an application for review.
     *
     * EDA Decision Chain:
     *   B-1 Origin:         The applicant who owns the draft
     *   B-2 Branch:         applicant role (enforced upstream in controller/middleware)
     *   B-3 Relationship:   Application belongs to this applicant (enforced in controller)
     *   B-4 Description:    All schema fields valid (SchemaValidator called before this)
     *   B-5 Difference:     draft → submitted in ALLOWED_TRANSITIONS
     *   B-6 Conditions:     Application is editable; all required documents uploaded
     *   B-7 Cause:          Explicit HTTP POST /applications/{id}/submit
     *   B-8 Blockers:       isEditable() check; terminal state guard
     *   B-9 Effect:         AuditLog::record() inside DB::transaction()
     *   B-10 Residuals:     Validation failure → 422 (handled in controller before calling this)
     *
     * @param Application $app    Already-validated application (controller called SchemaValidator)
     * @param User        $actor  The applicant
     */
    public function submit(Application $app, User $actor): Application
    {
        // B-8: Blocker check — must be editable
        if (! $app->isEditable()) {
            abort(422, 'Application cannot be submitted in its current state.');
        }

        $firstStage = $this->service->getFirstStage();
        $prevStatus = $app->status;

        DB::transaction(function () use ($app, $actor, $firstStage, $prevStatus) {
            // B-5 + WF-001: transition through ALLOWED_TRANSITIONS
            $this->transitionTo($app, Application::STATUS_SUBMITTED);

            $app->current_stage = $firstStage['id'] ?? null;

            // WF-008: set SLA deadline from schema
            if (isset($firstStage['sla_hours'])) {
                $app->sla_deadline = now()->addHours($firstStage['sla_hours']);
            }

            $app->save();

            // B-9 + WF-003: effect recorded
            AuditLog::record(
                user:    $actor,
                subject: $app,
                action:  'application.submitted',
                extra: [
                    'rule_id'        => 'ESP-WF-001',
                    'from_status'    => $prevStatus,
                    'to_status'      => Application::STATUS_SUBMITTED,
                    'input_snapshot' => $app->data ?? [],
                ],
            );
        });

        return $app->fresh();
    }

    // ─────────────────────────────────────────────────────────────────
    // claim() — EDA Decision Chain: submitted → under_review
    // ─────────────────────────────────────────────────────────────────

    /**
     * Claim an application for review.
     *
     * EDA Decision Chain:
     *   B-3 Relationship:   Reviewer's role must match current stage's required role
     *   B-5 Difference:     submitted → under_review in ALLOWED_TRANSITIONS
     *   B-6 Conditions:     Application not already claimed; status = submitted
     *   B-8 Blockers:       lockForUpdate() prevents race condition (WF-004)
     *   B-9 Effect:         AuditLog::record() inside DB::transaction()
     */
    public function claim(Application $app, User $actor): Application
    {
        // B-2/B-3: Role must match stage
        $stage = $this->service->getStage($app->current_stage ?? '');
        if ($stage && isset($stage['role']) && ! $actor->isAdmin()) {
            if (! $actor->hasRole($stage['role'])) {
                abort(403, "Stage '{$app->current_stage}' requires role '{$stage['role']}'.");
            }
        }

        $prevStatus = $app->status;

        DB::transaction(function () use ($app, $actor, $prevStatus) {
            // WF-004: lockForUpdate() prevents concurrent claims
            $locked = Application::lockForUpdate()->find($app->id);

            if ($locked->status !== Application::STATUS_SUBMITTED) {
                abort(409, 'Application is no longer available for claiming.');
            }

            if ($locked->assigned_reviewer_id !== null) {
                abort(409, 'Application has already been claimed by another reviewer.');
            }

            $this->transitionTo($locked, Application::STATUS_UNDER_REVIEW);
            $locked->assigned_reviewer_id = $actor->id;
            $locked->save();

            // B-9 + WF-003
            AuditLog::record(
                user:    $actor,
                subject: $locked,
                action:  'application.claimed',
                extra: [
                    'rule_id'     => 'ESP-WF-002',
                    'from_status' => $prevStatus,
                    'to_status'   => Application::STATUS_UNDER_REVIEW,
                ],
            );

            $app->fill($locked->toArray());
        });

        return $app->fresh();
    }
    // ─────────────────────────────────────────────────────────────────
    // release() — EDA Decision Chain: under_review → submitted
    // ─────────────────────────────────────────────────────────────────

        /**
     * Release a claimed application back to the unassigned pool.
     *
     * EDA Decision Chain:
     *   B-3 Relationship:   Only the assigned reviewer (or an admin) may release
     *   B-5 Difference:     under_review → submitted in ALLOWED_TRANSITIONS
     *   B-6 Conditions:     Application must currently be under_review
     *   B-8 Blockers:       lockForUpdate() prevents race condition (WF-004)
     *   B-9 Effect:         AuditLog::record() inside DB::transaction()
     */
    public function release(Application $app,User $actor):Application
    {
        $prevStatus = $app->status;
        DB::transaction(function() use ($app,$actor,$prevStatus){
            // WF-004: lockForUpdate() prevents concurrent state changes
            $locked = Application::lockForUpdate()->find($app->id);

            if ($locked->status !== Application::STATUS_UNDER_REVIEW){
                abort(409,'Application is not currently under review');

            }
            // B-3: only the reviewer who claimed it — or an admin — may release it
            if ($locked->assigned_reviewer_id !== $actor->id && !$actor->isAdmin() ){
                abort(403,'Only the assigned reviewer or the admin may release this claim');
            }
            $this->transitionTo($locked,Application::STATUS_SUBMITTED);
            $locked->assigned_reviewer_id = null;
            $locked->save();

            AuditLog::record(
                user:$actor,
                subject:$locked,
                action:'application.released',
                extra:[
                    'rule_id'     => 'ESP-WF-011',
                    'from_status' => $prevStatus,
                    'to_status'   => Application::STATUS_SUBMITTED,
                ],
            );
            $app->fill($locked->toArray());
        });
        return $app->fresh();
    }   

    // ─────────────────────────────────────────────────────────────────
    // decide() — EDA Decision Chain: under_review → approved|rejected|modifications_requested
    // ─────────────────────────────────────────────────────────────────

    /**
     * Record a reviewer decision.
     *
     * EDA Decision Chain:
     *   B-2 Branch:         Role must match current stage
     *   B-3 Relationship:   Actor must be the assigned reviewer
     *   B-4 Description:    Notes required for non-approve decisions
     *   B-5 Difference:     Decision must be in ALLOWED_TRANSITIONS['under_review']
     *   B-6 Conditions:     Application must be under_review and claimed by this actor
     *   B-7 Cause:          Explicit HTTP POST /applications/{id}/decide
     *   B-8 Blockers:       Terminal state guard
     *   B-9 Effect:         ApplicationReview created + AuditLog::record()
     *   B-10 Residuals:     modifications_requested → review_round++; approved → fee notification
     */
    public function decide(
        Application $app,
        User        $actor,
        string      $decision,
        ?string     $notes      = null,
        array       $annotations = [],
    ): ApplicationReview {
        // B-6: Must be under review and claimed by this actor
        if ($app->status !== Application::STATUS_UNDER_REVIEW) {
            abort(422, 'Application is not under review.');
        }

        if ($app->assigned_reviewer_id !== $actor->id) {
            abort(403, 'You are not the assigned reviewer for this application.');
        }

        // B-5: Validate decision is an allowed transition (global list)
        $allowedDecisions = self::ALLOWED_TRANSITIONS[Application::STATUS_UNDER_REVIEW] ?? [];
        if (! in_array($decision, $allowedDecisions)) {
            abort(422, "Decision '{$decision}' is not valid for current status.");
        }

        // B-5 (schema layer): validate against the stage's declared actions array.
        // ALLOWED_TRANSITIONS is the global floor; the schema can restrict further.
        // This is the connection between schema validation and generated services —
        // every generated service has its own actions list per stage.
        $stage = $this->service->getStage($app->current_stage ?? '');
        if ($stage && isset($stage['actions']) && is_array($stage['actions'])) {
            // Map schema action names to the status strings WorkflowEngine uses
            $schemaActionMap = [
                'approve'               => Application::STATUS_APPROVED,
                'reject'                => Application::STATUS_REJECTED,
                'request_modifications' => Application::STATUS_MODIFICATIONS_REQUESTED,
            ];
            $allowedBySchema = array_filter(
                array_map(fn($a) => $schemaActionMap[$a] ?? null, $stage['actions'])
            );
            if (! in_array($decision, $allowedBySchema)) {
                $stageName = $stage['label_ar'] ?? $app->current_stage;
                abort(422, "القرار '{$decision}' غير مسموح به في مرحلة '{$stageName}'.");
            }
        }

        // B-4: Notes required for non-approve decisions
        if ($decision !== 'approved' && empty($notes)) {
            abort(422, 'Notes are required when rejecting or requesting modifications.');
        }

        $prevStatus = $app->status;
        $review     = null;

        DB::transaction(function () use ($app, $actor, $decision, $notes, $annotations, $prevStatus, &$review) {
            // B-5 + WF-001
            $this->transitionTo($app, $decision);

            // Advance to next stage or finalize
            if ($decision === Application::STATUS_APPROVED) {
                $nextStage = $this->getNextStage($app->current_stage);
                if ($nextStage) {
                    // Move to next workflow stage
                    $this->transitionTo($app, Application::STATUS_UNDER_REVIEW);
                    $app->current_stage        = $nextStage['id'];
                    $app->assigned_reviewer_id = null; // reset for next stage
                    if (isset($nextStage['sla_hours'])) {
                        $app->sla_deadline = now()->addHours($nextStage['sla_hours']);
                    }
                }
                // else: final stage approval — stays approved
            } elseif ($decision === Application::STATUS_MODIFICATIONS_REQUESTED) {
                // B-10: track review round
                $app->review_round++;
                $app->assigned_reviewer_id = null;
            } elseif ($decision === Application::STATUS_REJECTED) {
                // Terminal — assigned reviewer cleared
                $app->assigned_reviewer_id = null;
            }

            $app->save();

            // Store the review record
            $review = ApplicationReview::create([
                'application_id' => $app->id,
                'reviewer_id'    => $actor->id,
                'stage_id'       => $app->current_stage,
                'decision'       => $decision,
                'notes'          => $notes,
                'annotations'    => $annotations,
                'review_round'   => $app->review_round,
            ]);

            // B-9 + WF-003
            AuditLog::record(
                user:    $actor,
                subject: $app,
                action:  'application.decided',
                extra: [
                    'rule_id'     => 'ESP-WF-003',
                    'from_status' => $prevStatus,
                    'to_status'   => $app->status,
                    'decision'    => $decision,
                    'review_id'   => $review->id,
                ],
            );
        });

        return $review;
    }

    // ─────────────────────────────────────────────────────────────────
    // confirmPayment() — records payment before certificate issuance
    // ─────────────────────────────────────────────────────────────────

    public function confirmPayment(Application $app, User $actor, string $paymentReference): Application
    {
        if ($app->status !== Application::STATUS_APPROVED) {
            abort(422, 'Payment can only be confirmed for approved applications.');
        }

        DB::transaction(function () use ($app, $actor, $paymentReference) {
            $app->update([
                'payment_status'        => 'paid',
                'payment_reference'     => $paymentReference,
                'payment_confirmed_at'  => now(),
            ]);

            AuditLog::record(
                user:    $actor,
                subject: $app,
                action:  'application.payment_confirmed',
                extra: [
                    'rule_id'           => 'ESP-WF-005',
                    'payment_reference' => $paymentReference,
                ],
            );
        });

        return $app->fresh();
    }

    // ─────────────────────────────────────────────────────────────────
    // issueCertificate() — EDA Decision Chain: approved → certificate_issued
    // ─────────────────────────────────────────────────────────────────

    /**
     * Issue a certificate for an approved application.
     *
     * EDA Decision Chain:
     *   B-6 Conditions:     Application must be approved AND fee must be paid
     *   B-5 Difference:     approved → certificate_issued in ALLOWED_TRANSITIONS
     *   B-7 Cause:          Explicit HTTP POST /applications/{id}/issue-certificate
     *   B-8 Blockers:       Payment check; terminal state guard
     *   B-9 Effect:         Certificate created + AuditLog::record()
     *   B-10 Residuals:     certificate_issued is terminal — no further transitions
     */
    public function issueCertificate(Application $app, User $actor): Certificate
    {
        // B-6: Both approval and payment required
        if ($app->status !== Application::STATUS_APPROVED) {
            abort(422, 'Certificate can only be issued for approved applications.');
        }

        if (! $app->isFeePaid()) {
            abort(422, 'Payment must be confirmed before issuing a certificate.');
        }

        $certConfig = $this->service->getCertificateConfig();
        $prevStatus = $app->status;
        $certificate = null;

        DB::transaction(function () use ($app, $actor, $certConfig, $prevStatus, &$certificate) {
            // B-5 + WF-001
            $this->transitionTo($app, Application::STATUS_CERTIFICATE_ISSUED);
            $app->save();

            // Build cert data from schema fields_on_cert
            $certFields = $certConfig['fields_on_cert'] ?? [];
            $certData   = array_intersect_key($app->data ?? [], array_flip($certFields));

            // DATA-005: QR token is HMAC-signed
            $certNumber = $this->generateCertificateNumber($app);
            $qrToken    = hash_hmac('sha256', $certNumber, config('app.key'));

            $validityMonths = $certConfig['validity_months'] ?? 12;

            $certificate = Certificate::create([
                'application_id'     => $app->id,
                'organization_id'    => $app->organization_id,
                'issued_to'          => $app->applicant_id,
                'issued_by'          => $actor->id,
                'certificate_number' => $certNumber,
                'qr_token'           => $qrToken,
                'status'             => 'active',
                'issued_date'        => now()->toDateString(),
                'expiry_date'        => now()->addMonths($validityMonths)->toDateString(),
                'cert_data'          => $certData,
            ]);

            // B-9 + WF-003
            AuditLog::record(
                user:    $actor,
                subject: $app,
                action:  'application.certificate_issued',
                extra: [
                    'rule_id'            => 'ESP-WF-004',
                    'from_status'        => $prevStatus,
                    'to_status'          => Application::STATUS_CERTIFICATE_ISSUED,
                    'certificate_number' => $certNumber,
                ],
            );
        });

        return $certificate;
    }

    // ─────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────

    /**
     * WF-001: Single transition point — all status changes go through here.
     * B-5: Validates against ALLOWED_TRANSITIONS constant.
     *
     * NEVER call $app->status = $newStatus directly. Always use this method.
     */
    private function transitionTo(Application $app, string $newStatus): void
    {
        $allowed = self::ALLOWED_TRANSITIONS[$app->status] ?? [];

        if (! in_array($newStatus, $allowed)) {
            abort(422, sprintf(
                'Invalid transition: %s → %s. Allowed: [%s].',
                $app->status,
                $newStatus,
                implode(', ', $allowed),
            ));
        }

        $app->status = $newStatus;
    }

    private function getNextStage(string $currentStageId): ?array
    {
        $stages = $this->service->getWorkflowStages();
        foreach ($stages as $i => $stage) {
            if ($stage['id'] === $currentStageId && isset($stages[$i + 1])) {
                return $stages[$i + 1];
            }
        }
        return null;
    }

    private function generateCertificateNumber(Application $app): string
    {
        $count = Certificate::where('organization_id', $app->organization_id)->count() + 1;
        return sprintf('CERT-%s-%s-%05d',
            strtoupper($this->service->code),
            now()->format('Y'),
            $count,
        );
    }
}

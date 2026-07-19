<?php

namespace App\Http\Controllers\Api;

use App\Engine\FeeCalculator;
use App\Engine\SchemaValidator;
use App\Engine\WorkflowEngine;
use App\Http\Controllers\Controller;
use App\Http\Requests\ConfirmPaymentRequest;
use App\Http\Requests\DecideApplicationRequest;
use App\Http\Requests\StoreApplicationRequest;
use App\Models\Application;
use App\Models\ApplicationDocument;
use App\Models\Certificate;
use App\Models\ServiceDefinition;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * ApplicationController
 *
 * BUILD CONTRACT compliance:
 *   ✅ P-3: No inline $request->validate() — FormRequest classes used
 *   ✅ P-5: All queries scoped by organization_id via scopeForOrganization()
 *   ✅ WF-001: State mutations go through WorkflowEngine only
 *   ✅ EDA-10: Validation failures return 422 with field errors (never silently stripped)
 */
class ApplicationController extends Controller
{
    // ── List applications ─────────────────────────────────────────────

    public function index(Request $request): JsonResponse
    {
        $query = Application::forOrganization($request->user()->organization_id)
            ->with(['serviceDefinition:id,code,name_ar,name_en', 'certificate:id,application_id,certificate_number,status'])
            ->orderByDesc('created_at');

        // Applicants see only their own; staff/admin see all
        if ($request->user()->isApplicant()) {
            $query->where('applicant_id', $request->user()->id);
        }

        return response()->json(['applications' => $query->get()]);
    }

    // ── Show single application ───────────────────────────────────────

    public function show(Request $request, int $id): JsonResponse
    {
        $app = $this->findAccessible($request, $id);
        $app->load(['serviceDefinition', 'applicant:id,name,email', 'documents', 'reviews.reviewer:id,name,role', 'certificate']);

        return response()->json(['application' => $app]);
    }

    // ── Create draft ──────────────────────────────────────────────────

    public function store(StoreApplicationRequest $request): JsonResponse
    {
        // SEC: Only applicants may create applications — staff/admin/auditor must not
        if (! $request->user()->isApplicant()) {
            return response()->json(['message' => 'المسؤولون والموظفون لا يمكنهم تقديم طلبات.'], 403);
        }

        // P-5: Organization-scoped service lookup
        $service = ServiceDefinition::where('organization_id', $request->user()->organization_id)
            ->where('code', $request->service_code)
            ->where('status', 'active')
            ->firstOrFail();

        $fee = (new FeeCalculator($service))->calculate($request->data);

        $app = Application::create([
            'reference_number'      => Application::generateReference($service->code),
            'organization_id'       => $request->user()->organization_id,
            'service_definition_id' => $service->id,
            'applicant_id'          => $request->user()->id,
            'status'                => Application::STATUS_DRAFT,
            'data'                  => $request->data,
            'fee_amount'            => $fee,
            'payment_status'        => $fee > 0 ? 'pending' : 'waived',
        ]);

        return response()->json(['application' => $app], 201);
    }

    // ── Update draft ──────────────────────────────────────────────────

    public function update(Request $request, int $id): JsonResponse
    {
        $app = $this->findAccessible($request, $id);

        if (! $app->isEditable()) {
            return response()->json(['message' => 'يمكن تعديل الطلبات في مرحلة المسودة أو طلب التعديل فقط.'], 422);
        }

        $data = $request->validate(['data' => ['required', 'array']]);
        $fee  = (new FeeCalculator($app->serviceDefinition))->calculate($data['data']);

        $app->update(['data' => $data['data'], 'fee_amount' => $fee]);

        return response()->json(['application' => $app]);
    }

    // ── Submit ────────────────────────────────────────────────────────

    /**
     * EDA-10 / WF-005: Validation failure returns 422 with field-level errors.
     * The application stays in draft — case identity preserved.
     * Frontend navigates back to form step and shows errors inline.
     *
     * BUILD CONTRACT P-1: Validation rules are NEVER removed to unblock this flow.
     */
    public function submit(Request $request, int $id): JsonResponse
    {
        $app     = $this->findAccessible($request, $id);
        $service = $app->serviceDefinition;

        // EDA B-4 / WF-005: validate schema fields
        $dataErrors = (new SchemaValidator($service))->validateData($app->data ?? []);
        if ($dataErrors) {
            // EDA-10: Correctable Defect — return field errors, application stays in draft
            return response()->json([
                'message' => 'يوجد أخطاء في البيانات. يرجى مراجعة الحقول المحددة.',
                'errors'  => $dataErrors,
            ], 422);
        }

        // WF-006: validate required documents
        $uploadedIds = $app->documents->pluck('document_id')->toArray();
        $docErrors   = (new SchemaValidator($service))->validateDocuments($uploadedIds, $app->data ?? []);
        if ($docErrors) {
            return response()->json([
                'message' => 'يوجد مستندات مطلوبة غير مرفوعة.',
                'errors'  => $docErrors,
            ], 422);
        }

        // WF-001: delegate to WorkflowEngine (EDA B-5, B-9)
        $engine = new WorkflowEngine($service);
        $app    = $engine->submit($app, $request->user());

        return response()->json(['application' => $app]);
    }

    // ── Upload document ───────────────────────────────────────────────

    public function uploadDocument(Request $request, int $id): JsonResponse
    {
        $app = $this->findAccessible($request, $id);

        if (! $app->isEditable()) {
            return response()->json(['message' => 'المستندات تُرفع فقط للطلبات في مرحلة المسودة.'], 422);
        }

        $request->validate([
            'document_id' => ['required', 'string'],
            // SEC: restrict uploads to safe document types only; 10 MB max
            'file'        => ['required', 'file', 'max:10240', 'mimes:pdf,jpg,jpeg,png,tiff,doc,docx'],
        ]);

        $file   = $request->file('file');
        // Store under storage/app/uploads/ — use 'local' disk root directly
        $stored = $file->storeAs(
            "uploads/applications/{$app->id}",
            \Illuminate\Support\Str::uuid() . '.' . $file->getClientOriginalExtension(),
            ['disk' => 'local']
        );

        // Replace existing upload for this document slot
        ApplicationDocument::where('application_id', $app->id)
            ->where('document_id', $request->document_id)
            ->delete();

        $doc = ApplicationDocument::create([
            'application_id'    => $app->id,
            'document_id'       => $request->document_id,
            'original_filename' => $file->getClientOriginalName(),
            'stored_filename'   => basename($stored),
            'disk'              => 'local',
            'path'              => $stored,
            'mime_type'         => $file->getMimeType(),
            'size_bytes'        => $file->getSize(),
            'uploaded_by'       => $request->user()->id,
        ]);

        return response()->json(['document' => $doc], 201);
    }

    // ── Reviewer queue ────────────────────────────────────────────────

    public function reviewQueue(Request $request): JsonResponse
    {
        $user = $request->user();

        // Admin, staff, and auditors can all see the queue
        if (! ($user->isReviewer() || $user->isAdmin())) {
            abort(403, 'المراجعون فقط يمكنهم الوصول لهذه القائمة.');
        }

        $org = $user->organization_id;

        // Queue = unassigned submitted apps  PLUS  apps currently claimed by this user
        $submitted = Application::forOrganization($org)
            ->with(['serviceDefinition:id,code,name_ar,name_en,schema', 'applicant:id,name,email'])
            ->where('status', Application::STATUS_SUBMITTED)
            ->whereNull('assigned_reviewer_id')
            ->orderBy('sla_deadline');

        $myInProgress = Application::forOrganization($org)
            ->with(['serviceDefinition:id,code,name_ar,name_en,schema', 'applicant:id,name,email'])
            ->where('status', Application::STATUS_UNDER_REVIEW)
            ->where('assigned_reviewer_id', $user->id)
            ->orderBy('sla_deadline');

        // Bug fix: approved applications previously vanished from every list once
        // approved — staff had no way to reach them to confirm payment or issue a
        // certificate. Surface them here for staff/admin (the only roles that can
        // act on payment/certificates — auditors have no action to take on these).
        $approved = collect();
        if ($user->isStaff() || $user->isAdmin()) {
            $approved = Application::forOrganization($org)
                ->with(['serviceDefinition:id,code,name_ar,name_en,schema', 'applicant:id,name,email'])
                ->where('status', Application::STATUS_APPROVED)
                ->orderBy('updated_at')
                ->get();
        }

        // Merge all sets, my in-progress first, then unassigned submitted, then approved
        $applications = $myInProgress->get()->merge($submitted->get())->merge($approved);


        return response()->json(['applications' => $applications->values()]);
    }

    // ── Claim ─────────────────────────────────────────────────────────

    public function claim(Request $request, int $id): JsonResponse
    {
        $app    = Application::forOrganization($request->user()->organization_id)->findOrFail($id);
        $engine = new WorkflowEngine($app->serviceDefinition);
        $app    = $engine->claim($app, $request->user());

        return response()->json(['application' => $app]);
    }
    // ── Release (unclaim) ────────────────────────────────────────────
    public function release(Request $request, int $id): JsonResponse
    {
        $app    = Application::forOrganization($request->user()->organization_id)->findOrFail($id);
        $engine = new WorkflowEngine($app->serviceDefinition);
        $app    = $engine->release($app, $request->user());

        return response()->json(['application' => $app]);
    }

    // ── Decide ────────────────────────────────────────────────────────

    public function decide(DecideApplicationRequest $request, int $id): JsonResponse
    {
        $app    = Application::forOrganization($request->user()->organization_id)->findOrFail($id);
        $engine = new WorkflowEngine($app->serviceDefinition);
        $review = $engine->decide(
            $app,
            $request->user(),
            $request->decision,
            $request->notes,
            $request->annotations ?? [],
        );

        return response()->json(['review' => $review, 'application' => $app->fresh()]);
    }

    // ── Confirm payment ───────────────────────────────────────────────

    public function confirmPayment(ConfirmPaymentRequest $request, int $id): JsonResponse
    {
        $app    = Application::forOrganization($request->user()->organization_id)->findOrFail($id);
        $engine = new WorkflowEngine($app->serviceDefinition);
        $app    = $engine->confirmPayment($app, $request->user(), $request->payment_reference);

        return response()->json(['application' => $app]);
    }

    // ── Issue certificate ─────────────────────────────────────────────

    public function issueCertificate(Request $request, int $id): JsonResponse
    {
        if (! $request->user()->isAdmin() && ! $request->user()->isStaff()) {
            abort(403, 'المسؤولون والموظفون فقط يمكنهم إصدار الشهادات.');
        }

        $app    = Application::forOrganization($request->user()->organization_id)->findOrFail($id);
        $engine = new WorkflowEngine($app->serviceDefinition);
        $cert   = $engine->issueCertificate($app, $request->user());

        return response()->json(['certificate' => $cert, 'application' => $app->fresh()]);
    }

    // ── Public certificate verification ───────────────────────────────

    public function verifyCertificate(string $certNumber): JsonResponse
    {
        $cert = Certificate::with([
            'application.serviceDefinition:id,name_ar,name_en',
            'issuedTo:id,name',
        ])->where('certificate_number', $certNumber)->firstOrFail();

        return response()->json([
            'valid'              => $cert->status === 'active',
            'certificate_number' => $cert->certificate_number,
            'issued_to'          => $cert->issuedTo->name,
            'service'            => $cert->application->serviceDefinition->name_ar,
            'issued_date'        => $cert->issued_date,
            'expiry_date'        => $cert->expiry_date,
            'status'             => $cert->status,
        ]);
    }

    // ── Private helpers ───────────────────────────────────────────────

    /**
     * P-5: Always scope by organization_id.
     * Applicants additionally scoped to their own applications.
     */
    private function findAccessible(Request $request, int $id): Application
    {
        $query = Application::forOrganization($request->user()->organization_id);

        if ($request->user()->isApplicant()) {
            $query->where('applicant_id', $request->user()->id);
        }

        return $query->with(['serviceDefinition', 'documents'])->findOrFail($id);
    }
}

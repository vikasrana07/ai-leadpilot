import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '@leadpilot/validation';

export const BILLING_EXEMPT = 'billingExempt';
export const REQUIRE_FEATURE = 'requireFeature';
/** Route keeps working for a lapsed (read-only) workspace: billing, notifications. */
export const BillingExempt = (): MethodDecorator & ClassDecorator => SetMetadata(BILLING_EXEMPT, true);
/** Route needs a plan feature. Enforced by PlanGuard in the backend; the UI only mirrors it. */
export const RequireFeature = (key: FeatureKey): MethodDecorator & ClassDecorator => SetMetadata(REQUIRE_FEATURE, key);

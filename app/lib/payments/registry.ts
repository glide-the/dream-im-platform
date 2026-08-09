import { ProductError } from "../product/errors";
import type { PaymentAdapter } from "./adapter";
import { FakePaymentAdapter } from "./fake-adapter";

export function configuredPaymentAdapter(
  environment: NodeJS.ProcessEnv = process.env,
): PaymentAdapter {
  const code = environment.INK_PAYMENT_ADAPTER?.trim().toLowerCase();
  if (!code) {
    throw new ProductError(
      "PAYMENT_ADAPTER_NOT_CONFIGURED",
      "No subscription payment channel is configured",
      503,
    );
  }
  if (code === "fake") return new FakePaymentAdapter(environment);
  throw new ProductError(
    "PAYMENT_ADAPTER_UNSUPPORTED",
    "The configured subscription payment channel is unavailable",
    503,
  );
}
